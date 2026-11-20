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
                    json
                        .getValue("lastTrainBasis")
                        .jsonObject
                        .getValue("dayType")
                        .jsonPrimitive.content shouldBe
                        "saturday"
                    json.cards().forEach { card ->
                        val (seoul, sinbundang) = card.trains()
                        sinbundang.toString() shouldBe """{"participantId":"1","kind":"check"}"""
                        // 홍대입구(2호선)는 토요일 시간표가 있다: 직행 확정은 아니고(대조 전) 여유 시각이거나, 자기 역이면 확인 필요.
                        (seoul.getValue("kind").jsonPrimitive.content in setOf("margin", "check")) shouldBe true
                    }
                    json.cards().any {
                        it
                            .trains()
                            .first()
                            .getValue("kind")
                            .jsonPrimitive.content == "margin"
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
                        val response =
                            client.json(
                                HttpMethod.Post,
                                "/v1/recommend",
                                body(listOf(gangnam, gwanggyo), "weekday-night"),
                            )
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
