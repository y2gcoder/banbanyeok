package app.banbanyeok.server.room

import io.kotest.core.spec.style.describeSpec
import io.kotest.core.spec.style.scopes.DescribeSpecRootScope
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

private val T0 = Instant.parse("2026-11-14T00:00:00Z")

private fun freshId() =
    UUID
        .randomUUID()
        .toString()
        .replace("-", "")
        .map {
            "0123456789abcdefghjkmnpqrstvwxyz"[
                it.code %
                    32,
            ]
        }.take(10)
        .joinToString("")

private fun activity(
    minutes: Long,
    expiresInDays: Long = 7,
) = Activity(
    T0.plus(Duration.ofMinutes(minutes)),
    T0.plus(Duration.ofMinutes(minutes)).plus(Duration.ofDays(expiresInDays)),
)

/** RoomRepository·AnonUserRepository 구현이 모두 통과해야 하는 계약. 메모리 fake와 Exposed(Postgres) 구현이 같은 테스트를 돈다. */
fun roomRepositoryContract(newRepositories: () -> RepositoryPair) =
    describeSpec {
        createAndFind(newRepositories)
        addingParticipants(newRepositories)
        changingParticipants(newRepositories)
        changingRooms(newRepositories)
        removingRooms(newRepositories)
        anonUsers(newRepositories)
    }

private fun DescribeSpecRootScope.createAndFind(repos: () -> RepositoryPair) {
    describe("create and find") {
        it("returns null for an unknown room") {
            repos().rooms.find(freshId()).shouldBeNull()
        }

        it("stores the room with its host participant and returns every field") {
            val rooms = repos().rooms
            val room = aRoom(freshId()) { it.copy(expectedCount = 3, meetingDate = LocalDate.parse("2026-12-01")) }
            val host = aParticipant("host01") { it.copy(nickname = "민수", hidden = true, originCode = "130") }
            rooms.create(room, host)
            val stored = rooms.find(room.id).shouldNotBeNull()
            stored.room shouldBe room
            stored.participants shouldBe listOf(host)
        }

        it("returns participants in join order") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, aParticipant("host01", T0))
            rooms.addParticipant(room.id, aParticipant("zzzzzz", T0.plusSeconds(1)), activity(1))
            rooms.addParticipant(room.id, aParticipant("aaaaaa", T0.plusSeconds(2)), activity(2))
            rooms.find(room.id)!!.participants.map { it.id } shouldContainExactly listOf("host01", "zzzzzz", "aaaaaa")
        }
    }
}

private fun DescribeSpecRootScope.addingParticipants(repos: () -> RepositoryPair) {
    describe("addParticipant") {
        it("adds a participant and records the activity") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, aParticipant("host01"))
            rooms.addParticipant(room.id, aParticipant("pid002"), activity(30)) shouldBe AddResult.Added
            val stored = rooms.find(room.id)!!
            stored.participants.map { it.id } shouldContainExactly listOf("host01", "pid002")
            stored.room.lastActivityAt shouldBe activity(30).at
            stored.room.expiresAt shouldBe activity(30).expiresAt
        }

        it("reports an unknown room") {
            repos().rooms.addParticipant(freshId(), aParticipant("pid002"), activity(1)) shouldBe AddResult.RoomNotFound
        }

        it("refuses the fifth participant") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, aParticipant("host01"))
            for (n in 2..4) {
                rooms.addParticipant(room.id, aParticipant("pid00$n"), activity(n.toLong())) shouldBe AddResult.Added
            }
            rooms.addParticipant(room.id, aParticipant("pid005"), activity(5)) shouldBe AddResult.Full
            rooms.find(room.id)!!.participants.size shouldBe 4
        }

        it("stops at expectedCount when it is below four") {
            val rooms = repos().rooms
            val room = aRoom(freshId()) { it.copy(expectedCount = 2) }
            rooms.create(room, aParticipant("host01"))
            rooms.addParticipant(room.id, aParticipant("pid002"), activity(1)) shouldBe AddResult.Added
            rooms.addParticipant(room.id, aParticipant("pid003"), activity(2)) shouldBe AddResult.Full
        }

        it("refuses a locked room") {
            val rooms = repos().rooms
            val room = aRoom(freshId()) { it.copy(locked = true) }
            rooms.create(room, aParticipant("host01"))
            rooms.addParticipant(room.id, aParticipant("pid002"), activity(1)) shouldBe AddResult.Locked
        }

        it("lets only as many concurrent joiners in as there is capacity") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, aParticipant("host01"))
            val results =
                coroutineScope {
                    (2..9)
                        .map { n ->
                            async { rooms.addParticipant(room.id, aParticipant("pid00$n"), activity(n.toLong())) }
                        }.awaitAll()
                }
            results.count { it == AddResult.Added } shouldBe 3
            results.count { it == AddResult.Full } shouldBe 5
            rooms.find(room.id)!!.participants.size shouldBe 4
        }
    }
}

private fun DescribeSpecRootScope.changingParticipants(repos: () -> RepositoryPair) {
    describe("updateParticipant and removeParticipant") {
        it("updates nickname, origin and hidden") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, aParticipant("host01"))
            val change = ParticipantChange("지연", "225", true, T0.plusSeconds(60))
            rooms.updateParticipant(room.id, "host01", change, activity(1)) shouldBe true
            val updated = rooms.find(room.id)!!.participants.single()
            updated.nickname shouldBe "지연"
            updated.originCode shouldBe "225"
            updated.hidden shouldBe true
            updated.updatedAt shouldBe T0.plusSeconds(60)
            rooms.updateParticipant(room.id, "nobody", change, activity(2)) shouldBe false
        }

        it("removes a participant and clears the favor target when it was the target") {
            val rooms = repos().rooms
            val room = aRoom(freshId()) { it.copy(favorParticipantId = "pid002") }
            rooms.create(room, aParticipant("host01"))
            rooms.addParticipant(room.id, aParticipant("pid002"), activity(1))
            rooms.removeParticipant(room.id, "pid002", activity(2)) shouldBe true
            val stored = rooms.find(room.id)!!
            stored.participants.map { it.id } shouldContainExactly listOf("host01")
            stored.room.favorParticipantId.shouldBeNull()
            rooms.removeParticipant(room.id, "pid002", activity(3)) shouldBe false
        }
    }
}

