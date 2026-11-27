package app.banbanyeok.server.room

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.test.runTest

private suspend fun shouldFailWith(
    error: RoomError,
    block: suspend () -> Unit,
) {
    shouldThrow<RoomException> { block() }.error shouldBe error
}

/** 방장(민수, 03v)과 지연(130). 지연은 ADR-0007 전에 출발역을 숨긴 채 들어와 지금도 숨긴 상태다. */
private class WithheldRoom(
    val fixture: RoomFixture,
    val roomId: String,
    val hostToken: String,
    val hostPart: String,
    val hostId: String,
    val friendId: String,
    val friendPart: String,
)

private fun withheldRoom(body: suspend WithheldRoom.() -> Unit) =
    runTest {
        val fixture = RoomFixture()
        val created =
            fixture.service.create(
                CreateRoomCommand(RoomMode.FAIR, null, null, ParticipantInput("민수", "03v"), null, null),
            )
        val friend = fixture.service.join(created.roomId, ParticipantInput("지연", "130"), null)
        fixture.rooms.hideAsBefore(created.roomId, friend.participantId)
        WithheldRoom(
            fixture,
            created.roomId,
            created.hostToken,
            created.participantToken,
            created.participantId,
            friend.participantId,
            friend.participantToken,
        ).body()
    }

/** ADR-0012: 숨긴 참가자가 남은 방은 내용을 보여 주지 않고, 그 방의 자격이 있는 사람에게 지우기만 열어 둔다. */
class RoomWithheldTest :
    DescribeSpec({
        describe("a room where someone is still hidden from before ADR-0007") {
            it("is a missing room to anyone without that room's token") {
                withheldRoom {
                    val other =
                        fixture.service.create(
                            CreateRoomCommand(RoomMode.FAIR, null, null, ParticipantInput(null, "225"), null, null),
                        )
                    for (token in listOf(null, "garbage-token", other.hostToken, other.participantToken)) {
                        withClue("token=$token") {
                            shouldFailWith(RoomError.ROOM_NOT_FOUND) { fixture.service.get(roomId, token) }
                            shouldFailWith(RoomError.ROOM_NOT_FOUND) { fixture.service.loadForResult(roomId, token) }
                            shouldFailWith(RoomError.ROOM_NOT_FOUND) { fixture.service.delete(roomId, token) }
                            shouldFailWith(RoomError.ROOM_NOT_FOUND) {
                                fixture.service.removeParticipant(roomId, friendId, token)
                            }
                        }
                    }
                    shouldFailWith(RoomError.ROOM_NOT_FOUND) {
                        fixture.service.join(roomId, ParticipantInput(null, "225"), null)
                    }
                }
            }

            it("tells the room's own tokens it cannot be opened, for every read and every change but deleting") {
                withheldRoom {
                    val service = fixture.service
                    for (token in listOf(hostToken, hostPart, friendPart)) {
                        withClue("token=$token") {
                            shouldFailWith(RoomError.ROOM_WITHHELD) { service.get(roomId, token) }
                            shouldFailWith(RoomError.ROOM_WITHHELD) { service.loadForResult(roomId, token) }
                            shouldFailWith(RoomError.ROOM_WITHHELD) {
                                service.updateRoom(roomId, token, RoomPatch(locked = true))
                            }
                            shouldFailWith(RoomError.ROOM_WITHHELD) {
                                service.decide(roomId, token, "225", ShareVersion(99))
                            }
                            shouldFailWith(RoomError.ROOM_WITHHELD) { service.drawFavor(roomId, token, 0, 1) }
                            shouldFailWith(RoomError.ROOM_WITHHELD) {
                                service.recordOutcome(roomId, token, Outcome(OutcomeKind.TOP1, null))
                            }
                            shouldFailWith(RoomError.ROOM_WITHHELD) {
                                service.updateParticipant(roomId, friendId, token, ParticipantInput("지연", "225"))
                            }
                        }
                    }
                    shouldFailWith(
                        RoomError.ROOM_WITHHELD,
                    ) { service.checkJoinReplay(roomId, friendId, friendPart, "130") }
                    // 방장이 다른 사람을 내보내거나 참여자가 방을 지우는 것은 지우기라도 그 사람의 권한이 아니다.
                    shouldFailWith(RoomError.ROOM_WITHHELD) { service.removeParticipant(roomId, friendId, hostToken) }
                    shouldFailWith(RoomError.ROOM_WITHHELD) { service.delete(roomId, friendPart) }
                    fixture.rooms
                        .find(roomId)
                        ?.participants
                        ?.map { it.id } shouldBe listOf(hostId, friendId)
                }
            }

            it("lets the host delete the whole room with the host token") {
                withheldRoom {
                    fixture.service.delete(roomId, hostToken)
                    fixture.rooms.find(roomId).shouldBeNull()
                }
            }

            it("lets a participant delete their own entry, and opens the room again once nobody is hidden") {
                withheldRoom {
                    fixture.service.removeParticipant(roomId, hostId, hostPart)
                    shouldFailWith(RoomError.ROOM_WITHHELD) { fixture.service.get(roomId, friendPart) }
                    fixture.service.removeParticipant(roomId, friendId, friendPart)
                    fixture.rooms
                        .find(roomId)
                        ?.participants
                        .orEmpty()
                        .map { it.id } shouldContainExactly emptyList()
                    fixture.service
                        .get(roomId, hostToken)
                        .participants
                        .map { it.id } shouldContainExactly emptyList()
                }
            }

            it("does not hand a withheld room back to a creation retry") {
                withheldRoom {
                    fixture.service.creationReplayExpiry(roomId, hostToken, hostId, hostPart).shouldBeNull()
                }
            }

            it(
                "hands a draw-room retry with the same recovery key back its room, which stays withheld but can be deleted",
            ) {
                runTest {
                    val fixture = RoomFixture()
                    val command =
                        CreateRoomCommand(
                            RoomMode.FAVOR,
                            CreateRoomCommand.DRAW_TARGET,
                            null,
                            ParticipantInput("민수", "03v"),
                            null,
                            null,
                            others = listOf(ParticipantInput("지연", "130")),
                        )
                    val created = fixture.service.createDrawRoom(command, "recovery-key-1")
                    val entered =
                        fixture.rooms
                            .find(created.roomId)!!
                            .participants
                            .single { it.enteredByHost }
                    fixture.rooms.hideAsBefore(created.roomId, entered.id)
                    val again = fixture.service.createDrawRoom(command, "recovery-key-1")
                    again.roomId shouldBe created.roomId
                    again.hostToken shouldBe created.hostToken
                    again.recovered shouldBe true
                    fixture.rooms.find("room000002").shouldBeNull()
                    shouldFailWith(
                        RoomError.ROOM_WITHHELD,
                    ) { fixture.service.get(created.roomId, again.participantToken) }
                    fixture.service.delete(created.roomId, again.hostToken)
                    fixture.rooms.find(created.roomId).shouldBeNull()
                }
            }
        }
    })
