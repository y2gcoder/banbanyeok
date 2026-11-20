package app.banbanyeok.server.app

import app.banbanyeok.schema.TimeBand
import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.app.http.ApiServices
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomFixture
import app.banbanyeok.server.room.RoomMode
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.HttpClient
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.nio.file.Files
import java.nio.file.Path
import java.time.Clock
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset

/**
 * 추천 응답 전체를 고정하는 특성 테스트(#88). 구조를 바꾸는 리팩터링 앞뒤로 `/v1/recommend`, 방 결과, 방 미리보기의 응답 JSON이
 * 글자까지 같아야 한다. 실제 dev 산출물(구분 행렬·막차 표 포함)을 쓰고, 시계는 막차 수집일 열흘 뒤로 고정한다.
 *
 * 기대값은 `src/test/resources/characterization/`에 있다. 의도한 응답 변경일 때만 `UPDATE_CHARACTERIZATION=1`로 다시 쓴다.
 */
class CharacterizationHttpTest :
    DescribeSpec({
        val directory = DevArtifacts.directory
        val clock: Clock =
            Clock.fixed(
                LocalDate
                    .parse(DevArtifacts.lastTrainAsOf)
                    .plusDays(10)
                    .atTime(12, 0)
                    .toInstant(ZoneOffset.UTC),
                ZoneOffset.UTC,
            )

        fun recommendation() =
            RecommendationService(
                directory.travel,
                directory,
                locations = directory,
                lastTrains = DevArtifacts.lastTrains,
                clock = clock,
            )

        fun code(name: String): String = directory.originCodes.first { directory.nameOf(it) == name }

        it("keeps every /v1/recommend response for people × mode × time slot") {
            val groups =
                listOf(
                    listOf("홍대입구", "잠실"),
                    listOf("합정", "강남", "김포공항"),
                    listOf("광교", "당산", "잠실", "홍대입구"),
                )
            val modes = listOf("fair" to null, "fast" to null, "favor" to 0, "favor" to 1)
            val slots = listOf(null, "weekday-day", "weekday-evening", "saturday-night", "holiday-morning")
            val mocks = MockedServices()
            val api =
                ApiServices(mocks.anon, mocks.rooms, mocks.results, recommendation(), directory, DevArtifacts.published)
            val responses = Recorded()
            testApplication {
                application { apiModule(unlimited, api) }
                for (group in groups) {
                    for ((mode, favor) in modes) {
                        for (slot in slots) {
                            val body =
                                buildJsonObject {
                                    putJsonArray("origins") { group.forEach { add(code(it)) } }
                                    // 첫 사람만 별칭이 있다(나머지는 출발역 이름으로 표시).
                                    putJsonArray("nicknames") {
                                        group.indices.forEach {
                                            add(
                                                if (it ==
                                                    0
                                                ) {
                                                    "민수"
                                                } else {
                                                    null
                                                },
                                            )
                                        }
                                    }
                                    put("mode", mode)
                                    favor?.let { put("favorIndex", it) }
                                    slot?.let { put("timeSlot", it) }
                                }.toString()
                            val favored = favor?.let { "@$it" }.orEmpty()
                            val key = "${group.joinToString("+")} $mode$favored ${slot ?: "-"}"
                            responses[key] = client.call(HttpMethod.Post, "/v1/recommend", body)
                        }
                    }
                }
            }
            responses.shouldMatchGolden("recommend.json", "recommend-raw.txt", RAW_RECOMMEND)
        }

        it("keeps every room result and link preview response") {
            val fixture = RoomFixture(stations = directory)
            val results = RoomResultService(fixture.service, recommendation())
            val api =
                ApiServices(
                    fixture.anonService,
                    fixture.service,
                    results,
                    recommendation(),
                    directory,
                    DevArtifacts.published,
                )
            val friday = LocalDate.parse("2026-11-27")
            val saturday = LocalDate.parse("2026-11-28")
            val christmas = LocalDate.parse("2026-12-25")
            // 공휴일 목록(2026-2027) 밖의 수요일: 막차 요일을 믿을 수 없다.
            val outOfRange = LocalDate.parse("2028-03-01")

            class Spec(
                val name: String,
                val mode: RoomMode,
                val date: LocalDate?,
                val time: LocalTime?,
                val band: TimeBand?,
                val origins: List<Pair<String, Boolean>>,
                val decide: String? = null,
            )
            val specs =
                listOf(
                    Spec("collecting", RoomMode.FAIR, friday, null, null, listOf("홍대입구" to false)),
                    Spec("no-date", RoomMode.FAIR, null, null, null, listOf("홍대입구" to false, "잠실" to false)),
                    Spec(
                        "friday-evening-hidden",
                        RoomMode.FAIR,
                        friday,
                        LocalTime.of(19, 30),
                        null,
                        listOf("합정" to false, "강남" to true, "김포공항" to false),
                    ),
                    Spec(
                        "saturday-night-band",
                        RoomMode.FAST,
                        saturday,
                        null,
                        TimeBand.NIGHT,
                        listOf("광교" to false, "당산" to false, "잠실" to false, "홍대입구" to true),
                    ),
                    Spec(
                        "favor-host-after-midnight",
                        RoomMode.FAVOR,
                        saturday,
                        LocalTime.of(1, 0),
                        null,
                        listOf("홍대입구" to false, "잠실" to false, "강남" to false),
                    ),
                    Spec(
                        "christmas-decided-outside-top",
                        RoomMode.FAIR,
                        christmas,
                        LocalTime.of(12, 0),
                        null,
                        listOf("홍대입구" to false, "잠실" to true),
                        decide = "김포공항",
                    ),
                    Spec(
                        "weekday-decided-top",
                        RoomMode.FAIR,
                        friday,
                        LocalTime.of(22, 0),
                        null,
                        listOf("합정" to false, "강남" to false),
                        decide = "top",
                    ),
                    Spec(
                        "out-of-range",
                        RoomMode.FAIR,
                        outOfRange,
                        null,
                        TimeBand.EVENING,
                        listOf(
                            "당산" to false,
                            "잠실" to false,
                        ),
                    ),
                )
            val responses = Recorded()
            testApplication {
                application { apiModule(unlimited, api, clock) }
                for (spec in specs) {
                    val (host, hostHidden) = spec.origins.first()
                    val created =
                        fixture.service.create(
                            CreateRoomCommand(
                                spec.mode,
                                if (spec.mode == RoomMode.FAVOR) CreateRoomCommand.HOST_TARGET else null,
                                spec.date,
                                ParticipantInput("방장", code(host), hostHidden),
                                null,
                                null,
                                spec.time,
                                spec.band,
                            ),
                        )
                    val tokens =
                        listOf(created.participantToken) +
                            spec.origins.drop(1).mapIndexed { index, (origin, hidden) ->
                                fixture.service
                                    .join(
                                        created.roomId,
                                        ParticipantInput(
                                            if (index ==
                                                0
                                            ) {
                                                null
                                            } else {
                                                "친구$index"
                                            },
                                            code(origin),
                                            hidden,
                                        ),
                                        null,
                                    ).participantToken
                            }
                    if (spec.decide != null) {
                        val seen = results.result(created.roomId, null, null, null)
                        val station =
                            if (spec.decide == "top") {
                                seen.recommendation.candidates
                                    .first()
                                    .stationCode
                            } else {
                                code(spec.decide)
                            }
                        fixture.service.decide(created.roomId, tokens.last(), station, seen.shareVersion)
                    }
                    val room = "/v1/rooms/${created.roomId}"
                    responses["${spec.name} preview"] = client.call(HttpMethod.Get, "$room/preview")
                    if (spec.origins.size < 2) continue
                    responses["${spec.name} result anonymous"] = client.call(HttpMethod.Get, "$room/result")
                    tokens.forEachIndexed { index, token ->
                        responses["${spec.name} result as #$index"] =
                            client.call(HttpMethod.Get, "$room/result", token = token)
                    }
                    for (mode in listOf("fair", "fast", "favor")) {
                        responses["${spec.name} result mode=$mode"] =
                            client.call(HttpMethod.Get, "$room/result?mode=$mode")
                    }
                    responses["${spec.name} result favor=host"] =
                        client.call(HttpMethod.Get, "$room/result?mode=favor&favor=host")
                }
            }
            responses.shouldMatchGolden("rooms.json", "rooms-raw.txt", RAW_ROOMS)
        }

        it("keeps the raw bytes when no last-train table can be read") {
            // 막차 표를 쓸 수 없으면(옛 데이터·읽기 실패) 응답에 막차 키가 하나도 없어야 한다.
            val service = RecommendationService(directory.travel, directory, locations = directory, clock = clock)
            val mocks = MockedServices()
            val api = ApiServices(mocks.anon, mocks.rooms, mocks.results, service, directory, DevArtifacts.published)
            val responses = Recorded()
            testApplication {
                application { apiModule(unlimited, api) }
                for ((mode, people) in listOf("fair" to listOf("홍대입구", "잠실"), "favor" to listOf("합정", "강남", "김포공항"))) {
                    val body =
                        buildJsonObject {
                            putJsonArray("origins") { people.forEach { add(code(it)) } }
                            put("mode", mode)
                            if (mode == "favor") put("favorIndex", 1)
                            put("timeSlot", "weekday-evening")
                        }.toString()
                    responses["$mode no-table"] = client.call(HttpMethod.Post, "/v1/recommend", body)
                }
            }
            responses.shouldMatchRaw("recommend-no-table-raw.txt", listOf("fair no-table", "favor no-table"))
        }
    })

