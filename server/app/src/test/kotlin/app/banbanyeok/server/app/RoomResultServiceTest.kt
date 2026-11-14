package app.banbanyeok.server.app

import app.banbanyeok.server.app.application.AppException
import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.recommendation.OdTravelTimeProvider
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.codeNames
import app.banbanyeok.server.recommendation.sampleOd
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.ErrorKind
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomFixture
import app.banbanyeok.server.room.RoomMode
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import kotlinx.coroutines.test.runTest

private fun resultTest(body: suspend (RoomFixture, RoomResultService) -> Unit) =
    runTest {
        val fixture = RoomFixture()
        val recommendation = RecommendationService(OdTravelTimeProvider(sampleOd, "20261112.1"), codeNames)
        body(fixture, RoomResultService(fixture.service, recommendation))
    }

private fun create(
    mode: RoomMode = RoomMode.FAIR,
    favorTarget: String? = null,
    origin: String = "03v",
    hidden: Boolean = false,
) = CreateRoomCommand(mode, favorTarget, null, ParticipantInput("민수", origin, hidden), null, null)

class RoomResultServiceTest :
    DescribeSpec({
        describe("computing a room's result") {
            it("uses hidden participants' real stations for the times but hides their station in the participants") {
                resultTest { fixture, results ->
                    val created = fixture.service.create(create(origin = "03v", hidden = true))
                    fixture.service.join(created.roomId, ParticipantInput("지연", "130", false), null)
                    val result = results.result(created.roomId, null, null, null)
                    result.recommendation.candidates
                        .first()
                        .stationCode shouldBe "130"
                    result.recommendation.candidates
                        .first()
                        .times
                        .map { it.seconds } shouldContainExactly
                        listOf(600, 0)
                    result.participants.map { it.originCode } shouldContainExactly listOf(null, "130")
                }
            }

            it("shows a hidden participant their own station when they send their token") {
                resultTest { fixture, results ->
                    val created = fixture.service.create(create(hidden = true))
                    fixture.service.join(created.roomId, ParticipantInput("지연", "130", false), null)
                    val result = results.result(created.roomId, created.participantToken, null, null)
                    result.participants.map { it.originCode } shouldContainExactly listOf("03v", "130")
                    result.participants.map { it.isSelf } shouldContainExactly listOf(true, false)
                }
            }

            it("names participants by nickname or by A/B/C/D in room order, never with first-person words") {
                resultTest { fixture, results ->
                    val anonymous =
                        fixture.service.create(
                            CreateRoomCommand(
                                RoomMode.FAIR,
                                null,
                                null,
                                ParticipantInput(null, "03v", false),
                                null,
                                null,
                            ),
                        )
                    fixture.service.join(anonymous.roomId, ParticipantInput(null, "130", false), null)
                    val reasons =
                        results
                            .result(
                                anonymous.roomId,
                                null,
                                null,
                                null,
                            ).recommendation.candidates
                            .joinToString { it.reason }
                    reasons shouldContain "A"
                    reasons shouldNotContain "나는"
                    reasons shouldNotContain "친구"

                    val named = fixture.service.create(create())
                    fixture.service.join(named.roomId, ParticipantInput("지연", "130", false), null)
                    results
                        .result(
                            named.roomId,
                            null,
                            null,
                            null,
                        ).recommendation.candidates
                        .first()
                        .reason shouldContain
                        "민수"
                }
            }

            it("needs at least two participants") {
                resultTest { fixture, results ->
                    val created = fixture.service.create(create())
                    val e = shouldThrow<AppException> { results.result(created.roomId, null, null, null) }
                    e.kind shouldBe ErrorKind.CONFLICT
                    e.code shouldBe "NOT_ENOUGH_PARTICIPANTS"
                }
            }

            it("favors the room's target by default and lets the request override mode and target") {
                resultTest { fixture, results ->
                    val created = fixture.service.create(create(RoomMode.FAVOR, CreateRoomCommand.HOST_TARGET))
                    val friend = fixture.service.join(created.roomId, ParticipantInput("지연", "225", false), null)
                    results.result(created.roomId, null, null, null).recommendation.mode shouldBe RecommendMode.FAVOR
                    val fast = results.result(created.roomId, null, RecommendMode.FAST, null)
                    fast.recommendation.candidates
                        .first()
                        .reasonCode shouldBe "FAST_TOTAL"
                    val other = results.result(created.roomId, null, RecommendMode.FAVOR, friend.participantId)
                    other.recommendation.candidates
                        .first()
                        .favoredSeconds shouldBe
                        other.recommendation.candidates
                            .first()
                            .times[1]
                            .seconds
                    val host = results.result(created.roomId, null, RecommendMode.FAVOR, "host")
                    host.recommendation.candidates
                        .first()
                        .favoredSeconds shouldBe
                        host.recommendation.candidates
                            .first()
                            .times[0]
                            .seconds
                }
            }

            it("asks for a favor target when the mode is favor and nobody is targeted") {
                resultTest { fixture, results ->
                    val created = fixture.service.create(create())
                    fixture.service.join(created.roomId, ParticipantInput("지연", "225", false), null)
                    val e =
                        shouldThrow<AppException> { results.result(created.roomId, null, RecommendMode.FAVOR, null) }
                    e.kind shouldBe ErrorKind.INVALID
                    e.code shouldBe "FAVOR_TARGET_REQUIRED"
                }
            }

            it("reports a station that is no longer in the data as a conflict") {
                resultTest { fixture, _ ->
                    val created = fixture.service.create(create())
                    fixture.service.join(created.roomId, ParticipantInput("지연", "225", false), null)
                    val shrunk =
                        RecommendationService(
                            OdTravelTimeProvider(
                                app.banbanyeok.server.recommendation.smallOd(
                                    listOf("03v"),
                                    listOf("03v"),
                                    listOf(listOf(0)),
                                ),
                                "20261113.1",
                            ),
                            codeNames,
                        )
                    val e =
                        shouldThrow<AppException> {
                            RoomResultService(
                                fixture.service,
                                shrunk,
                            ).result(created.roomId, null, null, null)
                        }
                    e.code shouldBe "STATION_UNAVAILABLE"
                }
            }
        }
    })
