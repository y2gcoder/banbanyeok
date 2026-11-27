@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.room

import app.banbanyeok.server.room.exposed.ExposedRoomRepository
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import java.time.Instant
import java.util.concurrent.Executors

private fun sql(
    statement: String,
    vararg args: Any,
): Int =
    TestDatabase.dataSource.connection.use { connection ->
        connection.prepareStatement(statement).use { ps ->
            args.forEachIndexed { i, arg -> ps.setObject(i + 1, arg) }
            ps.executeUpdate()
        }
    }

/** 앱 코드가 모르는 쓰기(배포 중 옛 서버, 손으로 고친 행)도 트리거가 번호를 세고 정함을 푸는지 Postgres에서 직접 본다. */
class ShareVersionTriggerTest :
    DescribeSpec({
        val rooms = ExposedRoomRepository(TestDatabase.database, UnconfinedTestDispatcher())

        suspend fun decidedRoom(): String {
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
            rooms.addParticipant(room.id, aParticipant("pid002", T0.plusSeconds(1)), activity(1))
            val seen = rooms.find(room.id)!!.room.shareVersion
            rooms.writeDecision(
                room.id,
                DecisionRequest("host01", Decision("130", "host01", T0), seen),
                activity(2),
                fakeDecisionRule,
            ) shouldBe
                DecisionResult.Applied
            return room.id
        }

        suspend fun state(roomId: String) = rooms.find(roomId).shouldNotBeNull().room

        describe("writes that bypass the repository (an old server revision during a deploy)") {
            it("bump and release on a raw participant insert, origin update and delete") {
                val legacyWrites =
                    listOf(
                        "INSERT INTO participants (room_id, pid, token_hash, origin_code, joined_at, updated_at) " +
                            "VALUES (?, 'pid003', '\\x00'::bytea, '03v', now(), now())",
                        "UPDATE participants SET origin_code = '225' WHERE room_id = ? AND pid = 'pid002'",
                        "DELETE FROM participants WHERE room_id = ? AND pid = 'pid002'",
                    )
                for (statement in legacyWrites) {
                    val roomId = decidedRoom()
                    val before = state(roomId)
                    sql(statement, roomId) shouldBe 1
                    val after = state(roomId)
                    withClue(statement) {
                        after.shareVersion.value shouldBe before.shareVersion.value + 1
                        after.decision.shouldBeNull()
                        after.decisionBasis shouldBe after.shareVersion
                    }
                }
            }

            it("bump without releasing on a raw nickname or hidden update, and ignore a no-op update") {
                val roomId = decidedRoom()
                val start = state(roomId)
                sql("UPDATE participants SET hidden = true WHERE room_id = ? AND pid = 'pid002'", roomId)
                sql("UPDATE participants SET nickname = '지연' WHERE room_id = ? AND pid = 'pid002'", roomId)
                sql(
                    "UPDATE participants SET nickname = '지연', hidden = true WHERE room_id = ? AND pid = 'pid002'",
                    roomId,
                )
                val after = state(roomId)
                after.shareVersion.value shouldBe start.shareVersion.value + 2
                after.decision shouldBe start.decision
                after.decisionBasis shouldBe start.decisionBasis
            }

            it("count a raw room update once, never take a version from the app, and never go down") {
                val roomId = decidedRoom()
                val start = state(roomId).shareVersion.value
                sql("UPDATE rooms SET share_version = 0 WHERE id = ?", roomId)
                state(roomId).shareVersion.value shouldBe start
                sql("UPDATE rooms SET share_version = 999, decision_basis_version = 0 WHERE id = ?", roomId)
                state(roomId).shareVersion.value shouldBe start + 1
                sql("UPDATE rooms SET mode = 'fast', status = 'locked' WHERE id = ?", roomId)
                state(roomId).shareVersion.value shouldBe start + 2
                sql("UPDATE rooms SET last_activity_at = now(), outcome = 'none' WHERE id = ?", roomId)
                state(roomId).shareVersion.value shouldBe start + 2
                state(roomId).decision.shouldNotBeNull()
            }
        }

        describe("deleting a room") {
            it("cascades to four participants and a decision without the participant trigger failing") {
                val roomId = decidedRoom()
                rooms.addParticipant(roomId, aParticipant("pid003", T0.plusSeconds(3)), activity(3))
                rooms.addParticipant(roomId, aParticipant("pid004", T0.plusSeconds(4)), activity(4))
                rooms.delete(roomId) shouldBe true
                rooms.find(roomId).shouldBeNull()

                val expired = decidedRoom()
                sql("UPDATE rooms SET expires_at = now() - interval '1 day' WHERE id = ?", expired)
                (rooms.deleteExpired(Instant.now()) >= 1) shouldBe true
                rooms.find(expired).shouldBeNull()
            }
        }

        describe("a decision racing an origin change") {
            it("never leaves a decision based on the origin that changed") {
                Executors.newFixedThreadPool(2).asCoroutineDispatcher().use { pool ->
                    val racing = ExposedRoomRepository(TestDatabase.database, pool)
                    repeat(RACES) { n ->
                        val roomId = decidedRoom()
                        racing.writeDecision(
                            roomId,
                            DecisionRequest("host01", null, state(roomId).shareVersion),
                            activity(3),
                            fakeDecisionRule,
                        )
                        val seen = state(roomId).shareVersion
                        val change = ParticipantChange(null, "225", false, T0.plusSeconds(5))
                        coroutineScope {
                            listOf(
                                async {
                                    racing.writeDecision(
                                        roomId,
                                        DecisionRequest("pid002", Decision("130", "pid002", T0), seen),
                                        activity(5),
                                        fakeDecisionRule,
                                    )
                                },
                                async { racing.updateParticipant(roomId, "pid002", change, activity(5)) },
                            ).awaitAll()
                        }
                        withClue("race $n") { state(roomId).decision.shouldBeNull() }
                    }
                }
            }
        }
    })

private const val RACES = 20
