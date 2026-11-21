package app.banbanyeok.server.app

import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.app.application.RoomPreview
import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.app.application.StationDirectory
import app.banbanyeok.server.app.http.apiJson
import app.banbanyeok.server.app.http.toDto
import app.banbanyeok.server.recommendation.OdTravelTimeProvider
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.codeNames
import app.banbanyeok.server.recommendation.lasttrain.LastTrainData
import app.banbanyeok.server.recommendation.lasttrain.LastTrainSource
import app.banbanyeok.server.recommendation.lasttrain.LastTrainUnavailable
import app.banbanyeok.server.recommendation.sampleLastTrainAsOf
import app.banbanyeok.server.recommendation.sampleLastTrains
import app.banbanyeok.server.recommendation.sampleOd
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.FakeStationCatalog
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomFixture
import app.banbanyeok.server.room.RoomMode
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import io.kotest.matchers.types.shouldBeInstanceOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.LocalDate

/** 2026-11-27(금): 공휴일 목록 안의 평일. 표의 수집일(2026-11-16)에서 120일 안이다. */
private val friday: LocalDate = LocalDate.parse("2026-11-27")

private class Room(
    val fixture: RoomFixture,
    val results: RoomResultService,
    val roomId: String,
    val hostToken: String,
    val hostId: String,
    val hiddenId: String,
    val hiddenToken: String,
    val thirdId: String,
)

/** 방장 03v(민수), 출발역을 숨긴 [hiddenOrigin](참가자), 31a(지연). 평일 약속. */
private suspend fun room(
    hiddenOrigin: String = "225",
    date: LocalDate? = friday,
    source: LastTrainSource = LastTrainSource { LastTrainData(sampleLastTrains, sampleLastTrainAsOf) },
): Room {
    val fixture = RoomFixture(stations = FakeStationCatalog(meetingStations = setOf("03v", "130", "225", "31a", "4xz")))
    val slots = TimeSlot.ALL.associateWith { sampleOd }
    val recommendation =
        RecommendationService(
            OdTravelTimeProvider(sampleOd, "20261120.1", slots),
            codeNames,
            lastTrains = source,
            clock = fixture.clock,
        )
    val created =
        fixture.service.create(
            CreateRoomCommand(RoomMode.FAIR, null, date, ParticipantInput("민수", "03v", false), null, null),
        )
    val hidden = fixture.service.join(created.roomId, ParticipantInput(null, hiddenOrigin, true), null)
    val third = fixture.service.join(created.roomId, ParticipantInput("지연", "31a", false), null)
    return Room(
        fixture,
        RoomResultService(fixture.service, recommendation, testTimes),
        created.roomId,
        created.participantToken,
        created.participantId,
        hidden.participantId,
        hidden.participantToken,
        third.participantId,
    )
}

private val directory: StationDirectory get() = DevArtifacts.directory

private suspend fun Room.resultJson(token: String?): JsonObject =
    apiJson
        .encodeToJsonElement(
            app.banbanyeok.server.app.http.ResultDto
                .serializer(),
            results.result(roomId, token, null, null).toDto(directory),
        ).jsonObject

private fun JsonObject.lastTrainIds(): List<List<String>> =
    getValue("candidates").jsonArray.map { card ->
        card.jsonObject
            .getValue("lastTrains")
            .jsonArray
            .map {
                it.jsonObject
                    .getValue("participantId")
                    .jsonPrimitive.content
            }
    }

