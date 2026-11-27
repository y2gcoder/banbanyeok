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
    val guestId: String,
    val guestToken: String,
    val thirdId: String,
)

/** 방장 03v(민수), 225(이름 없는 참가자), 31a(지연). 평일 약속. */
private suspend fun room(
    date: LocalDate? = friday,
    source: LastTrainSource = LastTrainSource { LastTrainData(sampleLastTrains, sampleLastTrainAsOf) },
): Room {
    val fixture =
        RoomFixture(
            stations = FakeStationCatalog(meetingStations = setOf("03v", "130", "225", "31a", "4xz")),
        )
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
            CreateRoomCommand(RoomMode.FAIR, null, date, ParticipantInput("민수", "03v"), null, null),
        )
    val guest = fixture.service.join(created.roomId, ParticipantInput(null, "225"), null)
    val third = fixture.service.join(created.roomId, ParticipantInput("지연", "31a"), null)
    return Room(
        fixture,
        RoomResultService(fixture.service, recommendation, testTimes),
        created.roomId,
        created.participantToken,
        created.participantId,
        guest.participantId,
        guest.participantToken,
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

class LastTrainRoomTest :
    DescribeSpec({
        describe("the link preview of a room the host filled in (#227)") {
            it(
                "carries no times or last trains before and after the draw and once decided, while the room keeps them",
            ) {
                runTest {
                    val fixture =
                        RoomFixture(stations = FakeStationCatalog(meetingStations = setOf("03v", "130", "31a", "4xz")))
                    val recommendation =
                        RecommendationService(
                            OdTravelTimeProvider(sampleOd, "20261120.1", TimeSlot.ALL.associateWith { sampleOd }),
                            codeNames,
                            lastTrains = LastTrainSource { LastTrainData(sampleLastTrains, sampleLastTrainAsOf) },
                            clock = fixture.clock,
                        )
                    val results = RoomResultService(fixture.service, recommendation, testTimes)
                    val created =
                        fixture.service.create(
                            CreateRoomCommand(
                                RoomMode.FAVOR,
                                CreateRoomCommand.DRAW_TARGET,
                                friday,
                                ParticipantInput("민수", "03v"),
                                null,
                                null,
                                others =
                                    listOf(
                                        ParticipantInput("지연", "31a"),
                                        ParticipantInput(null, "130"),
                                    ),
                            ),
                        )
                    val roomId = created.roomId
                    results
                        .result(roomId, null, null, null)
                        .recommendation.candidates
                        .first()
                        .lastTrains
                        .shouldNotBeNull()
                        .size shouldBe 3

                    fun RoomPreview.assertWithheld() {
                        room.enteredByHost shouldBe true
                        val (station, basis) =
                            when (this) {
                                is RoomPreview.Result -> station to lastTrainBasis
                                is RoomPreview.Decided -> station to lastTrainBasis
                                is RoomPreview.Collecting -> error("결과가 있어야 한다")
                            }
                        basis.shouldBeNull()
                        station.times.map { Triple(it.label, it.seconds, it.lastTrain) } shouldBe
                            (1..3).map { Triple("참가자 $it", null, null) }
                        previewJson(this).toString().let {
                            it shouldNotContain "lastTrain"
                            it shouldNotContain "민수"
                        }
                    }
                    results.preview(roomId).shouldBeInstanceOf<RoomPreview.Result>().assertWithheld()
                    fixture.service.drawFavor(roomId, created.hostToken, 0, 1)
                    results.preview(roomId).shouldBeInstanceOf<RoomPreview.Result>().assertWithheld()
                    val seen = results.result(roomId, null, null, null).shareVersion
                    fixture.service.decide(roomId, created.participantToken, "4xz", seen)
                    results.preview(roomId).shouldBeInstanceOf<RoomPreview.Decided>().assertWithheld()
                }
            }
        }

        describe("last trains in a room's result") {
            it("gives every participant's last train to every viewer") {
                runTest {
                    val room = room()
                    for (token in listOf(null, room.hostToken, room.guestToken)) {
                        val result = room.results.result(room.roomId, token, null, null).recommendation
                        result.candidates.forEach { card -> card.lastTrains.shouldNotBeNull().size shouldBe 3 }
                        result.candidates
                            .first { it.stationCode == "130" }
                            .lastTrains
                            .shouldNotBeNull()
                            .first { it.participantId == room.guestId }
                            .cell.kind shouldBe LastTrainKind.MARGIN_DIRECT
                    }
                }
            }

            it("writes the kind, the minute and the destination, and nothing for a check") {
                runTest {
                    val room = room()
                    val json = room.resultJson(room.guestToken)
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
                        """{"participantId":"${room.guestId}","kind":"margin","minute":1421,"transfer":false,""" +
                        """"boundFor":{"stationCode":"31a","stationName":"31a역"}}"""
                    at130[2] shouldBe """{"participantId":"${room.thirdId}","kind":"check"}"""
                }
            }

            it("shows no time for a room without a date: weekday is only the default there") {
                runTest {
                    val noDate = room(date = null)
                    val result = noDate.results.result(noDate.roomId, noDate.guestToken, null, null).recommendation
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
            it("carries everyone's last train by short name, without participant IDs") {
                runTest {
                    val room = room()
                    val preview = room.results.preview(room.roomId).shouldBeInstanceOf<RoomPreview.Result>()
                    preview.lastTrainBasis
                        .shouldNotBeNull()
                        .unavailable
                        .shouldBeNull()
                    preview.station.times.map { it.lastTrain != null } shouldBe listOf(true, true, true)
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
                    times.map { "lastTrain" in it } shouldBe listOf(true, true, true)
                    // 미리보기의 막차 항목에는 참가자 ID가 없다(이름표만 쓴다).
                    json.toString() shouldNotContain "participantId"
                    json.toString() shouldNotContain room.guestId
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
