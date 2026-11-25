package app.banbanyeok.server.room

import io.kotest.core.spec.style.scopes.DescribeSpecRootScope
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe

/** host01·pid002·pid003이 있는 뽑기 방(아직 안 뽑음). [hidden]에 든 사람은 출발역을 숨겼다. */
private suspend fun RoomRepository.drawRoom(hidden: Set<String> = emptySet()): String {
    val room = aRoom(freshId()) { it.copy(mode = RoomMode.FAVOR, favorDraw = FavorDraw.PENDING) }
    create(room, aParticipant("host01") { it.copy(hidden = "host01" in hidden) })
    for ((index, id) in listOf("pid002", "pid003").withIndex()) {
        addParticipant(
            room.id,
            aParticipant(id, T0.plusSeconds(index + 1L)) { it.copy(hidden = id in hidden) },
            activity(index + 1L),
        )
    }
    return room.id
}

private suspend fun RoomRepository.draw(
    roomId: String,
    round: Int,
    minutes: Long,
    rule: FavorDrawRule = fakeDrawRule,
    generation: Int = 0,
) = writeDraw(roomId, DrawRequest(generation, round, T0.plusSeconds(minutes * 60)), activity(minutes), rule)

private suspend fun RoomRepository.room(roomId: String): Room = find(roomId)!!.room

internal fun DescribeSpecRootScope.favorDraws(repos: () -> RepositoryPair) {
    describe("favor draw (#172)") {
        it("stores a draw room as not drawn yet, with no favor target") {
            val rooms = repos().rooms
            val room = rooms.room(rooms.drawRoom())
            room.favorDraw shouldBe FavorDraw.PENDING
            room.favorParticipantId.shouldBeNull()
        }

        it("draws among the participants who did not hide their origin, in join order, and stores the result") {
            val rooms = repos().rooms
            val roomId = rooms.drawRoom(hidden = setOf("pid002"))
            val before = rooms.room(roomId)
            val result = rooms.draw(roomId, 1, 5, FavorDrawRule(FixedDrawRandom(1)))
            val stored =
                FavorDraw(0, 1, listOf("host01", "pid003"), listOf("host01", "pid002", "pid003"), T0.plusSeconds(300))
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
            rooms.draw(roomId, 1, 6, FavorDrawRule(FixedDrawRandom(2))) shouldBe DrawResult.Unchanged
            rooms.room(roomId) shouldBe first
            rooms.draw(roomId, 2, 7, FavorDrawRule(FixedDrawRandom(2))).shouldBeDrawn()
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
            rooms.create(plain, aParticipant("host01"))
            rooms.addParticipant(plain.id, aParticipant("pid002", T0.plusSeconds(1)), activity(1))
            rooms.draw(plain.id, 1, 5) shouldBe DrawResult.NotAvailable
            val hiddenRoom = rooms.drawRoom(hidden = setOf("pid002", "pid003"))
            rooms.draw(hiddenRoom, 1, 5) shouldBe DrawResult.TooFew
            rooms.room(hiddenRoom).favorDraw shouldBe FavorDraw.PENDING
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

        it("keeps the result when someone other than the winner leaves") {
            val rooms = repos().rooms
            val roomId = rooms.drawRoom()
            rooms.draw(roomId, 1, 5).shouldBeDrawn()
            val drawn = rooms.room(roomId)
            rooms.removeParticipant(roomId, "pid003", activity(6))
            val after = rooms.room(roomId)
            after.favorDraw shouldBe drawn.favorDraw
            after.favorParticipantId shouldBe "host01"
        }

        it("goes back to not drawn when the winner can no longer be a candidate, and only then") {
            val rooms = repos().rooms
            val roomId = rooms.drawRoom()
            rooms.draw(roomId, 1, 5).shouldBeDrawn()
            val hide = ParticipantChange(null, "03v", true, T0.plusSeconds(400), releasesDrawWin = true)
            rooms.updateParticipant(roomId, "pid002", hide, activity(6))
            rooms.room(roomId).favorParticipantId shouldBe "host01"
            rooms.updateParticipant(roomId, "host01", hide, activity(7))
            val after = rooms.room(roomId)
            after.favorDraw shouldBe FavorDraw.PENDING.copy(generation = 1)
            after.favorParticipantId.shouldBeNull()
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
