@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.app

import app.banbanyeok.schema.DayType
import app.banbanyeok.server.app.application.BackgroundLastTrains
import app.banbanyeok.server.app.http.ApiServices
import app.banbanyeok.server.recommendation.LastTrainRule
import app.banbanyeok.server.recommendation.LastTrainSource
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.wire
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** 실제 dev 산출물(lt.bin 포함)로 조립한 추천 서비스. [source]가 null을 주면 막차 표가 준비되지 않은 서버다. */
private fun api(
    source: LastTrainSource = DevArtifacts.lastTrains,
    clock: Clock = Clock.fixed(Instant.parse("2026-11-21T03:00:00Z"), ZoneOffset.UTC),
): ApiServices {
    val mocks = MockedServices()
    val directory = DevArtifacts.directory
    return ApiServices(
        mocks.anon,
        mocks.rooms,
        mocks.results,
        RecommendationService(directory.travel, directory, locations = directory, lastTrains = source, clock = clock),
        directory,
        DevArtifacts.published,
    )
}

private suspend fun HttpResponse.body(): JsonObject = Json.parseToJsonElement(bodyAsText()).jsonObject

private fun codeOf(name: String): String =
    DevArtifacts.directory.originCodes.first { DevArtifacts.directory.nameOf(it) == name }

private fun JsonObject.cards(): List<JsonObject> = getValue("candidates").jsonArray.map { it.jsonObject }

private fun JsonObject.trains(): List<JsonObject> = getValue("lastTrains").jsonArray.map { it.jsonObject }

private fun body(
    origins: List<String>,
    slot: String?,
    mode: String = "fair",
): String =
    buildJsonObject {
        put("origins", JsonArray(origins.map(::JsonPrimitive)))
        put("mode", mode)
        slot?.let { put("timeSlot", it) }
    }.toString()

