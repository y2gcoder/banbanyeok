package app.banbanyeok.server.room

import app.banbanyeok.schema.StationRegion
import app.banbanyeok.schema.TimeBand
import io.kotest.assertions.throwables.shouldThrow
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

val T0: Instant = Instant.parse("2026-11-14T00:00:00Z")

fun freshId(): String =
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

fun activity(
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
        storedRegions(newRepositories)
        regionalParticipants(newRepositories)
        emptyRoomRegions(newRepositories)
        meetingOrigins(newRepositories)
        changingParticipants(newRepositories)
        changingRooms(newRepositories)
        favorTargets(newRepositories)
        meetingBands(newRepositories)
        removingRooms(newRepositories)
        anonUsers(newRepositories)
        shareVersions(newRepositories)
        decisions(newRepositories)
        decisionGuards(newRepositories)
        visibleDecisions(newRepositories)
        favorDraws(newRepositories)
        favorDrawResets(newRepositories)
        favorDrawVersions(newRepositories)
    }

private fun DescribeSpecRootScope.createAndFind(repos: () -> RepositoryPair) {
    describe("create and find") {
        it("returns null for an unknown room") {
            repos().rooms.find(freshId()).shouldBeNull()
        }

        it("stores the room with its host participant and returns every field") {
            val rooms = repos().rooms
            val room =
                aRoom(freshId()) {
                    it.copy(
                        expectedCount = 3,
                        meetingDate = LocalDate.parse("2026-12-01"),
                        meetingTime = java.time.LocalTime.of(19, 30),
                    )
                }
            val host = aParticipant("host01") { it.copy(nickname = "민수", hidden = true, originCode = "130") }
            rooms.create(room, listOf(host))
            val stored = rooms.find(room.id).shouldNotBeNull()
            // 방장 참여도 참여라서 트리거가 번호를 1로 올린다.
            stored.room shouldBe room.copy(shareVersion = ShareVersion(1), decisionBasis = ShareVersion(1))
            stored.participants shouldBe listOf(host)
        }

        it("returns participants in join order") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01", T0)))
            rooms.addParticipant(room.id, aParticipant("zzzzzz", T0.plusSeconds(1)), activity(1))
            rooms.addParticipant(room.id, aParticipant("aaaaaa", T0.plusSeconds(2)), activity(2))
            rooms.find(room.id)!!.participants.map { it.id } shouldContainExactly listOf("host01", "zzzzzz", "aaaaaa")
        }

        it("stores the rows the host entered with the room, in input order a microsecond apart, still marked") {
            val rooms = repos().rooms
            val room = aRoom(freshId()) { it.copy(locked = true) }
            val micro = java.time.Duration.ofNanos(1_000)
            val entered = { id: String, at: Instant -> aParticipant(id, at) { it.copy(enteredByHost = true) } }
            val rows =
                listOf(
                    entered("zzzzzz", T0),
                    aParticipant("host01", T0.plus(micro)),
                    entered("aaaaaa", T0.plus(micro.multipliedBy(2))),
                )
            rooms.create(room, rows)
            val stored = rooms.find(room.id).shouldNotBeNull()
            stored.participants shouldBe rows
            stored.room.locked shouldBe true
        }
    }
}

