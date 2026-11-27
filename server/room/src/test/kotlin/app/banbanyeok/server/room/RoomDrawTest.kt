package app.banbanyeok.server.room

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.test.runTest
import java.time.Duration

private suspend fun shouldFailWith(
    error: RoomError,
    block: suspend () -> Unit,
) {
    shouldThrow<RoomException> { block() }.error shouldBe error
}

/** 방장(민수)·지연·하늘이 있는 뽑기 방. */
private class DrawRoom(
    val roomId: String,
    val hostToken: String,
    val hostId: String,
    val hostPart: String,
    val friendId: String,
    val friendPart: String,
    val thirdId: String,
    val thirdPart: String,
)

private suspend fun RoomFixture.drawRoom(): DrawRoom {
    val created =
        service.create(
            CreateRoomCommand(
                RoomMode.FAVOR,
                CreateRoomCommand.DRAW_TARGET,
                null,
                ParticipantInput("민수", "03v"),
                null,
                null,
            ),
        )
    clock.advance(Duration.ofMinutes(1))
    val friend = service.join(created.roomId, ParticipantInput("지연", "130"), null)
    clock.advance(Duration.ofMinutes(1))
    val third = service.join(created.roomId, ParticipantInput("하늘", "225"), null)
    clock.advance(Duration.ofMinutes(1))
    return DrawRoom(
        created.roomId,
        created.hostToken,
        created.participantId,
        created.participantToken,
        friend.participantId,
        friend.participantToken,
        third.participantId,
        third.participantToken,
    )
}

private fun drawTest(
    vararg picks: Int,
    body: suspend RoomFixture.() -> Unit,
) = runTest {
    RoomFixture(drawRandom = FixedDrawRandom(*(if (picks.isEmpty()) intArrayOf(0) else picks))).body()
}

