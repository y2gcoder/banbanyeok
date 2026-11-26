package app.banbanyeok.server.room.exposed

import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.javatime.date
import org.jetbrains.exposed.v1.javatime.time
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
    val meetingTime = time("meeting_time").nullable()

    /** 시각 없이 고른 약속 시간대(`morning`·`day`·`evening`·`night`). 시각이 있으면 null. */
    val meetingBand = text("meeting_band").nullable()
    val expectedCount = short("expected_count").nullable()
    val status = text("status")
    val outcome = text("outcome").nullable()
    val outcomeStation = text("outcome_station").nullable()
    val createdAt = timestamp("created_at")
    val lastActivityAt = timestamp("last_activity_at")
    val expiresAt = timestamp("expires_at")

    /** 트리거(rooms_share_version, participants_share_version)만 쓴다. 앱은 읽기만 한다. */
    val shareVersion = long("share_version")
    val decisionBasisVersion = long("decision_basis_version")
    val decidedStation = text("decided_station").nullable()
    val decidedByPid = text("decided_by_pid").nullable()
    val decidedAt = timestamp("decided_at").nullable()

    /** 방을 만들 때 배려 대상을 뽑기로 정했다(#172). 당첨자는 [favorPid]. 기준·대상을 직접 바꾸면 뽑기가 끝난다(false). */
    val favorDraw = bool("favor_draw")
    val drawGeneration = integer("draw_generation")
    val drawRound = short("draw_round")
    val drawCandidates = array<String>("draw_candidates").nullable()
    val drawRoster = array<String>("draw_roster").nullable()
    val drawnAt = timestamp("drawn_at").nullable()

    /** 방의 권역(`capital`·`busan`). 방을 만들 때 정하고, 아무도 남지 않은 방에 참여할 때만 바뀐다. */
    val region = text("region")

    /** 채운 사다리 방을 만든 기기의 복구 키 해시(#227). 일반 방은 null. 앱은 만들 때 쓰고 복구할 때 찾기만 한다. */
    val recoveryHash = binary("recovery_hash").nullable()
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

    /** 방장이 방을 만들 때 대신 넣은 칸(#227). */
    val enteredByHost = bool("entered_by_host")
    override val primaryKey = PrimaryKey(roomId, pid)
}