class LastTrainHttpTest :
    DescribeSpec({
        val gangnam = codeOf("강남")
        val gwanggyo = codeOf("광교")
        val hongdae = codeOf("홍대입구")
        val jamsil = codeOf("잠실")

        describe("the timetable date of the manifest") {
            it("turns last trains off instead of failing the start when it cannot be read as a date") {
                CompositionRoot.lastTrainAsOf("2026-11-16") shouldBe LocalDate.parse("2026-11-16")
                CompositionRoot.lastTrainAsOf(null) shouldBe null
                // manifest 검사가 먼저 거르지만, 여기까지 와도 서버는 뜨고 막차만 꺼진다(PR #81 검토: 2026-02-30에서 기동 실패).
                CompositionRoot.lastTrainAsOf("2026-02-30") shouldBe null
                BackgroundLastTrains(
                    CompletableDeferred(DevArtifacts.lastTrains.current()!!.table),
                    null,
                ).current() shouldBe
                    null
            }
        }

        describe("POST /v1/recommend lastTrains") {
            it("adds everyone's last train to every candidate, read from the published table of the same data") {
                testApplication {
                    application { apiModule(testConfig(), api()) }
                    val response =
                        client.json(HttpMethod.Post, "/v1/recommend", body(listOf(gangnam, gwanggyo), "weekday-night"))
                    response.status shouldBe HttpStatusCode.OK
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", response)
                    val json = response.body()
                    json.getValue("lastTrainBasis").toString() shouldBe
                        """{"dayType":"weekday","asOf":"${DevArtifacts.lastTrainAsOf}"}"""
                    val table = DevArtifacts.lastTrains.current()!!.table
                    json.cards().forEach { card ->
                        val station = card.getValue("stationCode").jsonPrimitive.content
                        card.trains().map { it.getValue("participantId").jsonPrimitive.content } shouldBe
                            listOf("0", "1")
                        card.trains().zip(listOf(gangnam, gwanggyo)).forEach { (train, home) ->
                            val cell = LastTrainRule.cell(table, DayType.WEEKDAY, home, station)
                            train.getValue("kind").jsonPrimitive.content shouldBe cell.kind.wire
                            train["minute"]?.jsonPrimitive?.int shouldBe cell.minute
                            train["boundFor"]
                                ?.jsonObject
                                ?.get("stationCode")
                                ?.jsonPrimitive
                                ?.content shouldBe
                                cell.boundFor?.toString()
                        }
                    }
                }
            }

            it("gives the exact minute of a confirmed direct train and its destination") {
                // 신분당선은 운영사 공식표 대조를 통과한 노선이다: 강남에서 광교행 평일 막차는 24:03.
                val table = DevArtifacts.lastTrains.current()!!.table
                val cell = LastTrainRule.cell(table, DayType.WEEKDAY, gwanggyo, gangnam)
                cell.kind.wire shouldBe "direct"
                cell.minute shouldBe 24 * 60 + 3
                cell.boundFor?.toString() shouldBe gwanggyo
                LastTrainRule.cell(table, DayType.HOLIDAY, gwanggyo, gangnam).minute shouldBe 23 * 60 + 30
                // 토요일은 서울교통공사 1~8호선만 켠다: 신분당선으로 가는 길은 확인 필요다.
                LastTrainRule.cell(table, DayType.SATURDAY, gwanggyo, gangnam).kind.wire shouldBe "check"
            }

            it("confirms Seoul lines 1 to 8 against the operator's file and keeps line 9 a margin time") {
                val table = DevArtifacts.lastTrains.current()!!.table
                // 2호선(순환, 단축 운행): 홍대입구에서 합정으로 가는 막차는 신도림행이다. 평일 24:50, 토요일·휴일 23:51.
                val sindorim = codeOf("신도림")
                mapOf(
                    DayType.WEEKDAY to 24 * 60 + 50,
                    DayType.SATURDAY to 23 * 60 + 51,
                    DayType.HOLIDAY to 23 * 60 + 51,
                ).forEach { (day, minute) ->
                    val cell = LastTrainRule.cell(table, day, codeOf("합정"), hongdae)
                    cell.kind.wire shouldBe "direct"
                    cell.minute shouldBe minute
                    cell.boundFor?.toString() shouldBe sindorim
                }
                // 9호선은 확정에서 뺀다. 휴일 당산→가양 급행은 운영사 표로 23:48:30이다(PR #81 검토): 보이는 시각은 그보다 늦지 않다.
                listOf("가양", "마곡나루", "김포공항").forEach { home ->
                    val cell = LastTrainRule.cell(table, DayType.HOLIDAY, codeOf(home), codeOf("당산"))
                    cell.kind shouldBe app.banbanyeok.schema.LastTrainKind.MARGIN_DIRECT
                    (cell.minute!! <= 23 * 60 + 48) shouldBe true
                }
            }

            it("keeps the ranking, times and reasons of every slot exactly as without last trains") {
                testApplication {
                    application { apiModule(testConfig(), api()) }
                    // 요청 제한(분당 횟수) 안에서 요일 종류·기준이 다른 세 가지를 본다. 모든 기준의 불변은 서비스 테스트가 본다.
                    val cases = listOf("weekday-night" to "fair", "saturday-day" to "fast", "holiday-evening" to "fair")
                    cases.forEach { (slot, mode) ->
                        val with =
                            client.json(
                                HttpMethod.Post,
                                "/v1/recommend",
                                body(listOf(hongdae, jamsil, gwanggyo), slot, mode),
                            )
                        with.status shouldBe HttpStatusCode.OK
                        val json = with.body()
                        json
                            .getValue("timeBasis")
                            .jsonObject
                            .getValue("timeSlot")
                            .jsonPrimitive.content shouldBe slot
                        ("lastTrainBasis" in json) shouldBe true
                        WithoutLastTrains.expect(json, listOf(hongdae, jamsil, gwanggyo), slot, mode)
                    }
                }
            }

            it("shows no time on Saturday for a home that needs a line without a Saturday timetable") {
                testApplication {
                    application { apiModule(testConfig(), api()) }
                    val json =
                        client
                            .json(
                                HttpMethod.Post,
                                "/v1/recommend",
                                body(listOf(hongdae, gwanggyo), "saturday-night"),
                            ).body()
                    // 토요일은 일부 노선만 계산한 요일 종류다: 화면이 "이 요일은 일부 노선만"이라고 말할 근거를 준다.
                    json.getValue("lastTrainBasis").toString() shouldBe
                        """{"dayType":"saturday","asOf":"${DevArtifacts.lastTrainAsOf}","partial":true}"""
                    json.cards().forEach { card ->
                        val (_, sinbundang) = card.trains()
                        sinbundang.toString() shouldBe """{"participantId":"1","kind":"check"}"""
                    }
                    // 홍대입구(2호선)는 토요일 시간표가 있다: 시각이 나오는 후보가 있다.
                    json.cards().any {
                        it
                            .trains()
                            .first()
                            .getValue("kind")
                            .jsonPrimitive.content in setOf("direct", "margin")
                    } shouldBe
                        true
                }
            }

            it("shows no time when the request names no slot: weekday is only the default there") {
                testApplication {
                    application { apiModule(testConfig(), api()) }
                    val response = client.json(HttpMethod.Post, "/v1/recommend", body(listOf(gangnam, gwanggyo), null))
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", response)
                    val json = response.body()
                    json.getValue("lastTrainBasis").toString() shouldBe
                        """{"dayType":"weekday","asOf":"${DevArtifacts.lastTrainAsOf}","unavailable":"day_unknown"}"""
                    json.cards().forEach { card ->
                        card.trains().map { it.toString() } shouldBe
                            listOf(
                                """{"participantId":"0","kind":"check"}""",
                                """{"participantId":"1","kind":"check"}""",
                            )
                    }
                }
            }

            it("turns every entry into check 120 days after the timetable was fetched") {
                testApplication {
                    val late = LocalDate.parse(DevArtifacts.lastTrainAsOf).plusDays(121)
                    application {
                        apiModule(
                            testConfig(),
                            api(clock = Clock.fixed(Instant.parse("${late}T03:00:00Z"), ZoneOffset.UTC)),
                        )
                    }
                    val json =
                        client
                            .json(
                                HttpMethod.Post,
                                "/v1/recommend",
                                body(listOf(gangnam, gwanggyo), "weekday-night"),
                            ).body()
                    json
                        .getValue("lastTrainBasis")
                        .jsonObject
                        .getValue("unavailable")
                        .jsonPrimitive.content shouldBe
                        "stale"
                    json.cards().forEach { card ->
                        card.trains().forEach { it.getValue("kind").jsonPrimitive.content shouldBe "check" }
                    }
                }
            }

            it("omits the last-train keys, and nothing else, while the table is not loaded or failed validation") {
                val pending = BackgroundLastTrains(CompletableDeferred(), LocalDate.parse(DevArtifacts.lastTrainAsOf))
                val failed =
                    BackgroundLastTrains(
                        CompletableDeferred<app.banbanyeok.schema.LastTrainTable?>().also {
                            it.completeExceptionally(IllegalStateException("검증 실패"))
                        },
                        LocalDate.parse(DevArtifacts.lastTrainAsOf),
                    )
                listOf(pending, failed).forEach { source ->
                    testApplication {
                        application { apiModule(testConfig(), api(source)) }
                        val started = System.nanoTime()
                        val response =
                            client.json(
                                HttpMethod.Post,
                                "/v1/recommend",
                                body(listOf(gangnam, gwanggyo), "weekday-night"),
                            )
                        // 표가 준비되지 않았어도 요청은 기다리지 않는다(PR #81 검토: 전에는 요청마다 최대 2초를 기다렸다).
                        ((System.nanoTime() - started) / 1_000_000 < 1_500) shouldBe true
                        response.status shouldBe HttpStatusCode.OK
                        OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", response)
                        val json = response.body()
                        ("lastTrainBasis" in json) shouldBe false
                        json.cards().forEach { ("lastTrains" in it) shouldBe false }
                        WithoutLastTrains.expect(json, listOf(gangnam, gwanggyo), "weekday-night", "fair")
                    }
                }
            }
        }
    })

/** 막차 표 없이 조립한 서버의 응답. 막차가 붙은 응답에서 막차 키를 뺀 것과 글자까지 같아야 한다(순위·시간·이유 불변). */
private object WithoutLastTrains {
    suspend fun expect(
        withLastTrains: JsonObject,
        origins: List<String>,
        slot: String,
        mode: String,
    ) {
        var plain: JsonObject? = null
        testApplication {
            application { apiModule(testConfig(), api(source = { null })) }
            plain = client.json(HttpMethod.Post, "/v1/recommend", body(origins, slot, mode)).body()
        }
        val stripped =
            JsonObject(
                (withLastTrains - "lastTrainBasis") +
                    (
                        "candidates" to
                            JsonArray(withLastTrains.cards().map { JsonObject(it - "lastTrains") })
                    ),
            )
        stripped shouldBe plain
    }
}