private fun DescribeSpecRootScope.addingParticipants(repos: () -> RepositoryPair) {
    describe("addParticipant") {
        it("adds a participant and records the activity") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
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
            rooms.create(room, listOf(aParticipant("host01")))
            for (n in 2..4) {
                rooms.addParticipant(room.id, aParticipant("pid00$n"), activity(n.toLong())) shouldBe AddResult.Added
            }
            rooms.addParticipant(room.id, aParticipant("pid005"), activity(5)) shouldBe AddResult.Full
            rooms.find(room.id)!!.participants.size shouldBe 4
        }

        it("stops at expectedCount when it is below four") {
            val rooms = repos().rooms
            val room = aRoom(freshId()) { it.copy(expectedCount = 2) }
            rooms.create(room, listOf(aParticipant("host01")))
            rooms.addParticipant(room.id, aParticipant("pid002"), activity(1)) shouldBe AddResult.Added
            rooms.addParticipant(room.id, aParticipant("pid003"), activity(2)) shouldBe AddResult.Full
        }

        it("refuses a locked room") {
            val rooms = repos().rooms
            val room = aRoom(freshId()) { it.copy(locked = true) }
            rooms.create(room, listOf(aParticipant("host01")))
            rooms.addParticipant(room.id, aParticipant("pid002"), activity(1)) shouldBe AddResult.Locked
        }

        it("lets only as many concurrent joiners in as there is capacity") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
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

private const val BUSAN_ORIGIN = "130"

private val regionalCatalog =
    object : StationCatalog by FakeStationCatalog() {
        override fun regionOf(code: String) = if (code == BUSAN_ORIGIN) StationRegion.BUSAN else StationRegion.CAPITAL
    }

private fun DescribeSpecRootScope.storedRegions(repos: () -> RepositoryPair) {
    describe("stored room region") {
        val busan = BUSAN_ORIGIN
        val origins = OriginRule(regionalCatalog)

        it("keeps the region a room was created with when its only member moves to another region") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
            val moving = ParticipantChange(null, busan, false, T0.plusSeconds(60))
            shouldThrow<RoomException> { rooms.updateParticipant(room.id, "host01", moving, activity(1), origins) }
                .error shouldBe RoomError.REGION_MISMATCH
            shouldThrow<RoomException> {
                rooms.addParticipant(
                    room.id,
                    aParticipant("pid002") { it.copy(originCode = busan) },
                    activity(2),
                    origins,
                )
            }.error shouldBe RoomError.REGION_MISMATCH
            rooms.find(room.id)!!.run {
                this.room.region shouldBe StationRegion.CAPITAL
                participants.map { it.originCode } shouldContainExactly listOf("03v")
            }
        }

        it("stores a Busan room's region and lets the room take the next joiner's region once no one is left") {
            val rooms = repos().rooms
            val room = aRoom(freshId()) { it.copy(region = StationRegion.BUSAN) }
            rooms.create(room, listOf(aParticipant("host01") { it.copy(originCode = busan) }))
            rooms.find(room.id)!!.room.region shouldBe StationRegion.BUSAN
            rooms.removeParticipant(room.id, "host01", activity(1)) shouldBe true
            rooms.addParticipant(room.id, aParticipant("pid002"), activity(2), origins) shouldBe AddResult.Added
            rooms.find(room.id)!!.room.region shouldBe StationRegion.CAPITAL
            shouldThrow<RoomException> {
                rooms.addParticipant(
                    room.id,
                    aParticipant("pid003") { it.copy(originCode = busan) },
                    activity(3),
                    origins,
                )
            }.error shouldBe RoomError.REGION_MISMATCH
        }
    }
}

private fun DescribeSpecRootScope.emptyRoomRegions(repos: () -> RepositoryPair) {
    describe("joins into a room no one is left in") {
        val busan = BUSAN_ORIGIN
        val catalog = regionalCatalog
        val origins = OriginRule(catalog)

        it("keeps one region when two people of different regions join a room no one is left in") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
            rooms.removeParticipant(room.id, "host01", activity(1)) shouldBe true
            val outcomes =
                coroutineScope {
                    listOf("pid002" to "03v", "pid003" to busan)
                        .map { (id, code) ->
                            async {
                                runCatching {
                                    rooms.addParticipant(
                                        room.id,
                                        aParticipant(id) { it.copy(originCode = code) },
                                        activity(2),
                                        origins,
                                    )
                                }
                            }
                        }.awaitAll()
                }
            outcomes.count { it.isSuccess } shouldBe 1
            (outcomes.single { it.isFailure }.exceptionOrNull() as RoomException).error shouldBe
                RoomError.REGION_MISMATCH
            val stored = rooms.find(room.id)!!
            stored.participants.map { catalog.regionOf(it.originCode) } shouldContainExactly listOf(stored.room.region)
        }
    }
}

private fun DescribeSpecRootScope.regionalParticipants(repos: () -> RepositoryPair) {
    describe("regional participant writes") {
        val busan = BUSAN_ORIGIN
        val catalog = regionalCatalog
        val origins = OriginRule(catalog)

        it("keeps one region when a participant joins while the only member changes region") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
            val outcomes =
                coroutineScope {
                    listOf(
                        async {
                            runCatching {
                                rooms.addParticipant(
                                    room.id,
                                    aParticipant("pid002"),
                                    activity(1),
                                    origins,
                                )
                            }
                        },
                        async {
                            val change = ParticipantChange(null, busan, false, T0.plusSeconds(60))
                            runCatching { rooms.updateParticipant(room.id, "host01", change, activity(1), origins) }
                        },
                    ).awaitAll()
                }
            outcomes.map { it.isSuccess } shouldContainExactly listOf(true, false)
            val rejected = outcomes.single { it.isFailure }.exceptionOrNull() as RoomException
            rejected.error shouldBe RoomError.REGION_MISMATCH
            rooms
                .find(room.id)!!
                .participants
                .map { catalog.regionOf(it.originCode) }
                .distinct()
                .size shouldBe 1
        }
    }
}

