package app.banbanyeok.server.app

import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomFixture
import app.banbanyeok.server.room.RoomMode
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import io.ktor.client.HttpClient
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.LocalDate
import java.time.LocalTime

private val directory = DevArtifacts.directory

private fun codeOf(name: String): String = directory.originCodes.first { directory.nameOf(it) == name }

private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content

private fun JsonObject.secondsOf(key: String) =
    getValue(key).jsonArray.map {
        it.jsonObject
            .text("seconds")
            .toInt()
    }

/** 실제 dev 산출물(역 좌표 포함)로 방을 만들고 미리보기·무상태 추천을 같은 서버에서 부른다. */
private class Rooms {
    val fixture = RoomFixture(stations = directory)
    private val recommendation = RecommendationService(directory.travel, directory, locations = directory)
    val api =
        apiServices(
            fixture.anonService,
            fixture.service,
            RoomResultService(fixture.service, recommendation, testTimes),
            recommendation,
            directory,
            DevArtifacts.published,
        )

    /** 방장은 "방장", 나머지는 이름 없이 들어온다. [origins]는 (역 이름, 숨김). 마지막 사람의 참여 토큰을 돌려준다. */
    suspend fun create(
        mode: RoomMode,
        origins: List<Pair<String, Boolean>>,
        date: LocalDate? = null,
        time: LocalTime? = null,
    ): Pair<String, String> {
        val (host, hostHidden) = origins.first()
        val created =
            fixture.service.create(
                CreateRoomCommand(
                    mode,
                    null,
                    date,
                    ParticipantInput("방장", codeOf(host), hostHidden),
                    null,
                    null,
                    time,
                ),
            )
        var last = created.participantToken
        for ((origin, hidden) in origins.drop(1)) {
            last =
                fixture.service
                    .join(
                        created.roomId,
                        ParticipantInput(null, codeOf(origin), hidden),
                        null,
                    ).participantToken
        }
        return created.roomId to last
    }
}

private suspend fun HttpClient.preview(roomId: String): Pair<JsonObject, String> {
    val response = json(HttpMethod.Get, "/v1/rooms/$roomId/preview")
    response.status shouldBe HttpStatusCode.OK
    OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/$roomId/preview", response)
    val raw = response.bodyAsText()
    return Json.parseToJsonElement(raw).jsonObject to raw
}

private fun roomTest(body: suspend ApplicationTestBuilder.(Rooms) -> Unit) {
    val rooms = Rooms()
    testApplication {
        application { apiModule(testConfig(mapOf("RATE_LIMIT_ENABLED" to "false")), rooms.api) }
        body(rooms)
    }
}

/**
 * 방 링크 미리보기의 "지도 한가운데" 비교(#68 2단계). 미리보기를 만든 같은 평가에서 나오므로 같은 출발역·같은 구분의 `/recommend`와
 * 값이 같아야 하고, 출발역을 숨긴 사람이 있으면 키 자체가 없어야 한다(숨긴 출발역을 평균점에서 거꾸로 짐작할 수 있다).
 */
class RoomPreviewMapMiddleHttpTest :
    DescribeSpec({
        describe("GET /v1/rooms/{roomId}/preview mapMiddle") {
            it("is the /recommend comparison of the same origins and time slot, named by the preview's short names") {
                roomTest { rooms ->
                    // 홍대입구·잠실: 공평 1위 신당, 지도 한가운데 한강진(MapMiddleHttpTest와 같은 조합).
                    var shown = 0
                    val meetings =
                        listOf(
                            null to null,
                            LocalDate.parse("2026-11-27") to LocalTime.of(19, 30),
                            LocalDate.parse("2026-11-28") to LocalTime.of(23, 0),
                            LocalDate.parse("2026-11-29") to LocalTime.of(9, 0),
                        )
                    for ((date, time) in meetings) {
                        val (roomId, _) =
                            rooms.create(
                                RoomMode.FAIR,
                                listOf("홍대입구" to false, "잠실" to false),
                                date,
                                time,
                            )
                        val (preview, _) = client.preview(roomId)
                        val slot =
                            preview
                                .getValue("room")
                                .jsonObject
                                .getValue("timeBasis")
                                .jsonObject
                                .text("timeSlot")
                        val stateless =
                            Json
                                .parseToJsonElement(
                                    client
                                        .json(
                                            HttpMethod.Post,
                                            "/v1/recommend",
                                            """{"origins":["${codeOf(
                                                "홍대입구",
                                            )}","${codeOf("잠실")}"],"mode":"fair","timeSlot":"$slot"}""",
                                        ).bodyAsText(),
                                ).jsonObject
                        val expected = stateless["mapMiddle"]?.jsonObject
                        val middle = preview["mapMiddle"]?.jsonObject
                        (middle == null) shouldBe (expected == null)
                        if (middle == null || expected == null) continue
                        shown += 1
                        middle.text("stationCode") shouldBe expected.text("stationCode")
                        middle.text("stationName") shouldBe expected.text("stationName")
                        middle.secondsOf("times") shouldBe expected.secondsOf("times")
                        val labels = middle.getValue("times").jsonArray.map { it.jsonObject.text("label") }
                        labels shouldBe
                            preview
                                .getValue("station")
                                .jsonObject
                                .getValue("times")
                                .jsonArray
                                .map { it.jsonObject.text("label") }
                        // 이름표와 시간만 싣는다: 출발역·참여자 ID 칸이 없다.
                        middle.getValue("times").jsonArray.forEach {
                            it.jsonObject.keys shouldBe
                                setOf("label", "seconds")
                        }
                    }
                    (shown > 0) shouldBe true
                }
            }

            it("leaves the key out entirely when anyone hides their origin") {
                roomTest { rooms ->
                    for (hidden in listOf(listOf(false, true), listOf(true, false), listOf(true, true))) {
                        val (roomId, _) = rooms.create(RoomMode.FAIR, listOf("홍대입구", "잠실").zip(hidden))
                        val (preview, raw) = client.preview(roomId)
                        preview.text("stage") shouldBe "result"
                        preview.containsKey("mapMiddle") shouldBe false
                        raw shouldNotContain "mapMiddle"
                        raw shouldNotContain "한강진"
                    }
                }
            }

            it("leaves the key out for a fast room and for a decided station") {
                roomTest { rooms ->
                    val (fast, _) = rooms.create(RoomMode.FAST, listOf("홍대입구" to false, "잠실" to false))
                    client.preview(fast).first.containsKey("mapMiddle") shouldBe false

                    val (fair, token) = rooms.create(RoomMode.FAIR, listOf("홍대입구" to false, "잠실" to false))
                    client
                        .preview(fair)
                        .first["mapMiddle"]
                        .shouldNotBeNull()
                    val seen =
                        rooms.fixture.service
                            .get(fair, null)
                            .shareVersion
                    rooms.fixture.service.decide(fair, token, codeOf("신당"), seen)
                    val (decided, _) = client.preview(fair)
                    decided.text("stage") shouldBe "decided"
                    decided.containsKey("mapMiddle") shouldBe false
                }
            }
        }
    })
