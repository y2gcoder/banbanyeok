package app.banbanyeok.server.room

import io.kotest.core.spec.style.scopes.DescribeSpecRootScope
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe

/** host01과 [others]가 있는 뽑기 방(아직 안 뽑음). */
private suspend fun RoomRepository.drawRoom(others: List<String> = listOf("pid002", "pid003")): String {
    val room = aRoom(freshId()) { it.copy(mode = RoomMode.FAVOR, favorDraw = FavorDraw.PENDING) }
    create(room, listOf(aParticipant("host01")))
    for ((index, id) in others.withIndex()) {
        addParticipant(room.id, aParticipant(id, T0.plusSeconds(index + 1L)), activity(index + 1L))
    }
    return room.id
}

private suspend fun RoomRepository.draw(
    roomId: String,
    round: Int,
    minutes: Long,
    rule: FavorDrawRule = fakeDrawRule(at = T0.plusSeconds(minutes * 60)),
    generation: Int = 0,
) = writeDraw(roomId, DrawRequest(generation, round), activity(minutes), rule)

private suspend fun RoomRepository.room(roomId: String): Room = find(roomId)!!.room

internal fun DescribeSpecRootScope.favorDraws(repos: () -> RepositoryPair) {
    describe("favor draw (#172)") {
        it("stores a draw room as not drawn yet, with no favor target") {
            val rooms = repos().rooms
            val room = rooms.room(rooms.drawRoom())
            room.favorDraw shouldBe FavorDraw.PENDING
            room.favorParticipantId.shouldBeNull()
        }

        it("draws among everyone in the room, in join order, and stores the result") {
            val rooms = repos().rooms
            val roomId = rooms.drawRoom()
            val before = rooms.room(roomId)
            // 뽑은 시각은 요청 시각(activity)이 아니라 잠근 뒤 규칙의 시계에서 읽는다.
            val result = rooms.draw(roomId, 1, 5, fakeDrawRule(2, at = T0.plusSeconds(301)))
            val everyone = listOf("host01", "pid002", "pid003")
            val stored = FavorDraw(0, 1, everyone, everyone, T0.plusSeconds(301))
            result shouldBe DrawResult.Drawn("pid003", stored)
            val after = rooms.room(roomId)
            after.favorParticipantId shouldBe "pid003"
            after.favorDraw shouldBe stored
            after.lastActivityAt shouldBe activity(5).at
            after.shareVersion.value shouldBe before.shareVersion.value + 1
        }

        it("does nothing for a round the room already reached, allows one redraw and refuses more") {
            val rooms = repos().rooms
            val roomId = rooms.drawRoom()
            rooms.draw(roomId, 1, 5).shouldBeDrawn()
            val first = rooms.room(roomId)
            rooms.draw(roomId, 1, 6, fakeDrawRule(2)) shouldBe DrawResult.Unchanged
            rooms.room(roomId) shouldBe first
            rooms.draw(roomId, 2, 7, fakeDrawRule(2)).shouldBeDrawn()
            val second = rooms.room(roomId)
            second.favorDraw?.round shouldBe 2
            second.favorParticipantId shouldBe "pid003"
            rooms.draw(roomId, 3, 8) shouldBe DrawResult.LimitReached
            rooms.draw(roomId, 2, 8) shouldBe DrawResult.Unchanged
            rooms.draw(roomId, 1, 8) shouldBe DrawResult.Unchanged
            rooms.room(roomId) shouldBe second
        }

        it("refuses a room that is not a draw room, too few candidates, a skipped round and an unknown room") {
            val rooms = repos().rooms
            val plain = aRoom(freshId()) { it.copy(mode = RoomMode.FAVOR, favorParticipantId = "host01") }
            rooms.create(plain, listOf(aParticipant("host01")))
            rooms.addParticipant(plain.id, aParticipant("pid002", T0.plusSeconds(1)), activity(1))
            rooms.draw(plain.id, 1, 5) shouldBe DrawResult.NotAvailable
            val alone = rooms.drawRoom(others = emptyList())
            rooms.draw(alone, 1, 5) shouldBe DrawResult.TooFew
            rooms.room(alone).favorDraw shouldBe FavorDraw.PENDING
            rooms.draw(rooms.drawRoom(), 2, 5) shouldBe DrawResult.Stale
            rooms.draw(freshId(), 1, 5) shouldBe DrawResult.RoomNotFound
        }
    }
}