private fun DescribeSpecRootScope.meetingOrigins(repos: () -> RepositoryPair) {
    describe("participant writes on the stored meeting") {
        it("checks an origin against the room's meeting as stored when the write locks the room") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            val saturday = LocalDate.parse("2026-11-28")
            val catalog =
                object : StationCatalog by FakeStationCatalog() {
                    override fun departs(
                        code: String,
                        meeting: Meeting,
                    ) = !(code == "130" && meeting.date == saturday)
                }
            val origins = OriginRule(catalog)
            rooms.create(room, listOf(aParticipant("host01")))
            rooms.addParticipant(room.id, aParticipant("pid002"), activity(1), origins) shouldBe AddResult.Added
            rooms.updateRoom(room.id, RoomChange(meetingDate = Change.Set(saturday)), activity(2)) shouldBe true

            val joining = aParticipant("pid003") { it.copy(originCode = "130") }
            shouldThrow<RoomException> { rooms.addParticipant(room.id, joining, activity(3), origins) }
                .error shouldBe RoomError.SCHEDULE_UNAVAILABLE
            val moving = ParticipantChange(null, "130", false, T0.plusSeconds(240))
            shouldThrow<RoomException> { rooms.updateParticipant(room.id, "pid002", moving, activity(4), origins) }
                .error shouldBe RoomError.SCHEDULE_UNAVAILABLE
            rooms.find(room.id)!!.participants.map { it.originCode } shouldContainExactly listOf("03v", "03v")
        }
    }
}

private fun DescribeSpecRootScope.changingParticipants(repos: () -> RepositoryPair) {
    describe("updateParticipant and removeParticipant") {
        it("updates nickname, origin and hidden") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
            val change = ParticipantChange("지연", "225", true, T0.plusSeconds(60))
            rooms.updateParticipant(room.id, "host01", change, activity(1)) shouldBe true
            val updated = rooms.find(room.id)!!.participants.single()
            updated.nickname shouldBe "지연"
            updated.originCode shouldBe "225"
            updated.hidden shouldBe true
            updated.updatedAt shouldBe T0.plusSeconds(60)
            rooms.updateParticipant(room.id, "nobody", change, activity(2)) shouldBe false
        }

        it("keeps a hide only for someone still hidden when saving (ADR-0007)") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01") { it.copy(hidden = true) }))
            rooms.addParticipant(room.id, aParticipant("pid002"), activity(1))
            val keep = ParticipantChange("지연", "225", true, T0.plusSeconds(60), onlyIfHidden = true)
            // 숨기지 않은 사람에게는 쓰지 않는다(새로 숨기지 않는다).
            rooms.updateParticipant(room.id, "pid002", keep, activity(2)) shouldBe false
            rooms.find(room.id)!!.participants.single { it.id == "pid002" }.run {
                hidden shouldBe false
                nickname shouldBe null
            }
            // 이미 숨긴 사람은 유지하며 고친다.
            rooms.updateParticipant(room.id, "host01", keep, activity(3)) shouldBe true
            rooms.find(room.id)!!.participants.single { it.id == "host01" }.run {
                hidden shouldBe true
                nickname shouldBe "지연"
            }
        }

        it("removes a participant and clears the favor target when it was the target") {
            val rooms = repos().rooms
            val room = aRoom(freshId()) { it.copy(favorParticipantId = "pid002") }
            rooms.create(room, listOf(aParticipant("host01")))
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
            rooms.create(room, listOf(aParticipant("host01")))
            val change =
                RoomChange(
                    mode = RoomMode.FAVOR,
                    favorParticipantId = Change.Set("host01"),
                    locked = true,
                    meetingDate = Change.Set(LocalDate.parse("2026-11-20")),
                    meetingTime = Change.Set(java.time.LocalTime.of(8, 0)),
                )
            rooms.updateRoom(room.id, change, activity(10, expiresInDays = 3)) shouldBe true
            val changed = rooms.find(room.id)!!.room
            changed.mode shouldBe RoomMode.FAVOR
            changed.favorParticipantId shouldBe "host01"
            changed.locked shouldBe true
            changed.meetingDate shouldBe LocalDate.parse("2026-11-20")
            changed.meetingTime shouldBe java.time.LocalTime.of(8, 0)
            changed.expiresAt shouldBe activity(10, expiresInDays = 3).expiresAt

            rooms.updateRoom(room.id, RoomChange(locked = false), activity(20)) shouldBe true
            val partial = rooms.find(room.id)!!.room
            partial.locked shouldBe false
            partial.mode shouldBe RoomMode.FAVOR
            partial.meetingDate shouldBe LocalDate.parse("2026-11-20")
            partial.meetingTime shouldBe java.time.LocalTime.of(8, 0)

            rooms.updateRoom(
                room.id,
                RoomChange(
                    meetingDate = Change.Set(null),
                    favorParticipantId = Change.Set(null),
                    meetingTime = Change.Set(null),
                ),
                activity(30),
            )
            val cleared = rooms.find(room.id)!!.room
            cleared.meetingDate.shouldBeNull()
            cleared.meetingTime.shouldBeNull()
            cleared.favorParticipantId.shouldBeNull()
            rooms.updateRoom(freshId(), RoomChange(), activity(1)) shouldBe false
        }

        it("records the latest outcome") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
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