private fun DescribeSpecRootScope.changingRooms(repos: () -> RepositoryPair) {
    describe("updateRoom and recordOutcome") {
        it("changes only the given fields and applies the new expiry") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, aParticipant("host01"))
            val change =
                RoomChange(
                    mode = RoomMode.FAVOR,
                    favorParticipantId = Change.Set("host01"),
                    locked = true,
                    meetingDate = Change.Set(LocalDate.parse("2026-11-20")),
                )
            rooms.updateRoom(room.id, change, activity(10, expiresInDays = 3)) shouldBe true
            val changed = rooms.find(room.id)!!.room
            changed.mode shouldBe RoomMode.FAVOR
            changed.favorParticipantId shouldBe "host01"
            changed.locked shouldBe true
            changed.meetingDate shouldBe LocalDate.parse("2026-11-20")
            changed.expiresAt shouldBe activity(10, expiresInDays = 3).expiresAt

            rooms.updateRoom(room.id, RoomChange(locked = false), activity(20)) shouldBe true
            val partial = rooms.find(room.id)!!.room
            partial.locked shouldBe false
            partial.mode shouldBe RoomMode.FAVOR
            partial.meetingDate shouldBe LocalDate.parse("2026-11-20")

            rooms.updateRoom(
                room.id,
                RoomChange(meetingDate = Change.Set(null), favorParticipantId = Change.Set(null)),
                activity(30),
            )
            val cleared = rooms.find(room.id)!!.room
            cleared.meetingDate.shouldBeNull()
            cleared.favorParticipantId.shouldBeNull()
            rooms.updateRoom(freshId(), RoomChange(), activity(1)) shouldBe false
        }

        it("records the latest outcome") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, aParticipant("host01"))
            rooms.recordOutcome(room.id, Outcome(OutcomeKind.OTHER, "130"), activity(5)) shouldBe true
            val outcome =
                rooms
                    .find(room.id)!!
                    .room.outcome
                    .shouldNotBeNull()
            outcome.kind shouldBe OutcomeKind.OTHER
            outcome.stationCode shouldBe "130"
            rooms.recordOutcome(freshId(), Outcome(OutcomeKind.NONE, null), activity(5)) shouldBe false
        }
    }
}

private fun DescribeSpecRootScope.removingRooms(repos: () -> RepositoryPair) {
    describe("delete and deleteExpired") {
        it("deletes a room together with its participants") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, aParticipant("host01"))
            rooms.delete(room.id) shouldBe true
            rooms.find(room.id).shouldBeNull()
            rooms.delete(room.id) shouldBe false
        }

        it("deletes only rooms whose expiry has passed") {
            val rooms = repos().rooms
            val expired = aRoom(freshId()) { it.copy(expiresAt = T0.plusSeconds(100)) }
            val boundary = aRoom(freshId()) { it.copy(expiresAt = T0.plusSeconds(200)) }
            val alive = aRoom(freshId()) { it.copy(expiresAt = T0.plusSeconds(300)) }
            listOf(expired, boundary, alive).forEach { rooms.create(it, aParticipant("host01")) }
            val deleted = rooms.deleteExpired(T0.plusSeconds(200))
            (deleted >= 2) shouldBe true
            rooms.find(expired.id).shouldBeNull()
            rooms.find(boundary.id).shouldBeNull()
            rooms.find(alive.id).shouldNotBeNull()
        }
    }
}

private fun DescribeSpecRootScope.anonUsers(repos: () -> RepositoryPair) {
    describe("anonymous users") {
        it("finds a user by device hash and records when it was last seen") {
            val anon = repos().anonUsers
            val user = AnonUser("u_" + freshId(), hashOf("device-" + freshId()), T0, T0)
            anon.create(user)
            anon.findByDeviceHash(user.deviceHash) shouldBe user
            anon.findByDeviceHash(hashOf("other-" + freshId())).shouldBeNull()
            anon.touch(user.id, T0.plusSeconds(60))
            anon.findByDeviceHash(user.deviceHash)!!.lastSeenAt shouldBe T0.plusSeconds(60)
        }

        it("deletes only inactive users that no room or participant refers to") {
            val repositories = repos()
            val stale = AnonUser("u_" + freshId(), hashOf("d-" + freshId()), T0, T0)
            val referenced = AnonUser("u_" + freshId(), hashOf("d-" + freshId()), T0, T0)
            val fresh = AnonUser("u_" + freshId(), hashOf("d-" + freshId()), T0, T0.plus(Duration.ofDays(100)))
            listOf(stale, referenced, fresh).forEach { repositories.anonUsers.create(it) }
            repositories.rooms.create(aRoom(freshId()) { it.copy(hostAnonId = referenced.id) }, aParticipant("host01"))
            val cutoff = T0.plus(Duration.ofDays(90))
            (repositories.anonUsers.deleteInactive(cutoff) >= 1) shouldBe true
            repositories.anonUsers.findByDeviceHash(stale.deviceHash).shouldBeNull()
            repositories.anonUsers.findByDeviceHash(referenced.deviceHash).shouldNotBeNull()
            repositories.anonUsers.findByDeviceHash(fresh.deviceHash).shouldNotBeNull()
        }
    }
}
