@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.room

import app.banbanyeok.schema.StationRegion
import app.banbanyeok.server.room.exposed.ExposedRoomRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import java.sql.SQLException

/** 방의 권역 칸(changeset 20261126-room-region)을 이 칸을 모르는 리비전의 쓰기로 Postgres에서 직접 본다. */
class RoomRegionColumnTest :
    DescribeSpec({
        val rooms = ExposedRoomRepository(TestDatabase.database, UnconfinedTestDispatcher())

        fun insertRoom(
            id: String,
            region: String? = null,
        ) = TestDatabase.dataSource.connection.use { connection ->
            val columns = if (region == null) "" else ", region"
            val values = if (region == null) "" else ", ?"
            connection
                .prepareStatement(
                    "INSERT INTO rooms (id, host_hash, host_pid, mode, data_version, status, created_at, " +
                        "last_activity_at, expires_at$columns) VALUES (?, '\\x00'::bytea, 'host01', 'fair', " +
                        "'20261112.1', 'open', now(), now(), now() + interval '7 days'$values)",
                ).use { ps ->
                    ps.setString(1, id)
                    region?.let { ps.setString(2, it) }
                    ps.executeUpdate()
                }
        }

        it("stores a room that a revision without the column creates as metropolitan") {
            val id = freshId()
            insertRoom(id)
            rooms.find(id)!!.room.region shouldBe StationRegion.CAPITAL
        }

        it("refuses a region the changelog does not know") {
            shouldThrow<SQLException> { insertRoom(freshId(), "daegu") }
        }
    })
