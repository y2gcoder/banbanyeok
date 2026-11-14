package app.banbanyeok.server.room

import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.atomic.AtomicInteger

/** 직접 움직이는 시계(고정 Clock). */
class MutableClock(
    start: Instant = Instant.parse("2026-11-14T03:00:00Z"),
) : Clock() {
    @Volatile
    private var now: Instant = start

    fun advance(duration: Duration) {
        now = now.plus(duration)
    }

    fun set(instant: Instant) {
        now = instant
    }

    override fun getZone() = ZoneOffset.UTC

    override fun withZone(zone: java.time.ZoneId?): Clock = this

    override fun instant(): Instant = now
}

/** 결정적인 ID·토큰. 토큰은 `token-1`, `token-2`처럼 발급 순서대로다. */
class SequentialIdGenerator : IdGenerator {
    private val rooms = AtomicInteger()
    private val participants = AtomicInteger()
    private val anons = AtomicInteger()
    private val tokens = AtomicInteger()

    override fun roomId(): String = "room" + rooms.incrementAndGet().toString().padStart(CODE_PAD, '0')

    override fun participantId(): String = "pid" + participants.incrementAndGet().toString().padStart(3, '0')

    override fun anonUserId(): String = "u_anon" + anons.incrementAndGet()

    override fun token(): String = "token-" + tokens.incrementAndGet()

    private companion object {
        const val CODE_PAD = 6
    }
}

class FakeStationCatalog(
    override val dataVersion: String = "20261112.1",
    private val origins: Set<String> = setOf("03v", "130", "225", "31a"),
) : StationCatalog {
    override fun isOrigin(code: String): Boolean = code in origins
}

val testPepper = "test-pepper-0123456789-0123456789".toByteArray()

class RoomFixture(
    val clock: MutableClock = MutableClock(),
    val ids: IdGenerator = SequentialIdGenerator(),
    val rooms: InMemoryRoomRepository = InMemoryRoomRepository(),
    val stations: StationCatalog = FakeStationCatalog(),
) {
    val anonUsers = InMemoryAnonUserRepository(rooms)
    val tokens = TokenService(testPepper, ids)
    val service = RoomService(rooms, anonUsers, tokens, ids, stations, clock)
    val anonService = AnonUserService(anonUsers, tokens, ids, clock)
    val cleanup = RoomCleanup(rooms, anonUsers, clock)
}

fun hashOf(text: String) = TokenHash(text.toByteArray())

fun aRoom(
    id: String = "abcdefghjk",
    createdAt: Instant = Instant.parse("2026-11-14T00:00:00Z"),
    modify: (Room) -> Room = { it },
): Room =
    Room(
        id = id,
        hostHash = hashOf("host-$id"),
        hostParticipantId = "host01",
        hostAnonId = null,
        mode = RoomMode.FAIR,
        favorParticipantId = null,
        dataVersion = "20261112.1",
        meetingDate = null,
        expectedCount = null,
        locked = false,
        outcome = null,
        createdAt = createdAt,
        lastActivityAt = createdAt,
        expiresAt = createdAt.plus(ExpiryPolicy.SLIDING),
    ).let(modify)

fun aParticipant(
    id: String,
    joinedAt: Instant = Instant.parse("2026-11-14T00:00:00Z"),
    modify: (Participant) -> Participant = { it },
): Participant = Participant(id, hashOf("token-$id"), null, null, "03v", false, joinedAt, joinedAt).let(modify)

class RepositoryPair(
    val rooms: RoomRepository,
    val anonUsers: AnonUserRepository,
)