class RoomDrawTest :
    DescribeSpec({
        describe("creating a draw room") {
            it("is a favor room with no target yet, and shows who would be drawn now") {
                drawTest {
                    val room = drawRoom()
                    val view = service.get(room.roomId, null)
                    view.mode shouldBe RoomMode.FAVOR
                    view.favorParticipantId.shouldBeNull()
                    view.favorDraw shouldBe
                        FavorDrawView(
                            generation = 0,
                            round = 0,
                            maxRounds = 2,
                            candidates = listOf(room.hostId, room.friendId, room.thirdId),
                            winner = null,
                            drawnAt = null,
                            excluded = emptyList(),
                        )
                }
            }

            it("has no draw state for a room whose target is the host") {
                drawTest {
                    val created =
                        service.create(
                            CreateRoomCommand(RoomMode.FAVOR, "host", null, ParticipantInput("민수", "03v"), null, null),
                        )
                    service.get(created.roomId, null).favorDraw.shouldBeNull()
                }
            }
        }

        describe("drawing") {
            it("stores one result that every viewer sees the same way") {
                drawTest(1) {
                    val room = drawRoom()
                    val drawn = service.drawFavor(room.roomId, room.hostToken, 0, 1)
                    drawn.favorParticipantId shouldBe room.friendId
                    val draw = drawn.favorDraw.shouldNotBeNull()
                    draw.round shouldBe 1
                    draw.winner shouldBe room.friendId
                    draw.candidates shouldBe listOf(room.hostId, room.friendId, room.thirdId)
                    draw.drawnAt shouldBe clock.instant()
                    for (token in listOf(null, room.hostPart, room.friendPart, room.thirdPart, room.hostToken)) {
                        val seen = service.get(room.roomId, token)
                        seen.favorDraw shouldBe draw
                        seen.favorParticipantId shouldBe room.friendId
                    }
                }
            }

            it("answers a repeated round with the stored result instead of drawing again") {
                drawTest(0, 2) {
                    val room = drawRoom()
                    val first = service.drawFavor(room.roomId, room.hostToken, 0, 1)
                    clock.advance(Duration.ofMinutes(1))
                    service.drawFavor(room.roomId, room.hostToken, 0, 1) shouldBe first
                }
            }

            it("lets only the host draw") {
                drawTest {
                    val room = drawRoom()
                    shouldFailWith(RoomError.FORBIDDEN) { service.drawFavor(room.roomId, room.hostPart, 0, 1) }
                    shouldFailWith(RoomError.FORBIDDEN) { service.drawFavor(room.roomId, room.friendPart, 0, 1) }
                    shouldFailWith(RoomError.UNAUTHORIZED) { service.drawFavor(room.roomId, null, 0, 1) }
                    shouldFailWith(RoomError.UNAUTHORIZED) { service.drawFavor(room.roomId, "wrong", 0, 1) }
                    service.get(room.roomId, null).favorDraw!!.round shouldBe 0
                }
            }

            it("allows one redraw, shown to everyone as round 2, and refuses a third") {
                drawTest(0, 2) {
                    val room = drawRoom()
                    service.drawFavor(room.roomId, room.hostToken, 0, 1).favorParticipantId shouldBe room.hostId
                    val redrawn = service.drawFavor(room.roomId, room.hostToken, 0, 2)
                    redrawn.favorParticipantId shouldBe room.thirdId
                    redrawn.favorDraw!!.round shouldBe 2
                    service.get(room.roomId, room.friendPart).favorDraw!!.round shouldBe 2
                    shouldFailWith(
                        RoomError.DRAW_LIMIT_REACHED,
                    ) { service.drawFavor(room.roomId, room.hostToken, 0, 3) }
                    service.get(room.roomId, null).favorParticipantId shouldBe room.thirdId
                }
            }

            it("draws among everyone in the room and needs two of them") {
                drawTest(1) {
                    val room = drawRoom()
                    val drawn = service.drawFavor(room.roomId, room.hostToken, 0, 1)
                    drawn.favorDraw!!.candidates shouldBe listOf(room.hostId, room.friendId, room.thirdId)
                    drawn.favorDraw.excluded shouldBe emptyList()
                    drawn.favorParticipantId shouldBe room.friendId

                    val alone =
                        service.create(
                            CreateRoomCommand(RoomMode.FAVOR, "draw", null, ParticipantInput("민수", "03v"), null, null),
                        )
                    shouldFailWith(RoomError.NOT_ENOUGH_DRAW_CANDIDATES) {
                        service.drawFavor(alone.roomId, alone.hostToken, 0, 1)
                    }
                }
            }

            it("refuses a room made without the draw and a screen from before a reset") {
                drawTest {
                    val created =
                        service.create(
                            CreateRoomCommand(RoomMode.FAVOR, "host", null, ParticipantInput("민수", "03v"), null, null),
                        )
                    service.join(created.roomId, ParticipantInput("지연", "130"), null)
                    shouldFailWith(
                        RoomError.DRAW_NOT_AVAILABLE,
                    ) { service.drawFavor(created.roomId, created.hostToken, 0, 1) }

                    val room = drawRoom()
                    shouldFailWith(RoomError.ROOM_CHANGED) { service.drawFavor(room.roomId, room.hostToken, 0, 2) }
                }
            }

            it("marks people who joined after the draw as late") {
                drawTest {
                    val created =
                        service.create(
                            CreateRoomCommand(RoomMode.FAVOR, "draw", null, ParticipantInput("민수", "03v"), null, null),
                        )
                    val friend = service.join(created.roomId, ParticipantInput("지연", "130"), null)
                    clock.advance(Duration.ofMinutes(1))
                    service.drawFavor(created.roomId, created.hostToken, 0, 1)
                    clock.advance(Duration.ofMinutes(1))
                    val late = service.join(created.roomId, ParticipantInput("하늘", "225"), null)
                    val draw = service.get(created.roomId, null).favorDraw.shouldNotBeNull()
                    draw.candidates shouldBe listOf(created.participantId, friend.participantId)
                    draw.excluded shouldBe listOf(DrawExclusion(late.participantId, DrawExclusionReason.LATE))
                }
            }
        }

        describe("after the draw") {
            it("keeps the drawn candidates (the picture) when someone other than the winner leaves") {
                drawTest(1) {
                    val room = drawRoom()
                    val drawn = service.drawFavor(room.roomId, room.hostToken, 0, 1).favorDraw.shouldNotBeNull()
                    service.removeParticipant(room.roomId, room.thirdId, room.thirdPart)
                    val after = service.get(room.roomId, null).favorDraw.shouldNotBeNull()
                    // 자리는 남고(같은 그림) 나간 사람의 ID는 남지 않는다.
                    after.candidates shouldBe listOf(room.hostId, room.friendId, FavorDraw.leftSlot(2))
                    drawn.candidates.size shouldBe after.candidates.size
                    after.excluded.map { it.participantId } shouldBe emptyList()
                    after.winner shouldBe room.friendId
                    after.round shouldBe 1
                }
            }

            it("still names someone left out by a draw made before ADR-0007 as hidden") {
                drawTest {
                    val room = drawRoom()
                    val stored = rooms.find(room.roomId).shouldNotBeNull().room
                    val everyone = listOf(room.hostId, room.friendId, room.thirdId)
                    val legacyDraw = FavorDraw(0, 1, everyone - room.thirdId, everyone, clock.instant())
                    rooms.create(
                        stored.copy(id = "legacydraw", favorDraw = legacyDraw, favorParticipantId = room.friendId),
                        rooms.find(room.roomId).shouldNotBeNull().participants,
                    )
                    service
                        .get("legacydraw", null)
                        .favorDraw
                        .shouldNotBeNull()
                        .excluded shouldBe
                        listOf(DrawExclusion(room.thirdId, DrawExclusionReason.HIDDEN))
                }
            }

            it("goes back to not drawn with the redraw count reset when the host removes the winner") {
                drawTest(0, 0, 0) {
                    val room = drawRoom()
                    service.drawFavor(room.roomId, room.hostToken, 0, 1)
                    service.drawFavor(room.roomId, room.hostToken, 0, 2)
                    service.removeParticipant(room.roomId, room.hostId, room.hostToken)
                    val reset = service.get(room.roomId, null).favorDraw.shouldNotBeNull()
                    reset.round shouldBe 0
                    reset.generation shouldBe 1
                    // 리셋 전 화면의 재시도는 새로 뽑지 않는다.
                    shouldFailWith(RoomError.ROOM_CHANGED) { service.drawFavor(room.roomId, room.hostToken, 0, 1) }
                    service.drawFavor(room.roomId, room.hostToken, 1, 1).favorParticipantId shouldBe room.friendId
                }
            }

            it("keeps the draw when the host sends favor again without a target, and ends it for a direct target") {
                drawTest {
                    val room = drawRoom()
                    service.drawFavor(room.roomId, room.hostToken, 0, 1)
                    service
                        .updateRoom(
                            room.roomId,
                            room.hostToken,
                            RoomPatch(mode = RoomMode.FAVOR),
                        ).favorDraw!!
                        .round shouldBe
                        1
                    val direct = service.updateRoom(room.roomId, room.hostToken, RoomPatch(favorTarget = room.thirdId))
                    direct.favorDraw.shouldBeNull()
                    direct.favorParticipantId shouldBe room.thirdId
                    shouldFailWith(
                        RoomError.DRAW_NOT_AVAILABLE,
                    ) { service.drawFavor(room.roomId, room.hostToken, 0, 2) }
                }
            }

            it("ends the draw when the host sets the current winner directly") {
                drawTest {
                    val room = drawRoom()
                    val winner = service.drawFavor(room.roomId, room.hostToken, 0, 1).favorParticipantId
                    val direct = service.updateRoom(room.roomId, room.hostToken, RoomPatch(favorTarget = winner))
                    direct.favorDraw.shouldBeNull()
                    direct.favorParticipantId shouldBe winner
                }
            }
        }
    })