class LastTrainRoomTest :
    DescribeSpec({
        describe("last trains in a room's result") {
            it("gives the hidden participant's last train to that participant only") {
                runTest {
                    val room = room()
                    val everyone = room.results.result(room.roomId, null, null, null).recommendation
                    val visible =
                        everyone.candidates
                            .first()
                            .lastTrains
                            .shouldNotBeNull()
                            .map { it.participantId }
                    visible.size shouldBe 2
                    (room.hiddenId in visible) shouldBe false
                    // 다른 참여자(방장)의 토큰으로도 숨긴 사람의 막차는 없다.
                    val asHost = room.results.result(room.roomId, room.hostToken, null, null).recommendation
                    asHost.candidates.forEach { card ->
                        (room.hiddenId in card.lastTrains.shouldNotBeNull().map { it.participantId }) shouldBe false
                    }
                    val own = room.results.result(room.roomId, room.hiddenToken, null, null).recommendation
                    own.candidates.forEach { card -> card.lastTrains.shouldNotBeNull().size shouldBe 3 }
                    own.candidates
                        .first { it.stationCode == "130" }
                        .lastTrains
                        .shouldNotBeNull()
                        .first { it.participantId == room.hiddenId }
                        .cell.kind shouldBe LastTrainKind.MARGIN_DIRECT
                }
            }

            it("serializes the same last trains for others whatever station the hidden participant comes from") {
                runTest {
                    // 숨긴 사람의 출발역만 다른 두 방. 다른 사람이 받는 JSON의 막차 부분은 같은 후보에서 글자까지 같다.
                    val one = room(hiddenOrigin = "225").resultJson(null)
                    val other = room(hiddenOrigin = "130").resultJson(null)

                    fun JsonObject.byStation() =
                        getValue("candidates").jsonArray.associate {
                            it.jsonObject
                                .getValue("stationCode")
                                .jsonPrimitive.content to
                                it.jsonObject.getValue("lastTrains").toString()
                        }
                    val shared = one.byStation().keys.intersect(other.byStation().keys)
                    shared.isNotEmpty() shouldBe true
                    shared.forEach { one.byStation().getValue(it) shouldBe other.byStation().getValue(it) }
                    one.getValue("lastTrainBasis") shouldBe other.getValue("lastTrainBasis")
                    one.lastTrainIds().forEach { it.size shouldBe 2 }
                }
            }

            it("writes the kind, the minute and the destination, and nothing for a check") {
                runTest {
                    val room = room()
                    val json = room.resultJson(room.hiddenToken)
                    json.getValue("lastTrainBasis").toString() shouldBe """{"dayType":"weekday","asOf":"2026-11-16"}"""
                    val at130 =
                        json
                            .getValue("candidates")
                            .jsonArray
                            .map { it.jsonObject }
                            .first { it.getValue("stationCode").jsonPrimitive.content == "130" }
                            .getValue("lastTrains")
                            .jsonArray
                            .map { it.toString() }
                    at130[0] shouldBe
                        """{"participantId":"${room.hostId}","kind":"direct","minute":1443,""" +
                        """"boundFor":{"stationCode":"4xz","stationName":"4xz역"}}"""
                    at130[1] shouldBe
                        """{"participantId":"${room.hiddenId}","kind":"margin","minute":1421,"transfer":false,""" +
                        """"boundFor":{"stationCode":"31a","stationName":"31a역"}}"""
                    at130[2] shouldBe """{"participantId":"${room.thirdId}","kind":"check"}"""
                }
            }

            it("shows no time for a room without a date: weekday is only the default there") {
                runTest {
                    val noDate = room(date = null)
                    val result = noDate.results.result(noDate.roomId, noDate.hiddenToken, null, null).recommendation
                    result.lastTrainBasis?.unavailable shouldBe LastTrainUnavailable.DAY_UNKNOWN
                    result.candidates.forEach { card ->
                        card.lastTrains
                            .shouldNotBeNull()
                            .map { it.cell.kind }
                            .distinct() shouldBe
                            listOf(LastTrainKind.UNKNOWN)
                    }
                    noDate.resultJson(null).getValue("lastTrainBasis").toString() shouldBe
                        """{"dayType":"weekday","asOf":"2026-11-16","unavailable":"day_unknown"}"""
                }
            }
        }

        describe("last trains in a room's link preview") {
            it("never carries the hidden participant's last train, whoever asks") {
                runTest {
                    val room = room()
                    val preview = room.results.preview(room.roomId).shouldBeInstanceOf<RoomPreview.Result>()
                    preview.lastTrainBasis
                        .shouldNotBeNull()
                        .unavailable
                        .shouldBeNull()
                    preview.station.times.map { it.lastTrain != null } shouldBe listOf(true, false, true)
                    val json =
                        apiJson
                            .encodeToJsonElement(
                                app.banbanyeok.server.app.http.RoomPreviewDto
                                    .serializer(),
                                preview.toDto(directory),
                            ).jsonObject
                    val times =
                        json
                            .getValue("station")
                            .jsonObject
                            .getValue("times")
                            .jsonArray
                            .map { it.jsonObject }
                    times.map { "lastTrain" in it } shouldBe listOf(true, false, true)
                    // 미리보기의 막차 항목에는 참가자 ID가 없다(이름표만 쓴다).
                    json.toString() shouldNotContain "participantId"
                    json.toString() shouldNotContain room.hiddenId
                }
            }

            it(
                "says the table is still loading (so the room picture is cached only briefly), only when waiting would add last trains",
            ) {
                runTest {
                    val loading =
                        object : LastTrainSource {
                            override fun current(): LastTrainData? = null

                            override fun pending(): Boolean = true
                        }
                    val dated = room(source = loading)
                    val result = dated.results.preview(dated.roomId).shouldBeInstanceOf<RoomPreview.Result>()
                    result.lastTrainPending shouldBe true
                    result.lastTrainBasis.shouldBeNull()
                    result.station.times.map { it.lastTrain } shouldBe listOf(null, null, null)
                    previewJson(result)["lastTrainPending"]?.jsonPrimitive?.content shouldBe "true"

                    val seen = dated.results.result(dated.roomId, null, null, null).shareVersion
                    dated.fixture.service.decide(dated.roomId, dated.hostToken, "4xz", seen)
                    val decided = dated.results.preview(dated.roomId).shouldBeInstanceOf<RoomPreview.Decided>()
                    decided.lastTrainPending shouldBe true
                    previewJson(decided)["lastTrainPending"]?.jsonPrimitive?.content shouldBe "true"

                    // 약속 날짜가 없는 방은 표가 와도 요일을 몰라 시각이 붙지 않으므로 알리지 않는다.
                    val undated = room(date = null, source = loading)
                    val noDate = undated.results.preview(undated.roomId).shouldBeInstanceOf<RoomPreview.Result>()
                    noDate.lastTrainPending shouldBe false
                    ("lastTrainPending" in previewJson(noDate)) shouldBe false

                    // 표를 다 읽었으면 키가 없다.
                    val ready = room()
                    val loaded = ready.results.preview(ready.roomId).shouldBeInstanceOf<RoomPreview.Result>()
                    loaded.lastTrainPending shouldBe false
                    ("lastTrainPending" in previewJson(loaded)) shouldBe false
                }
            }
        }
    })

private fun previewJson(preview: RoomPreview): JsonObject =
    apiJson
        .encodeToJsonElement(
            app.banbanyeok.server.app.http.RoomPreviewDto
                .serializer(),
            preview.toDto(directory),
        ).jsonObject
