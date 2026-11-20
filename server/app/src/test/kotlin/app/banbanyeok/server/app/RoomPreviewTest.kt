package app.banbanyeok.server.app

import app.banbanyeok.server.app.application.PreviewBasis
import app.banbanyeok.server.app.application.PreviewStation
import app.banbanyeok.server.app.application.PreviewTime
import app.banbanyeok.server.app.application.RoomPreview
import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.recommendation.OdTravelTimeProvider
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.codeNames
import app.banbanyeok.server.recommendation.sampleOd
import app.banbanyeok.server.recommendation.smallOd
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.FakeStationCatalog
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomFixture
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomPatch
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import io.kotest.matchers.types.shouldBeInstanceOf
import kotlinx.coroutines.test.runTest

private fun previewTest(
    od: app.banbanyeok.schema.OdMatrix = sampleOd,
    body: suspend RoomFixture.(RoomResultService) -> Unit,
) = runTest {
    val fixture = RoomFixture(stations = FakeStationCatalog(meetingStations = setOf("03v", "130", "225", "31a", "4xz")))
    val recommendation = RecommendationService(OdTravelTimeProvider(od, "20261112.1"), codeNames)
    fixture.body(RoomResultService(fixture.service, recommendation, testTimes))
}

private fun hostCommand(
    mode: RoomMode = RoomMode.FAIR,
    hidden: Boolean = false,
    nickname: String? = "민수",
) = CreateRoomCommand(
    mode,
    if (mode == RoomMode.FAVOR) CreateRoomCommand.HOST_TARGET else null,
    null,
    ParticipantInput(nickname, "03v", hidden),
    null,
    null,
)

class RoomPreviewTest :
    DescribeSpec({
        describe("the link preview of a room") {
            it("is an invite while fewer than two people have joined") {
                previewTest { results ->
                    val created = service.create(hostCommand())
                    val preview = results.preview(created.roomId).shouldBeInstanceOf<RoomPreview.Collecting>()
                    preview.room.participantCount shouldBe 1
                    preview.room.canJoin shouldBe true
                    preview.room.shareVersion shouldBe service.get(created.roomId, null).shareVersion
                }
            }

            it("shows the room-default first station with everyone's short name and time") {
                previewTest { results ->
                    val created = service.create(hostCommand())
                    service.join(created.roomId, ParticipantInput(null, "130"), null)
                    val preview = results.preview(created.roomId).shouldBeInstanceOf<RoomPreview.Result>()
                    preview.basis shouldBe PreviewBasis(RecommendMode.FAIR, null)
                    preview.station shouldBe
                        PreviewStation("130", listOf(PreviewTime("민수", 600), PreviewTime("130역", 0)))
                    preview.dataVersion shouldBe "20261112.1"
                    preview.room.canJoin shouldBe true
                }
            }

            it("names a hidden person without a nickname by room order and never carries their origin") {
                previewTest { results ->
                    val created = service.create(hostCommand(hidden = true, nickname = null))
                    service.join(created.roomId, ParticipantInput("지연", "225"), null)
                    val preview = results.preview(created.roomId).shouldBeInstanceOf<RoomPreview.Result>()
                    preview.station.stationCode shouldBe "130"
                    preview.station.times.map { it.label } shouldBe listOf("참가자 1", "지연")
                    preview.toString() shouldNotContain "03v"
                }
            }

            it("cannot be joined when the room is full or locked") {
                previewTest { results ->
                    val full = service.create(hostCommand())
                    listOf("130", "225", "31a").forEach { service.join(full.roomId, ParticipantInput(null, it), null) }
                    results.preview(full.roomId).room.canJoin shouldBe false

                    val locked = service.create(hostCommand())
                    service.join(locked.roomId, ParticipantInput(null, "130"), null)
                    service.updateRoom(locked.roomId, locked.hostToken, RoomPatch(locked = true))
                    results.preview(locked.roomId).room.canJoin shouldBe false
                }
            }

            it("shows the decided station with its times even when it is outside the top three") {
                previewTest { results ->
                    val created = service.create(hostCommand())
                    val friend = service.join(created.roomId, ParticipantInput("지연", "130"), null)
                    val seen = results.result(created.roomId, null, null, null).shareVersion
                    service.decide(created.roomId, friend.participantToken, "4xz", seen)
                    val preview = results.preview(created.roomId).shouldBeInstanceOf<RoomPreview.Decided>()
                    preview.station shouldBe
                        PreviewStation("4xz", listOf(PreviewTime("민수", 2400), PreviewTime("지연", 1200)))
                    preview.decidedBy shouldBe "지연"
                    preview.decidedAt shouldBe clock.instant()
                }
            }

            it("falls back to an invite when nobody can reach a common station") {
                val apart =
                    smallOd(listOf("03v", "130"), listOf("03v", "130"), listOf(listOf(0, null), listOf(null, 0)))
                previewTest(apart) { results ->
                    val created = service.create(hostCommand())
                    service.join(created.roomId, ParticipantInput(null, "130"), null)
                    results.preview(created.roomId).shouldBeInstanceOf<RoomPreview.Collecting>()
                }
            }
        }

        describe("the room-default favor target") {
            it("is the first participant after the favored person leaves, for both the result and the preview") {
                previewTest { results ->
                    val created = service.create(hostCommand(RoomMode.FAVOR))
                    val favored = service.join(created.roomId, ParticipantInput("지연", "130"), null)
                    service.join(created.roomId, ParticipantInput("수진", "225"), null)
                    service.updateRoom(
                        created.roomId,
                        created.hostToken,
                        RoomPatch(favorTarget = favored.participantId),
                    )
                    service.removeParticipant(created.roomId, favored.participantId, favored.participantToken)

                    val first =
                        results
                            .result(created.roomId, null, null, null)
                            .recommendation.candidates
                            .first()
                    first.favoredSeconds shouldBe first.times[0].seconds
                    val preview = results.preview(created.roomId).shouldBeInstanceOf<RoomPreview.Result>()
                    preview.basis shouldBe PreviewBasis(RecommendMode.FAVOR, "민수")
                }
            }
        }
    })