internal fun DescribeSpecRootScope.favorDrawResets(repos: () -> RepositoryPair) {
    describe("favor draw after the result (#172)") {
        it("goes back to not drawn, round 0, when the winner leaves or is removed") {
            val rooms = repos().rooms
            val roomId = rooms.drawRoom()
            rooms.draw(roomId, 1, 5).shouldBeDrawn()
            rooms.draw(roomId, 2, 6).shouldBeDrawn()
            rooms.removeParticipant(roomId, "host01", activity(7))
            val after = rooms.room(roomId)
            after.favorDraw shouldBe FavorDraw.PENDING.copy(generation = 1)
            after.favorParticipantId.shouldBeNull()
            after.mode shouldBe RoomMode.FAVOR
            // 리셋 전 세대의 요청(처음 뽑기·다시 뽑기의 재시도)은 새로 뽑지 않는다.
            rooms.draw(roomId, 1, 8) shouldBe DrawResult.Stale
            rooms.draw(roomId, 2, 8) shouldBe DrawResult.Stale
            rooms.room(roomId) shouldBe after
            rooms.draw(roomId, 1, 8, generation = 1).shouldBeDrawn()
            rooms.room(roomId).favorParticipantId shouldBe "pid002"
            rooms.room(roomId).favorDraw?.generation shouldBe 1
        }

        it("forgets who left: their ID leaves the stored draw list, and only an anonymous slot keeps the picture") {
            val rooms = repos().rooms
            val roomId = rooms.drawRoom()
            rooms.draw(roomId, 1, 5, fakeDrawRule(1)).shouldBeDrawn()
            rooms.removeParticipant(roomId, "pid003", activity(6))
            val after = rooms.room(roomId).favorDraw
            after?.candidates shouldBe listOf("host01", "pid002", FavorDraw.leftSlot(2))
            after?.roster shouldBe listOf("host01", "pid002")
            after?.round shouldBe 1
            rooms.room(roomId).favorParticipantId shouldBe "pid002"
        }

        it("keeps the result when someone other than the winner leaves") {
            val rooms = repos().rooms
            val roomId = rooms.drawRoom()
            rooms.draw(roomId, 1, 5).shouldBeDrawn()
            val drawn = rooms.room(roomId)
            rooms.removeParticipant(roomId, "pid003", activity(6))
            val after = rooms.room(roomId)
            after.favorDraw shouldBe drawn.favorDraw?.without("pid003")
            after.favorParticipantId shouldBe "host01"
        }
    }
}

internal fun DescribeSpecRootScope.favorDrawVersions(repos: () -> RepositoryPair) {
    describe("favor draw and the share version (#172)") {
        it("bumps the share version on a redraw even when the same person wins again") {
            val rooms = repos().rooms
            val roomId = rooms.drawRoom()
            rooms.draw(roomId, 1, 5).shouldBeDrawn()
            val first = rooms.room(roomId)
            rooms.draw(roomId, 2, 6).shouldBeDrawn()
            val second = rooms.room(roomId)
            second.favorParticipantId shouldBe first.favorParticipantId
            second.shareVersion.value shouldBe first.shareVersion.value + 1
        }

        it("stops being a draw room when the host sets the mode or the favor target directly") {
            val rooms = repos().rooms
            val pending = rooms.drawRoom()
            rooms.updateRoom(
                pending,
                RoomChange(mode = RoomMode.FAIR, favorParticipantId = Change.Set(null)),
                activity(5),
            )
            rooms.room(pending).favorDraw.shouldBeNull()
            val drawn = rooms.drawRoom()
            rooms.draw(drawn, 1, 5).shouldBeDrawn()
            rooms.updateRoom(drawn, RoomChange(favorParticipantId = Change.Set("pid003")), activity(6))
            val after = rooms.room(drawn)
            after.favorDraw.shouldBeNull()
            after.favorParticipantId shouldBe "pid003"
            after.mode shouldBe RoomMode.FAVOR
        }

        it("stops being a draw room when the host sets the current winner directly, and bumps the share version") {
            val rooms = repos().rooms
            val roomId = rooms.drawRoom()
            rooms.draw(roomId, 1, 5).shouldBeDrawn()
            val drawn = rooms.room(roomId)
            val same = RoomChange(favorParticipantId = Change.Set("host01"), endsDraw = true)
            rooms.updateRoom(roomId, same, activity(6)) shouldBe true
            val after = rooms.room(roomId)
            after.favorDraw.shouldBeNull()
            after.favorParticipantId shouldBe "host01"
            after.shareVersion.value shouldBe drawn.shareVersion.value + 1
        }
    }
}

private fun DrawResult.shouldBeDrawn() = (this is DrawResult.Drawn) shouldBe true
