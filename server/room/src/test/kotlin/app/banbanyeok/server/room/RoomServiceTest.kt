package app.banbanyeok.server.room

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.test.runTest
import java.time.Duration
import java.time.Instant
import java.time.LocalDate

private fun roomTest(body: suspend RoomFixture.() -> Unit) = runTest { RoomFixture().body() }

private fun host(
    origin: String = "03v",
    nickname: String? = "민수",
    hidden: Boolean = false,
) = ParticipantInput(nickname, origin, hidden)

private fun command(
    mode: RoomMode = RoomMode.FAIR,
    favorTarget: String? = null,
    meetingDate: LocalDate? = null,
    expectedCount: Int? = null,
    deviceToken: String? = null,
    hostInput: ParticipantInput = host(),
) = CreateRoomCommand(mode, favorTarget, meetingDate, hostInput, expectedCount, deviceToken)

private suspend fun shouldFailWith(
    error: RoomError,
    block: suspend () -> Unit,
) {
    shouldThrow<RoomException> { block() }.error shouldBe error
}

class RoomServiceTest :
    DescribeSpec({
        describe("creating a room") {
            it("returns capability tokens and a seven day expiry, and stores only hashes") {
                roomTest {
                    val created = service.create(command())
                    created.expiresAt shouldBe clock.instant().plus(Duration.ofDays(7))
                    val stored = rooms.find(created.roomId)!!
                    stored.room.hostHash shouldBe tokens.hash(created.hostToken)
                    stored.participants.single().tokenHash shouldBe tokens.hash(created.participantToken)
                    (created.hostToken != created.participantToken) shouldBe true
                    stored.room.dataVersion shouldBe "20261112.1"
                    stored.room.hostParticipantId shouldBe created.participantId
                }
            }

            it("expires on the day after the meeting date (Korean time), capped at thirty days") {
                roomTest {
                    val soon = service.create(command(meetingDate = LocalDate.parse("2026-11-16")))
                    soon.expiresAt shouldBe Instant.parse("2026-11-16T15:00:00Z")
                    val far = service.create(command(meetingDate = LocalDate.parse("2027-03-01")))
                    far.expiresAt shouldBe clock.instant().plus(Duration.ofDays(30))
                }
            }

            it("rejects bad input") {
                roomTest {
                    shouldFailWith(
                        RoomError.INVALID_STATION,
                    ) { service.create(command(hostInput = host(origin = "zzz"))) }
                    shouldFailWith(RoomError.INVALID_NICKNAME) {
                        service.create(command(hostInput = host(nickname = "가".repeat(21))))
                    }
                    shouldFailWith(RoomError.INVALID_NICKNAME) {
                        service.create(command(hostInput = host(nickname = "a\u0007b")))
                    }
                    shouldFailWith(RoomError.INVALID_MEETING_DATE) {
                        service.create(command(meetingDate = LocalDate.parse("2026-11-13")))
                    }
                    shouldFailWith(RoomError.INVALID_EXPECTED_COUNT) { service.create(command(expectedCount = 5)) }
                    shouldFailWith(RoomError.FAVOR_TARGET_REQUIRED) { service.create(command(mode = RoomMode.FAVOR)) }
                    shouldFailWith(RoomError.FAVOR_TARGET_UNKNOWN) {
                        service.create(command(mode = RoomMode.FAVOR, favorTarget = "someone"))
                    }
                }
            }

            it("accepts twenty emoji as a nickname and trims blanks to no nickname") {
                roomTest {
                    service.create(command(hostInput = host(nickname = "🙂".repeat(20))))
                    val created = service.create(command(hostInput = host(nickname = "   ")))
                    rooms
                        .find(created.roomId)!!
                        .participants
                        .single()
                        .nickname
                        .shouldBeNull()
                }
            }

            it("targets the host when favoring on creation") {
                roomTest {
                    val created =
                        service.create(
                            command(mode = RoomMode.FAVOR, favorTarget = CreateRoomCommand.HOST_TARGET),
                        )
                    service.get(created.roomId, null).favorParticipantId shouldBe created.participantId
                }
            }

            it("links the room to the anonymous user of a valid device token and ignores an unknown one") {
                roomTest {
                    val anon = anonService.issue()
                    val linked = service.create(command(deviceToken = anon.deviceToken))
                    rooms.find(linked.roomId)!!.room.hostAnonId shouldBe anon.anonUserId
                    val unlinked = service.create(command(deviceToken = "not-a-device-token"))
                    rooms
                        .find(unlinked.roomId)!!
                        .room.hostAnonId
                        .shouldBeNull()
                }
            }
        }

        describe("joining a room") {
            it("adds the participant with their own token and slides the expiry") {
                roomTest {
                    val created = service.create(command())
                    clock.advance(Duration.ofDays(3))
                    val joined = service.join(created.roomId, host("130", "지연"), null)
                    val view = service.get(created.roomId, joined.participantToken)
                    view.participants.map { it.nickname } shouldContainExactly listOf("민수", "지연")
                    view.expiresAt shouldBe clock.instant().plus(Duration.ofDays(7))
                    view.participants.single { it.isSelf }.id shouldBe joined.participantId
                }
            }

            it("refuses a fifth participant, a locked room and a room that reached expectedCount") {
                roomTest {
                    val created = service.create(command())
                    repeat(3) { service.join(created.roomId, host("130"), null) }
                    shouldFailWith(RoomError.ROOM_FULL) { service.join(created.roomId, host("130"), null) }

                    val locked = service.create(command())
                    service.updateRoom(locked.roomId, locked.hostToken, RoomPatch(locked = true))
                    shouldFailWith(RoomError.ROOM_LOCKED) { service.join(locked.roomId, host("130"), null) }

                    val expected = service.create(command(expectedCount = 2))
                    service.join(expected.roomId, host("130"), null)
                    shouldFailWith(RoomError.ROOM_FULL) { service.join(expected.roomId, host("130"), null) }
                    service.get(expected.roomId, null).locked shouldBe true
                }
            }

            it("rejects an unknown room and unknown stations") {
                roomTest {
                    shouldFailWith(RoomError.ROOM_NOT_FOUND) { service.join("abcdefghjk", host(), null) }
                    val created = service.create(command())
                    shouldFailWith(RoomError.INVALID_STATION) { service.join(created.roomId, host("zzz"), null) }
                }
            }

            it("accepts the room id in upper case") {
                roomTest {
                    val created = service.create(command())
                    service.get(created.roomId.uppercase(), null).id shouldBe created.roomId
                }
            }
        }

        describe("expiry") {
            it("treats a room as gone seven days after its last activity") {
                roomTest {
                    val created = service.create(command())
                    clock.advance(Duration.ofDays(7).minusSeconds(1))
                    service.get(created.roomId, null).id shouldBe created.roomId
                    clock.advance(Duration.ofSeconds(1))
                    shouldFailWith(RoomError.ROOM_NOT_FOUND) { service.get(created.roomId, null) }
                    shouldFailWith(RoomError.ROOM_NOT_FOUND) { service.join(created.roomId, host(), null) }
                }
            }

            it("never lets activity extend a room beyond thirty days from creation") {
                roomTest {
                    val created = service.create(command())
                    repeat(4) {
                        clock.advance(Duration.ofDays(6))
                        service.join(created.roomId, host("130"), null).also { joined ->
                            service.removeParticipant(created.roomId, joined.participantId, joined.participantToken)
                        }
                    }
                    clock.advance(Duration.ofDays(5))
                    service.get(created.roomId, null).expiresAt shouldBe created.expiresAt.plus(Duration.ofDays(23))
                    clock.advance(Duration.ofDays(1))
                    shouldFailWith(RoomError.ROOM_NOT_FOUND) { service.get(created.roomId, null) }
                }
            }

            it("physically deletes expired rooms on cleanup") {
                roomTest {
                    val old = service.create(command())
                    clock.advance(Duration.ofDays(8))
                    val fresh = service.create(command())
                    cleanup.run() shouldBe CleanupReport(rooms = 1, anonUsers = 0)
                    rooms.find(old.roomId).shouldBeNull()
                    (rooms.find(fresh.roomId) != null) shouldBe true
                }
            }

            it("deletes anonymous users that were inactive for ninety days and own no rooms") {
                roomTest {
                    anonService.issue()
                    clock.advance(Duration.ofDays(91))
                    cleanup.run().anonUsers shouldBe 1
                }
            }
        }

        describe("hiding the origin") {
            it("masks only the origin name of hidden participants for everyone but themselves") {
                roomTest {
                    val created = service.create(command(hostInput = host("03v", "민수", hidden = true)))
                    val friend = service.join(created.roomId, host("130", "지연", hidden = true), null)
                    service.join(created.roomId, host("225", "서준"), null)

                    val anonymous = service.get(created.roomId, null).participants
                    anonymous.map { it.originCode } shouldContainExactly listOf(null, null, "225")
                    anonymous.map { it.hidden } shouldContainExactly listOf(true, true, false)
                    anonymous.map { it.nickname } shouldContainExactly listOf("민수", "지연", "서준")

                    val asFriend = service.get(created.roomId, friend.participantToken).participants
                    asFriend.map { it.originCode } shouldContainExactly listOf(null, "130", "225")
                    asFriend.map { it.isSelf } shouldContainExactly listOf(false, true, false)

                    val asHostOnly = service.get(created.roomId, created.hostToken).participants
                    asHostOnly.map { it.originCode } shouldContainExactly listOf(null, null, "225")
                    asHostOnly.map { it.isHost } shouldContainExactly listOf(true, false, false)

                    service.get(created.roomId, "garbage-token").participants.map { it.originCode } shouldContainExactly
                        listOf(null, null, "225")
                }
            }

            it("keeps real origins in the compute context so results can use hidden times") {
                roomTest {
                    val created = service.create(command(hostInput = host("03v", "민수", hidden = true)))
                    service.join(created.roomId, host("130", "지연"), null)
                    service
                        .loadForResult(
                            created.roomId,
                            null,
                        ).computeParticipants
                        .map { it.originCode } shouldContainExactly
                        listOf("03v", "130")
                }
            }
        }

        describe("authorization") {
            it("lets participants edit only their own entry") {
                roomTest {
                    val created = service.create(command())
                    val friend = service.join(created.roomId, host("130", "지연"), null)
                    val updated =
                        service.updateParticipant(
                            created.roomId,
                            friend.participantId,
                            friend.participantToken,
                            ParticipantInput("서준", "225", true),
                        )
                    updated.nickname shouldBe "서준"
                    updated.hidden shouldBe true
                    updated.originCode shouldBe "225"

                    val input = host("225")
                    shouldFailWith(RoomError.FORBIDDEN) {
                        service.updateParticipant(created.roomId, created.participantId, friend.participantToken, input)
                    }
                    shouldFailWith(RoomError.FORBIDDEN) {
                        service.updateParticipant(created.roomId, friend.participantId, created.hostToken, input)
                    }
                    shouldFailWith(RoomError.UNAUTHORIZED) {
                        service.updateParticipant(created.roomId, friend.participantId, null, input)
                    }
                    shouldFailWith(RoomError.UNAUTHORIZED) {
                        service.updateParticipant(created.roomId, friend.participantId, "wrong", input)
                    }
                    shouldFailWith(RoomError.PARTICIPANT_NOT_FOUND) {
                        service.updateParticipant(created.roomId, "nobody", friend.participantToken, input)
                    }
                }
            }

            it("lets a participant leave and the host remove anyone, but not other participants") {
                roomTest {
                    val created = service.create(command())
                    val friend = service.join(created.roomId, host("130"), null)
                    val other = service.join(created.roomId, host("225"), null)
                    shouldFailWith(RoomError.FORBIDDEN) {
                        service.removeParticipant(created.roomId, other.participantId, friend.participantToken)
                    }
                    service.removeParticipant(created.roomId, friend.participantId, friend.participantToken)
                    service.removeParticipant(created.roomId, other.participantId, created.hostToken)
                    service.get(created.roomId, null).participants.map { it.id } shouldContainExactly
                        listOf(created.participantId)
                    shouldFailWith(RoomError.PARTICIPANT_NOT_FOUND) {
                        service.removeParticipant(created.roomId, other.participantId, created.hostToken)
                    }
                }
            }

            it("keeps the room settings and deletion to the host") {
                roomTest {
                    val created = service.create(command())
                    val friend = service.join(created.roomId, host("130"), null)
                    shouldFailWith(RoomError.FORBIDDEN) {
                        service.updateRoom(created.roomId, friend.participantToken, RoomPatch(locked = true))
                    }
                    shouldFailWith(
                        RoomError.UNAUTHORIZED,
                    ) { service.updateRoom(created.roomId, null, RoomPatch(locked = true)) }
                    shouldFailWith(RoomError.FORBIDDEN) { service.delete(created.roomId, friend.participantToken) }
                    service.delete(created.roomId, created.hostToken)
                    shouldFailWith(RoomError.ROOM_NOT_FOUND) { service.get(created.roomId, null) }
                }
            }
        }

        describe("changing the room") {
            it("switches mode with a favor target and clears the target when leaving favor mode") {
                roomTest {
                    val created = service.create(command())
                    val friend = service.join(created.roomId, host("130"), null)
                    shouldFailWith(RoomError.FAVOR_TARGET_REQUIRED) {
                        service.updateRoom(created.roomId, created.hostToken, RoomPatch(mode = RoomMode.FAVOR))
                    }
                    shouldFailWith(RoomError.FAVOR_TARGET_UNKNOWN) {
                        service.updateRoom(
                            created.roomId,
                            created.hostToken,
                            RoomPatch(mode = RoomMode.FAVOR, favorTarget = "nobody"),
                        )
                    }
                    val favor =
                        service.updateRoom(
                            created.roomId,
                            created.hostToken,
                            RoomPatch(mode = RoomMode.FAVOR, favorTarget = friend.participantId),
                        )
                    favor.mode shouldBe RoomMode.FAVOR
                    favor.favorParticipantId shouldBe friend.participantId
                    val fast = service.updateRoom(created.roomId, created.hostToken, RoomPatch(mode = RoomMode.FAST))
                    fast.favorParticipantId.shouldBeNull()
                }
            }

            it("sets and clears the meeting date and recomputes the expiry") {
                roomTest {
                    val created = service.create(command())
                    val dated =
                        service.updateRoom(
                            created.roomId,
                            created.hostToken,
                            RoomPatch(meetingDate = Change.Set(LocalDate.parse("2026-11-15"))),
                        )
                    dated.meetingDate shouldBe LocalDate.parse("2026-11-15")
                    dated.expiresAt shouldBe Instant.parse("2026-11-15T15:00:00Z")
                    val cleared =
                        service.updateRoom(
                            created.roomId,
                            created.hostToken,
                            RoomPatch(meetingDate = Change.Set(null)),
                        )
                    cleared.meetingDate.shouldBeNull()
                    cleared.expiresAt shouldBe clock.instant().plus(Duration.ofDays(7))
                    shouldFailWith(RoomError.INVALID_MEETING_DATE) {
                        service.updateRoom(
                            created.roomId,
                            created.hostToken,
                            RoomPatch(meetingDate = Change.Set(LocalDate.parse("2026-01-01"))),
                        )
                    }
                }
            }
        }

        describe("recording the outcome") {
            it("accepts a participant's answer and rejects the host token and bad station codes") {
                roomTest {
                    val created = service.create(command())
                    service.recordOutcome(created.roomId, created.participantToken, Outcome(OutcomeKind.OTHER, "130"))
                    rooms
                        .find(created.roomId)!!
                        .room.outcome!!
                        .stationCode shouldBe "130"
                    shouldFailWith(RoomError.INVALID_OUTCOME) {
                        service.recordOutcome(
                            created.roomId,
                            created.participantToken,
                            Outcome(OutcomeKind.OTHER, "ZZZ"),
                        )
                    }
                    shouldFailWith(RoomError.FORBIDDEN) {
                        service.recordOutcome(created.roomId, created.hostToken, Outcome(OutcomeKind.TOP1, null))
                    }
                    shouldFailWith(RoomError.UNAUTHORIZED) {
                        service.recordOutcome(created.roomId, null, Outcome(OutcomeKind.TOP1, null))
                    }
                }
            }
        }
    })
