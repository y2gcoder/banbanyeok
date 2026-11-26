package app.banbanyeok.server.room

import app.banbanyeok.server.room.exposed.ExposedAnonUserRepository
import app.banbanyeok.server.room.exposed.ExposedRoomRepository
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

private const val REQUESTS = 8

/**
 * 채운 사다리 방(#227)을 같은 복구 키로 여러 인스턴스가 동시에 만드는 경우. 각 요청은 서로 다른 RoomService(다른 인스턴스)이고 저장소만
 * 같은 Postgres다. 모든 요청이 조회에서 방을 못 찾은 뒤 동시에 넣게 한다(최악의 경합).
 */
class ConcurrentDrawRoomRecoveryTest :
    DescribeSpec({
        val pool = Executors.newFixedThreadPool(REQUESTS * 2).asCoroutineDispatcher()
        afterSpec { pool.close() }

        it("keeps one room and gives every request the same room and the same usable creator tokens") {
            val start = CountDownLatch(REQUESTS)
            val responses =
                coroutineScope {
                    List(REQUESTS) {
                        async(pool) {
                            instance(LookupBarrier(ExposedRoomRepository(TestDatabase.database, pool), start), pool)
                                .createDrawRoom(drawRoomCommand(), RACE_KEY)
                        }
                    }.awaitAll()
                }

            responses.map { it.copy(recovered = false) }.distinct() shouldHaveSize 1
            responses.count { !it.recovered } shouldBe 1
            val rooms = ExposedRoomRepository(TestDatabase.database, pool)
            val created = responses.first()
            rooms.find(created.roomId)!!.participants shouldHaveSize 2
            val service = instance(rooms, pool)
            service
                .get(created.roomId, created.participantToken)
                .participants
                .single { it.isSelf }
                .isHost shouldBe true
            service.delete(created.roomId, created.hostToken)
        }
    })

private val RACE_KEY = "race-${UUID.randomUUID()}-recovery-key"

private fun drawRoomCommand() =
    CreateRoomCommand(
        RoomMode.FAVOR,
        CreateRoomCommand.DRAW_TARGET,
        null,
        ParticipantInput("지연", "130"),
        null,
        null,
        others = listOf(ParticipantInput("민수", "03v")),
    )

/** 한 앱 인스턴스(자기 RoomService). 저장소만 같은 Postgres다. */
private fun instance(
    rooms: RoomRepository,
    pool: kotlinx.coroutines.CoroutineDispatcher,
): RoomService {
    val ids = SecureRandomIdGenerator()
    return RoomService(
        rooms,
        ExposedAnonUserRepository(TestDatabase.database, pool),
        TokenService(testPepper, ids),
        ids,
        FakeStationCatalog(),
        MutableClock(),
    )
}

/** 첫 조회는 모든 요청이 조회를 마칠 때까지 기다렸다가(모두 방을 못 찾은 채) 함께 넣게 한다. 그 뒤 조회는 그대로다. */
private class LookupBarrier(
    private val inner: RoomRepository,
    private val start: CountDownLatch,
) : RoomRepository by inner {
    private var lookups = 0

    override suspend fun findByRecovery(
        recoveryHash: TokenHash,
        createdAfter: java.time.Instant,
    ): String? {
        if (lookups++ > 0) return inner.findByRecovery(recoveryHash, createdAfter)
        start.countDown()
        start.await(10, TimeUnit.SECONDS)
        return null
    }
}