/**
 * 상태 코드와 본문. [parsed]는 파싱한 JSON(키 순서·null 유무는 유지되지만 공백·이스케이프는 사라진다), [raw]는 서버가 보낸 글자 그대로다.
 */
private class Reply(
    val status: Int,
    val parsed: JsonElement,
    val raw: String,
)

private suspend fun HttpClient.call(
    method: HttpMethod,
    path: String,
    body: String? = null,
    token: String? = null,
): Reply {
    val response = json(method, path, body, token)
    val text = response.bodyAsText()
    val parsed =
        buildJsonObject {
            put("status", response.status.value)
            put("body", Json.parseToJsonElement(text))
        }
    return Reply(response.status.value, parsed, text)
}

private class Recorded {
    private val replies = linkedMapOf<String, Reply>()

    operator fun set(
        key: String,
        reply: Reply,
    ) {
        replies[key] = reply
    }

    /** 파싱한 JSON 전체(키 순서·null 유무 포함)와, 대표 시나리오는 원문 바이트까지 기대 파일과 같은지 본다. */
    fun shouldMatchGolden(
        parsedFile: String,
        rawFile: String,
        rawKeys: List<String>,
    ) {
        val parsed = pretty.encodeToString(JsonObject.serializer(), JsonObject(replies.mapValues { it.value.parsed }))
        parsed.plus("\n").shouldMatchFile(parsedFile)
        shouldMatchRaw(rawFile, rawKeys)
    }

