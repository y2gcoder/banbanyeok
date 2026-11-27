@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.room

import app.banbanyeok.server.room.exposed.ExposedRoomRepository
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.test.UnconfinedTestDispatcher

/**
 * ADR-0007 전에 출발역을 숨긴 채 들어온 행(예상 밖으로 남았거나 백업에서 되살아난 것)을 앱이 숨김을 가리지 않는 판에서 본다(#182).
 * 저장소는 그 방에 표시만 하고([StoredRoom.withheld]), 무엇을 보여 주고 무엇을 허용할지는 서비스가 정한다(ADR-0012).
 */
class LegacyHiddenRoomTest :
    DescribeSpec({
        val rooms = ExposedRoomRepository(TestDatabase.database, UnconfinedTestDispatcher())

        fun markHidden(
            roomId: String,
            pid: String,
            hidden: Boolean = true,
        ) = TestDatabase.dataSource.connection.use { connection ->
            connection.prepareStatement("UPDATE participants SET hidden = ? WHERE room_id = ? AND pid = ?").use { ps ->
                ps.setBoolean(1, hidden)
                ps.setString(2, roomId)
                ps.setString(3, pid)
                ps.executeUpdate() shouldBe 1
            }
        }

        suspend fun twoPeople(): String {
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
            rooms.addParticipant(room.id, aParticipant("pid002", T0.plusSeconds(1)), activity(1))
            return room.id
        }

        it("marks a room with a hidden participant as withheld, and clears the mark once nobody is hidden") {
            val roomId = twoPeople()
            markHidden(roomId, "pid002")
            rooms.find(roomId).shouldNotBeNull().withheld shouldBe true
            markHidden(roomId, "pid002", hidden = false)
            val shown = rooms.find(roomId).shouldNotBeNull()
            shown.withheld shouldBe false
            shown.participants.map { it.id } shouldBe listOf("host01", "pid002")
        }

        it("clears the mark when the hidden participant's row is deleted") {
            val roomId = twoPeople()
            markHidden(roomId, "pid002")
            rooms.removeParticipant(roomId, "pid002", activity(2)) shouldBe true
            rooms.find(roomId).shouldNotBeNull().withheld shouldBe false
        }

        it("does not touch other rooms") {
            val hiddenRoom = twoPeople()
            val plainRoom = twoPeople()
            markHidden(hiddenRoom, "host01")
            rooms.find(hiddenRoom).shouldNotBeNull().withheld shouldBe true
            rooms.find(plainRoom).shouldNotBeNull().withheld shouldBe false
        }

        it("stores new participants as not hidden without writing the column") {
            val roomId = twoPeople()
            val sql = "SELECT count(*) FROM participants WHERE room_id = ? AND hidden"
            TestDatabase.dataSource.connection.use { connection ->
                connection.prepareStatement(sql).use { ps ->
                    ps.setString(1, roomId)
                    ps.executeQuery().use { rs ->
                        rs.next()
                        rs.getInt(1) shouldBe 0
                    }
                }
            }
        }
    })
