package app.banbanyeok.server.room.exposed

import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.javatime.date
import org.jetbrains.exposed.v1.javatime.timestamp

// 스키마의 원본은 server/db/changelog(Liquibase). 이 정의는 쿼리를 쓰기 위한 매핑일 뿐이고 DDL을 만들지 않는다.
internal object AnonUsersTable : Table("anon_users") {
    val id = text("id")
    val deviceHash = binary("device_hash")
    val createdAt = timestamp("created_at")
    val lastSeenAt = timestamp("last_seen_at")
    override val primaryKey = PrimaryKey(id)
}

internal object RoomsTable : Table("rooms") {
    val id = text("id")
    val hostHash = binary("host_hash")
    val hostPid = text("host_pid")
    val hostAnonId = text("host_anon_id").nullable()
    val mode = text("mode")
    val favorPid = text("favor_pid").nullable()
    val dataVersion = text("data_version")
    val meetingDate = date("meeting_date").nullable()
    val expectedCount = short("expected_count").nullable()
    val status = text("status")
    val outcome = text("outcome").nullable()
    val outcomeStation = text("outcome_station").nullable()
    val createdAt = timestamp("created_at")
    val lastActivityAt = timestamp("last_activity_at")
    val expiresAt = timestamp("expires_at")
    override val primaryKey = PrimaryKey(id)
}

internal object ParticipantsTable : Table("participants") {
    val roomId = text("room_id")
    val pid = text("pid")
    val anonId = text("anon_id").nullable()
    val tokenHash = binary("token_hash")
    val nickname = text("nickname").nullable()
    val originCode = text("origin_code")
    val hidden = bool("hidden")
    val joinedAt = timestamp("joined_at")
    val updatedAt = timestamp("updated_at")
    override val primaryKey = PrimaryKey(roomId, pid)
}
