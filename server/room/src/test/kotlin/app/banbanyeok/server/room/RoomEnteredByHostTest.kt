package app.banbanyeok.server.room

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.test.runTest
import java.time.LocalDate

private suspend fun shouldFailWith(
    error: RoomError,
    block: suspend () -> Unit,
) {
    shouldThrow<RoomException> { block() }.error shouldBe error
}

private fun drawCommand(
    others: List<ParticipantInput>,
    hostPosition: Int = 0,
    host: ParticipantInput = ParticipantInput("지연", "130"),
    mode: RoomMode = RoomMode.FAVOR,
    favorTarget: String? = CreateRoomCommand.DRAW_TARGET,
    expectedCount: Int? = null,
    meetingDate: LocalDate? = null,
) = CreateRoomCommand(
    mode,
    favorTarget,
    meetingDate,
    host,
    expectedCount,
    null,
    others = others,
    hostPosition = hostPosition,
)

private val minsu = ParticipantInput("민수", "03v")
private val nameless = ParticipantInput(null, "225")

class RoomEnteredByHostTest :
    DescribeSpec({
        describe("creating a draw room with the other people already entered") {
            it("keeps the original input order with the host at its position, and marks who the host entered") {
                runTest {
                    val fixture = RoomFixture()
                    val created = fixture.service.create(drawCommand(listOf(minsu, nameless), hostPosition = 1))
                    val view = fixture.service.get(created.roomId, created.participantToken)
                    view.participants.map { Triple(it.nickname, it.originCode, it.enteredByHost) } shouldBe
                        listOf(
                            Triple("민수", "03v", true),
                            Triple("지연", "130", false),
                            Triple(null, "225", true),
                        )
                    view.participants.map { it.isHost } shouldBe listOf(false, true, false)
                    view.participants.single { it.isSelf }.id shouldBe created.participantId
                }
            }

            it("starts locked so nobody joins as a duplicate of a row already entered") {
                runTest {
                    val fixture = RoomFixture()
                    val created = fixture.service.create(drawCommand(listOf(minsu)))
                    fixture.service.get(created.roomId, null).locked shouldBe true
                    shouldFailWith(RoomError.ROOM_LOCKED) {
                        fixture.service.join(created.roomId, ParticipantInput("하늘", "31a"), null)
                    }
                }
            }

            it("draws among everyone in input order, and the drawn person is the same on every read") {
                runTest {
                    val fixture = RoomFixture(drawRandom = FixedDrawRandom(2))
                    val created = fixture.service.create(drawCommand(listOf(minsu, nameless), hostPosition = 1))
                    val before = fixture.service.get(created.roomId, null)
                    before.favorDraw!!.candidates shouldBe before.participants.map { it.id }
                    val drawn = fixture.service.drawFavor(created.roomId, created.hostToken, 0, 1)
                    val third = before.participants[2].id
                    drawn.favorParticipantId shouldBe third
                    fixture.service.get(created.roomId, null).favorParticipantId shouldBe third
                    fixture.service.get(created.roomId, created.participantToken).favorParticipantId shouldBe third
                }
            }

            it("gives nobody a working token for a row the host entered, and the host can still remove it") {
                runTest {
                    val fixture = RoomFixture()
                    val created = fixture.service.create(drawCommand(listOf(minsu)))
                    val entered =
                        fixture.service
                            .get(created.roomId, null)
                            .participants
                            .single { it.enteredByHost }
                    shouldFailWith(RoomError.FORBIDDEN) {
                        fixture.service.updateParticipant(created.roomId, entered.id, created.participantToken, minsu)
                    }
                    shouldFailWith(RoomError.FORBIDDEN) {
                        fixture.service.updateParticipant(created.roomId, entered.id, created.hostToken, minsu)
                    }
                    fixture.service.removeParticipant(created.roomId, entered.id, created.hostToken)
                    fixture.service
                        .get(created.roomId, null)
                        .participants
                        .map { it.id } shouldBe
                        listOf(created.participantId)
                }
            }

            it("is only for draw rooms, so other people's origins are stored only for the draw") {
                runTest {
                    val fixture = RoomFixture()
                    shouldFailWith(RoomError.INVALID_OTHERS) {
                        fixture.service.create(drawCommand(listOf(minsu), mode = RoomMode.FAIR, favorTarget = null))
                    }
                    shouldFailWith(RoomError.INVALID_OTHERS) {
                        fixture.service.create(drawCommand(listOf(minsu), favorTarget = CreateRoomCommand.HOST_TARGET))
                    }
                }
            }

            it("rejects more people than the room holds and a host position outside the input order") {
                runTest {
                    val fixture = RoomFixture()
                    val four = listOf(minsu, nameless, ParticipantInput("하늘", "31a"), ParticipantInput("별", "03v"))
                    shouldFailWith(RoomError.INVALID_OTHERS) { fixture.service.create(drawCommand(four)) }
                    shouldFailWith(RoomError.INVALID_OTHERS) {
                        fixture.service.create(drawCommand(listOf(minsu, nameless), expectedCount = 2))
                    }
                    shouldFailWith(RoomError.INVALID_OTHERS) {
                        fixture.service.create(drawCommand(listOf(minsu), hostPosition = 2))
                    }
                    shouldFailWith(RoomError.INVALID_OTHERS) {
                        fixture.service.create(drawCommand(emptyList(), hostPosition = 1))
                    }
                }
            }

            it("rejects a hidden or unknown origin before anything is stored") {
                runTest {
                    val fixture = RoomFixture()
                    shouldFailWith(RoomError.HIDE_NOT_AVAILABLE) {
                        fixture.service.create(drawCommand(listOf(minsu.copy(hidden = true))))
                    }
                    shouldFailWith(RoomError.INVALID_STATION) {
                        fixture.service.create(drawCommand(listOf(minsu, ParticipantInput("하늘", "zzz"))))
                    }
                    fixture.rooms.find("room000001") shouldBe null
                }
            }

            it("leaves rooms without other people exactly as before: open, host only, host not marked") {
                runTest {
                    val fixture = RoomFixture()
                    val created = fixture.service.create(drawCommand(emptyList()))
                    val view = fixture.service.get(created.roomId, null)
                    view.locked shouldBe false
                    view.participants.map { it.isHost to it.enteredByHost } shouldBe listOf(true to false)
                }
            }
        }

        describe("recovering a filled draw room with the creator's recovery key (#227)") {
            val key = "k".repeat(40)

            it("returns the same room with fresh creator tokens; the old ones stop working and nothing else changes") {
                runTest {
                    val fixture = RoomFixture()
                    val first =
                        fixture.service.createDrawRoom(
                            drawCommand(listOf(minsu, nameless), hostPosition = 1),
                            key,
                        )
                    val before = fixture.rooms.find(first.roomId)!!
                    val again =
                        fixture.service.createDrawRoom(
                            drawCommand(listOf(minsu, nameless), hostPosition = 1),
                            key,
                        )

                    again.roomId shouldBe first.roomId
                    again.participantId shouldBe first.participantId
                    again.recovered shouldBe true
                    first.recovered shouldBe false
                    (again.hostToken == first.hostToken) shouldBe false
                    (again.participantToken == first.participantToken) shouldBe false
                    val after = fixture.rooms.find(first.roomId)!!
                    after.participants.map { it.id to it.enteredByHost } shouldBe
                        before.participants.map { it.id to it.enteredByHost }
                    after.room.copy(hostHash = before.room.hostHash) shouldBe before.room
                    fixture.service
                        .get(first.roomId, first.participantToken)
                        .participants
                        .none { it.isSelf } shouldBe true
                    fixture.service
                        .get(first.roomId, again.participantToken)
                        .participants
                        .single { it.isSelf }
                        .id shouldBe again.participantId
                    shouldThrow<RoomException> { fixture.service.delete(first.roomId, first.hostToken) }
                    fixture.service.delete(first.roomId, again.hostToken)
                    fixture.rooms.find(first.roomId) shouldBe null
                }
            }

            it("makes a new room for another key, after the recovery window, or once the room is gone") {
                runTest {
                    val fixture = RoomFixture()
                    val first = fixture.service.createDrawRoom(drawCommand(listOf(minsu)), key)
                    val other = fixture.service.createDrawRoom(drawCommand(listOf(minsu)), "o".repeat(40))
                    (other.roomId == first.roomId) shouldBe false

                    fixture.clock.advance(java.time.Duration.ofHours(25))
                    val late = fixture.service.createDrawRoom(drawCommand(listOf(minsu)), key)
                    (late.roomId == first.roomId) shouldBe false
                    late.recovered shouldBe false
                    fixture.service.createDrawRoom(drawCommand(listOf(minsu)), key).roomId shouldBe late.roomId

                    fixture.service.delete(
                        late.roomId,
                        fixture.service.createDrawRoom(drawCommand(listOf(minsu)), key).hostToken,
                    )
                    val afterDelete = fixture.service.createDrawRoom(drawCommand(listOf(minsu)), key)
                    (afterDelete.roomId == late.roomId) shouldBe false
                    afterDelete.recovered shouldBe false
                }
            }

            it("does not recover an expired room still waiting for cleanup: the key moves to the new room") {
                runTest {
                    val fixture = RoomFixture()
                    val tonight = LocalDate.parse("2026-11-14")
                    val first = fixture.service.createDrawRoom(drawCommand(listOf(minsu), meetingDate = tonight), key)
                    fixture.clock.advance(java.time.Duration.ofHours(23))
                    val next = fixture.service.createDrawRoom(drawCommand(listOf(minsu)), key)
                    (next.roomId == first.roomId) shouldBe false
                    fixture.service.createDrawRoom(drawCommand(listOf(minsu)), key).roomId shouldBe next.roomId
                }
            }

            it("keeps plain room creation free of recovery: the same input twice makes two rooms") {
                runTest {
                    val fixture = RoomFixture()
                    val a = fixture.service.create(drawCommand(listOf(minsu)))
                    val b = fixture.service.create(drawCommand(listOf(minsu)))
                    (a.roomId == b.roomId) shouldBe false
                }
            }
        }
    })