private fun DescribeSpecRootScope.meetingBands(repos: () -> RepositoryPair) {
    describe("meeting band") {
        it("stores a band-only meeting and clears it") {
            val rooms = repos().rooms
            val room = aRoom(freshId()) { it.copy(meetingBand = TimeBand.EVENING) }
            rooms.create(room, listOf(aParticipant("host01")))
            rooms.find(room.id)!!.room.meetingBand shouldBe TimeBand.EVENING
            rooms.updateRoom(room.id, RoomChange(locked = true), activity(5)) shouldBe true
            rooms.find(room.id)!!.room.meetingBand shouldBe TimeBand.EVENING
            rooms.updateRoom(
                room.id,
                RoomChange(meetingBand = Change.Set(TimeBand.NIGHT)),
                activity(6),
            ) shouldBe true
            rooms.find(room.id)!!.room.meetingBand shouldBe TimeBand.NIGHT
            rooms.updateRoom(room.id, RoomChange(meetingBand = Change.Set(null)), activity(7)) shouldBe true
            rooms
                .find(room.id)!!
                .room.meetingBand
                .shouldBeNull()
        }

        it("changes a band only while the room has no meeting time when asked to") {
            val rooms = repos().rooms
            val room = aRoom(freshId()) { it.copy(meetingTime = java.time.LocalTime.of(19, 0)) }
            rooms.create(room, listOf(aParticipant("host01")))
            val bandOnly = RoomChange(meetingBand = Change.Set(TimeBand.NIGHT), onlyWithoutMeetingTime = true)
            rooms.updateRoom(room.id, bandOnly, activity(5)) shouldBe false
            rooms
                .find(room.id)!!
                .room.meetingBand
                .shouldBeNull()
            rooms.find(room.id)!!.room.lastActivityAt shouldBe room.lastActivityAt
            rooms.updateRoom(room.id, RoomChange(meetingTime = Change.Set(null)), activity(6)) shouldBe true
            rooms.updateRoom(room.id, bandOnly, activity(7)) shouldBe true
            rooms.find(room.id)!!.room.meetingBand shouldBe TimeBand.NIGHT
        }
    }
}

private fun DescribeSpecRootScope.removingRooms(repos: () -> RepositoryPair) {
    describe("delete and deleteExpired") {
        it("deletes a room together with its participants") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
            rooms.delete(room.id) shouldBe true
            rooms.find(room.id).shouldBeNull()
            rooms.delete(room.id) shouldBe false
        }

        it("deletes only rooms whose expiry has passed") {
            val rooms = repos().rooms
            val expired = aRoom(freshId()) { it.copy(expiresAt = T0.plusSeconds(100)) }
            val boundary = aRoom(freshId()) { it.copy(expiresAt = T0.plusSeconds(200)) }
            val alive = aRoom(freshId()) { it.copy(expiresAt = T0.plusSeconds(300)) }
            listOf(expired, boundary, alive).forEach { rooms.create(it, listOf(aParticipant("host01"))) }
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
            repositories.rooms.create(
                aRoom(freshId()) { it.copy(hostAnonId = referenced.id) },
                listOf(aParticipant("host01")),
            )
            val cutoff = T0.plus(Duration.ofDays(90))
            (repositories.anonUsers.deleteInactive(cutoff) >= 1) shouldBe true
            repositories.anonUsers.findByDeviceHash(stale.deviceHash).shouldBeNull()
            repositories.anonUsers.findByDeviceHash(referenced.deviceHash).shouldNotBeNull()
            repositories.anonUsers.findByDeviceHash(fresh.deviceHash).shouldNotBeNull()
        }
    }
}

private fun DescribeSpecRootScope.favorTargets(repos: () -> RepositoryPair) {
    describe("updateRoom favor target") {
        it("refuses a favor target who is not in the room and leaves the room as it was") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
            rooms.addParticipant(room.id, aParticipant("pid002", T0.plusSeconds(1)), activity(1))
            rooms.removeParticipant(room.id, "pid002", activity(2))
            val before = rooms.find(room.id)
            val toLeaver = RoomChange(mode = RoomMode.FAVOR, favorParticipantId = Change.Set("pid002"))
            rooms.updateRoom(room.id, toLeaver, activity(3)) shouldBe false
            rooms.find(room.id) shouldBe before
        }
    }
}
