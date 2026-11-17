package app.banbanyeok.server.room

import app.banbanyeok.server.room.exposed.ExposedRoomRepository
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** 공유 번호, 인원, 정함이 한 읽기에서 함께 보인 값. */
private data class Seen(
    val shareVersion: Long,
    val people: Int,
    val decided: Boolean,
)

/** 미리보기는 `?sv=`마다 카카오에 오래 캐시된다. 동시에 쓰는 동안 읽어도 실제로 있었던 상태만 보여야 한다. */
class ConcurrentRoomTest :
    DescribeSpec({
        val pool = Executors.newFixedThreadPool(READERS + 2).asCoroutineDispatcher()
        val rooms = ExposedRoomRepository(TestDatabase.database, pool)
        afterSpec { pool.close() }

        it("reads the room and its participants from one snapshot while someone joins") {
            repeat(RACES) { n ->
                val room = aRoom(freshId())
                rooms.create(room, aParticipant("host01"))
                rooms.addParticipant(room.id, aParticipant("pid002", T0.plusSeconds(1)), activity(1))
                rooms.writeDecision(
                    room.id,
                    DecisionRequest("host01", Decision("130", "host01", T0), ShareVersion(2)),
                    activity(2),
                    fakeDecisionRule,
                ) shouldBe
                    DecisionResult.Applied
                // 방장(1), 둘째(2), 정함(3), 셋째가 들어와 정함이 풀림(4). 이 두 상태 말고는 존재한 적이 없다.
                val existed = setOf(Seen(3, 2, true), Seen(4, 3, false))
                val seen = ConcurrentHashMap.newKeySet<Seen>()
                val joined = AtomicBoolean(false)
                coroutineScope {
                    val readers =
                        List(READERS) {
                            async(pool) {
                                while (!joined.get()) {
                                    val stored = rooms.find(room.id).shouldNotBeNull()
                                    seen +=
                                        Seen(
                                            stored.room.shareVersion.value,
                                            stored.participants.size,
                                            stored.room.decision != null,
                                        )
                                }
                            }
                        }
                    async(pool) {
                        delay(5)
                        rooms.addParticipant(room.id, aParticipant("pid003", T0.plusSeconds(3)), activity(3))
                        delay(5)
                        joined.set(true)
                    }.await()
                    readers.awaitAll()
                }
                withClue("race $n") { (seen - existed).shouldBeEmpty() }
            }
        }

        it("never leaves the favor target pointing at someone who left") {
            repeat(RACES) { n ->
                val room = aRoom(freshId())
                rooms.create(room, aParticipant("host01"))
                rooms.addParticipant(room.id, aParticipant("pid002", T0.plusSeconds(1)), activity(1))
                val toLeaver = RoomChange(mode = RoomMode.FAVOR, favorParticipantId = Change.Set("pid002"))
                coroutineScope {
                    listOf(
                        async(pool) { rooms.updateRoom(room.id, toLeaver, activity(2)) },
                        async(pool) { rooms.removeParticipant(room.id, "pid002", activity(2)) },
                    ).awaitAll()
                }
                val stored = rooms.find(room.id).shouldNotBeNull()
                val favor = stored.room.favorParticipantId ?: return@repeat
                withClue("race $n") { stored.participants.map { it.id } shouldContain favor }
            }
        }
    })

private const val READERS = 4
private const val RACES = 30
