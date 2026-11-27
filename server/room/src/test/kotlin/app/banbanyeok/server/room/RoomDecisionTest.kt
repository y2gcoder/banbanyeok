package app.banbanyeok.server.room

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.test.runTest
import java.time.LocalDate
import java.time.LocalTime

private suspend fun shouldFailWith(
    error: RoomError,
    block: suspend () -> Unit,
) {
    shouldThrow<RoomException> { block() }.error shouldBe error
}

/** 방장(03v)과 친구(130)가 있는 방. */
private class TwoPeople(
    val roomId: String,
    val hostToken: String,
    val hostId: String,
    val hostPart: String,
    val friendId: String,
    val friendPart: String,
)

private suspend fun RoomFixture.twoPeople(): TwoPeople {
    val created =
        service.create(CreateRoomCommand(RoomMode.FAIR, null, null, ParticipantInput("민수", "03v"), null, null))
    val friend = service.join(created.roomId, ParticipantInput("지연", "130"), null)
    return TwoPeople(
        created.roomId,
        created.hostToken,
        created.participantId,
        created.participantToken,
        friend.participantId,
        friend.participantToken,
    )
}

private suspend fun RoomFixture.version(roomId: String) = service.get(roomId, null).shareVersion

class RoomDecisionTest :
    DescribeSpec({
        describe("deciding the meeting station") {
            it("lets any participant decide, change and undo, and answers with the caller's view") {
                roomTest {
                    val room = twoPeople()
                    val decided = service.decide(room.roomId, room.hostPart, "225", version(room.roomId))
                    decided.decision shouldBe Decision("225", room.hostId, clock.instant())
                    decided.participants.single { it.isSelf }.id shouldBe room.hostId

                    val changed = service.decide(room.roomId, room.friendPart, "31a", decided.shareVersion)
                    changed.decision!!.decidedBy shouldBe room.friendId
                    (changed.shareVersion > decided.shareVersion) shouldBe true

                    service.decide(room.roomId, room.hostPart, null, changed.shareVersion).decision.shouldBeNull()
                }
            }

            it("rejects a screen from before an origin change and keeps the room as it was") {
                roomTest {
                    val room = twoPeople()
                    val seen = version(room.roomId)
                    service.updateParticipant(
                        room.roomId,
                        room.friendId,
                        room.friendPart,
                        ParticipantInput("지연", "225"),
                    )
                    val after = version(room.roomId)
                    shouldFailWith(RoomError.ROOM_CHANGED) { service.decide(room.roomId, room.hostPart, "31a", seen) }
                    service.get(room.roomId, null).decision.shouldBeNull()
                    version(room.roomId) shouldBe after
                }
            }

            it("accepts a screen from before a nickname, lock, mode or meeting edit") {
                val edits: List<Pair<String, suspend RoomFixture.(TwoPeople) -> Unit>> =
                    listOf(
                        "nickname" to {
                            service.updateParticipant(
                                it.roomId,
                                it.friendId,
                                it.friendPart,
                                ParticipantInput("수진", "130"),
                            )
                        },
                        "lock" to { service.updateRoom(it.roomId, it.hostToken, RoomPatch(locked = true)) },
                        "mode" to { service.updateRoom(it.roomId, it.hostToken, RoomPatch(mode = RoomMode.FAST)) },
                        "meeting" to {
                            val patch =
                                RoomPatch(
                                    meetingDate = Change.Set(LocalDate.parse("2026-11-21")),
                                    meetingTime = Change.Set(LocalTime.of(19, 0)),
                                )
                            service.updateRoom(it.roomId, it.hostToken, patch)
                        },
                    )
                for ((name, edit) in edits) {
                    roomTest {
                        val room = twoPeople()
                        val seen = version(room.roomId)
                        edit(room)
                        withClue(name) {
                            service.decide(room.roomId, room.hostPart, "225", seen).decision.shouldNotBeNull()
                        }
                    }
                }
            }

            it("keeps the decision through meeting edits") {
                roomTest {
                    val room = twoPeople()
                    service.decide(room.roomId, room.hostPart, "225", version(room.roomId))
                    service.updateRoom(
                        room.roomId,
                        room.hostToken,
                        RoomPatch(meetingTime = Change.Set(LocalTime.of(8, 0))),
                    )
                    service.get(room.roomId, null).decision!!.stationCode shouldBe "225"
                }
            }

            it("does not let a screen that never saw a decision replace it, until it refreshes") {
                roomTest {
                    val room = twoPeople()
                    val seen = version(room.roomId)
                    service.decide(room.roomId, room.hostPart, "225", seen)
                    shouldFailWith(RoomError.ROOM_CHANGED) { service.decide(room.roomId, room.friendPart, "31a", seen) }
                    shouldFailWith(RoomError.ROOM_CHANGED) { service.decide(room.roomId, room.friendPart, null, seen) }
                    service.get(room.roomId, null).decision!!.decidedBy shouldBe room.hostId

                    val replaced = service.decide(room.roomId, room.friendPart, "31a", version(room.roomId))
                    replaced.decision shouldBe Decision("31a", room.friendId, clock.instant())
                }
            }

            it("answers a repeated decide and an empty undo without writing") {
                roomTest {
                    val room = twoPeople()
                    val seen = version(room.roomId)
                    service.decide(room.roomId, room.hostPart, null, seen).shareVersion shouldBe seen
                    val decided = service.decide(room.roomId, room.hostPart, "225", seen)
                    clock.advance(java.time.Duration.ofMinutes(1))
                    val again = service.decide(room.roomId, room.friendPart, "225", seen)
                    again.shareVersion shouldBe decided.shareVersion
                    again.decision shouldBe decided.decision
                }
            }

            it("releases the decision when the decider leaves or is removed, and then refuses their token") {
                roomTest {
                    val room = twoPeople()
                    service.decide(room.roomId, room.friendPart, "225", version(room.roomId))
                    service.removeParticipant(room.roomId, room.friendId, room.hostToken)
                    service.get(room.roomId, null).decision.shouldBeNull()
                    shouldFailWith(RoomError.UNAUTHORIZED) {
                        service.decide(room.roomId, room.friendPart, "225", version(room.roomId))
                    }
                }
            }

            it("checks the caller, the station and the number of people") {
                RoomFixture(
                    stations =
                        FakeStationCatalog(
                            replacedBy = mapOf("0zz" to "225"),
                            meetingStations = setOf("130", "225"),
                        ),
                ).run {
                    runTest {
                        val room = twoPeople()
                        val seen = version(room.roomId)
                        shouldFailWith(RoomError.FORBIDDEN) { service.decide(room.roomId, room.hostToken, "225", seen) }
                        shouldFailWith(RoomError.UNAUTHORIZED) { service.decide(room.roomId, null, "225", seen) }
                        shouldFailWith(
                            RoomError.INVALID_STATION,
                        ) { service.decide(room.roomId, room.hostPart, "03v", seen) }
                        shouldFailWith(
                            RoomError.INVALID_STATION,
                        ) { service.decide(room.roomId, room.hostPart, "ZZZ", seen) }
                        service.decide(room.roomId, room.hostPart, "0zz", seen).decision!!.stationCode shouldBe "225"

                        service.removeParticipant(room.roomId, room.friendId, room.friendPart)
                        shouldFailWith(RoomError.NOT_ENOUGH_PARTICIPANTS) {
                            service.decide(room.roomId, room.hostPart, "130", version(room.roomId))
                        }
                    }
                }
            }
        }

        describe("what changes the share version") {
            it("keeps the decision when a participant saves only a nickname over a code that became deprecated") {
                runTest {
                    val rooms = InMemoryRoomRepository()
                    val before =
                        RoomFixture(rooms = rooms, stations = FakeStationCatalog(origins = setOf("03v", "130", "0zz")))
                    val created =
                        before.service.create(
                            CreateRoomCommand(RoomMode.FAIR, null, null, ParticipantInput(null, "0zz"), null, null),
                        )
                    before.service.join(created.roomId, ParticipantInput("지연", "130"), null)

                    val after =
                        RoomFixture(
                            rooms = rooms,
                            stations =
                                FakeStationCatalog(
                                    replacedBy =
                                        mapOf("0zz" to "03v"),
                                ),
                        )
                    val seen = after.service.get(created.roomId, null).shareVersion
                    after.service.decide(created.roomId, created.participantToken, "130", seen)
                    after.service.updateParticipant(
                        created.roomId,
                        created.participantId,
                        created.participantToken,
                        ParticipantInput("민수", "03v"),
                    )
                    val room = after.service.get(created.roomId, created.participantToken)
                    room.decision!!.stationCode shouldBe "130"
                    room.participants.first().originCode shouldBe "03v"
                    rooms
                        .find(created.roomId)!!
                        .participants
                        .first()
                        .originCode shouldBe "0zz"
                }
            }

            it("answers a repeat of the shown station without writing after the decided code was retired") {
                runTest {
                    val rooms = InMemoryRoomRepository()
                    val before = RoomFixture(rooms = rooms)
                    val room = before.twoPeople()
                    before.service.decide(room.roomId, room.hostPart, "225", before.version(room.roomId))
                    val after =
                        RoomFixture(rooms = rooms, stations = FakeStationCatalog(replacedBy = mapOf("225" to "31a")))
                    after.clock.advance(java.time.Duration.ofMinutes(1))
                    val screen = after.service.get(room.roomId, room.friendPart)
                    screen.decision!!.stationCode shouldBe "31a"
                    val again = after.service.decide(room.roomId, room.friendPart, "31a", screen.shareVersion)
                    again.shareVersion shouldBe screen.shareVersion
                    again.decision shouldBe screen.decision
                }
            }

            it("answers an undo of a decision the screen does not show without writing") {
                runTest {
                    val rooms = InMemoryRoomRepository()
                    val before = RoomFixture(rooms = rooms)
                    val room = before.twoPeople()
                    before.service.decide(room.roomId, room.hostPart, "225", before.version(room.roomId))
                    val after =
                        RoomFixture(rooms = rooms, stations = FakeStationCatalog(meetingStations = setOf("130", "31a")))
                    val screen = after.service.get(room.roomId, room.friendPart)
                    screen.decision.shouldBeNull()
                    after.service
                        .decide(room.roomId, room.friendPart, null, screen.shareVersion)
                        .shareVersion shouldBe screen.shareVersion
                }
            }

            it("hides a decision whose station is no longer a meeting station") {
                runTest {
                    val rooms = InMemoryRoomRepository()
                    val before = RoomFixture(rooms = rooms)
                    val room = before.twoPeople()
                    before.service.decide(room.roomId, room.hostPart, "225", before.version(room.roomId))
                    val after =
                        RoomFixture(rooms = rooms, stations = FakeStationCatalog(meetingStations = setOf("130")))
                    after.service
                        .get(room.roomId, null)
                        .decision
                        .shouldBeNull()
                }
            }
        }
    })

private fun roomTest(body: suspend RoomFixture.() -> Unit) = runTest { RoomFixture().body() }