    fun shouldMatchRaw(
        rawFile: String,
        rawKeys: List<String>,
    ) {
        val raw =
            rawKeys.joinToString("") { key ->
                val reply = requireNotNull(replies[key]) { "대표 시나리오가 없습니다: $key" }
                "### $key\n${reply.status}\n${reply.raw}\n"
            }
        raw.shouldMatchFile(rawFile)
    }
}

private fun String.shouldMatchFile(file: String) {
    val path = Path.of("src/test/resources/characterization", file)
    if (System.getenv("UPDATE_CHARACTERIZATION") == "1") {
        Files.createDirectories(path.parent)
        Files.writeString(path, this)
    }
    this shouldBe Files.readString(path)
}

private val unlimited = testConfig(mapOf("RATE_LIMIT_ENABLED" to "false"))

private val pretty = Json { prettyPrint = true }

/**
 * 원문 바이트까지 고정하는 대표 시나리오(막차 있음·없음·확인 필요, 지도 한가운데 있음·없음, 배려 모드).
 * 같은 값이 파싱한 전체 기대 파일에도 들어 있다.
 */
private val RAW_RECOMMEND =
    listOf(
        // 지도 한가운데 있음 + 막차 직행·여유·확인 필요가 모두 있음
        "광교+당산+잠실+홍대입구 fair weekday-day",
        // 배려 모드(지도 한가운데 없음) + 막차 직행·확인 필요
        "광교+당산+잠실+홍대입구 favor@0 weekday-day",
        // 구분 없음: 요일을 믿을 수 없어 막차는 모두 확인 필요(unavailable) + 지도 한가운데 있음
        "홍대입구+잠실 fair -",
        // 지도 한가운데 없음 + 막차 직행·여유
        "홍대입구+잠실 fast weekday-day",
        "합정+강남+김포공항 favor@1 saturday-night",
    )

private val RAW_ROOMS =
    listOf(
        "collecting preview",
        "no-date preview",
        "friday-evening-hidden preview",
        "friday-evening-hidden result anonymous",
        "friday-evening-hidden result as #1",
        "saturday-night-band result favor=host",
        "favor-host-after-midnight preview",
        "favor-host-after-midnight result as #0",
        "christmas-decided-outside-top preview",
        "weekday-decided-top preview",
    )
