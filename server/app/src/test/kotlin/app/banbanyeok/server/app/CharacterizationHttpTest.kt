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
            val responses = linkedMapOf<String, JsonElement>()
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
            responses.shouldMatchGolden("recommend.json")
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
            val responses = linkedMapOf<String, JsonElement>()
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
            responses.shouldMatchGolden("rooms.json")
        }
    })

private val unlimited = testConfig(mapOf("RATE_LIMIT_ENABLED" to "false"))

private val pretty = Json { prettyPrint = true }

/** 상태 코드와 본문(JSON). */
private suspend fun HttpClient.call(
    method: HttpMethod,
    path: String,
    body: String? = null,
    token: String? = null,
): JsonElement {
    val response = json(method, path, body, token)
    return buildJsonObject {
        put("status", response.status.value)
        put("body", Json.parseToJsonElement(response.bodyAsText()))
    }
}

private fun Map<String, JsonElement>.shouldMatchGolden(file: String) {
    val actual = pretty.encodeToString(JsonObject.serializer(), JsonObject(this)) + "\n"
    val path = Path.of("src/test/resources/characterization", file)
    if (System.getenv("UPDATE_CHARACTERIZATION") == "1") {
        Files.createDirectories(path.parent)
        Files.writeString(path, actual)
    }
    actual shouldBe Files.readString(path)
}
