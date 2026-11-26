package app.banbanyeok.server.room.exposed

import app.banbanyeok.schema.StationRegion
import app.banbanyeok.schema.TimeBand
import app.banbanyeok.server.room.Activity
import app.banbanyeok.server.room.AddResult
import app.banbanyeok.server.room.Change
import app.banbanyeok.server.room.Decision
import app.banbanyeok.server.room.DecisionRequest
import app.banbanyeok.server.room.DecisionResult
import app.banbanyeok.server.room.DecisionRule
import app.banbanyeok.server.room.DrawRequest
import app.banbanyeok.server.room.DrawResult
import app.banbanyeok.server.room.FavorDraw
import app.banbanyeok.server.room.FavorDrawRule
import app.banbanyeok.server.room.OriginRule
import app.banbanyeok.server.room.Outcome
import app.banbanyeok.server.room.OutcomeKind
import app.banbanyeok.server.room.Participant
import app.banbanyeok.server.room.ParticipantChange
import app.banbanyeok.server.room.Room
import app.banbanyeok.server.room.RoomChange
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomRepository
import app.banbanyeok.server.room.ShareVersion
import app.banbanyeok.server.room.StoredRoom
import app.banbanyeok.server.room.TokenHash
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.core.lessEq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import java.sql.Connection
import java.time.Instant

/** Postgres(Exposed) 구현. 블로킹 JDBC이므로 IO 디스패처에서 트랜잭션 하나로 실행한다. */
public class ExposedRoomRepository(
    private val database: Database,
    private val ioDispatcher: CoroutineDispatcher,
) : RoomRepository {
    override suspend fun create(
        room: Room,
        participants: List<Participant>,
    ) = inTransaction {
        RoomsTable.insert {
            it[id] = room.id
            it[hostHash] = room.hostHash.bytes
            it[hostPid] = room.hostParticipantId
            it[hostAnonId] = room.hostAnonId
            it[mode] = room.mode.name.lowercase()
            it[favorPid] = room.favorParticipantId
            it[dataVersion] = room.dataVersion
            it[meetingDate] = room.meetingDate
            it[meetingTime] = room.meetingTime
            it[meetingBand] = room.meetingBand?.id
            it[expectedCount] = room.expectedCount?.toShort()
            it[status] = statusOf(room.locked)
            it[createdAt] = room.createdAt
            it[lastActivityAt] = room.lastActivityAt
            it[expiresAt] = room.expiresAt
            it[favorDraw] = room.favorDraw != null
            it[region] = requireNotNull(room.region).name.lowercase()
        }
        participants.forEach { insertParticipant(room.id, it) }
    }

    // 방 행과 참여자를 따로 SELECT한다. READ COMMITTED면 그 사이에 커밋된 참여가 섞여 있었던 적 없는 번호·인원 조합이 보이고,
    // 미리보기는 그 `?sv=`로 카카오에 오래 캐시된다. 스냅숏 하나에서 읽는다.
    override suspend fun find(roomId: String): StoredRoom? =
        withContext(ioDispatcher) {
            transaction(database, transactionIsolation = Connection.TRANSACTION_REPEATABLE_READ, readOnly = true) {
                RoomsTable
                    .selectAll()
                    .where { RoomsTable.id eq roomId }
                    .singleOrNull()
                    ?.toRoom()
                    ?.let { StoredRoom(it, participantsOf(roomId)) }
            }
        }

    override suspend fun addParticipant(
        roomId: String,
        participant: Participant,
        activity: Activity,
        origins: OriginRule?,
    ): AddResult =
        inTransaction {
            // 방 행을 잠가 같은 방의 동시 참여를 줄 세운다. 정원 판정이 경쟁 없이 맞다.
            val room = lockedRoom(roomId) ?: return@inTransaction AddResult.RoomNotFound
            val participants = participantsOf(roomId)
            val capacity = minOf(MAX_PARTICIPANTS, room[RoomsTable.expectedCount]?.toInt() ?: MAX_PARTICIPANTS)
            when {
                room[RoomsTable.status] == LOCKED -> {
                    AddResult.Locked
                }

                participants.size >= capacity -> {
                    AddResult.Full
                }

                else -> {
                    val stored = room.toRoom()
                    val joined = origins?.joined(stored, participants, participant.originCode, participant.hidden)
                    if (joined != null && joined.region != stored.region) {
                        RoomsTable.update({ RoomsTable.id eq roomId }) {
                            it[region] =
                                requireNotNull(joined.region).name.lowercase()
                        }
                    }
                    insertParticipant(roomId, participant)
                    touch(roomId, activity)
                    AddResult.Added
                }
            }
        }

    override suspend fun updateParticipant(
        roomId: String,
        participantId: String,
        change: ParticipantChange,
        activity: Activity,
        origins: OriginRule?,
    ): Boolean =
        inTransaction {
            val room = lockedRoom(roomId) ?: return@inTransaction false
            if (origins != null) {
                val participants = participantsOf(roomId)
                val current = participants.firstOrNull { it.id == participantId } ?: return@inTransaction false
                if (change.onlyIfHidden && !current.hidden) return@inTransaction false
                origins.requireAllowed(room.toRoom(), change.originCode, change.hidden)
            }
            val updated =
                ParticipantsTable.update({
                    val target = (ParticipantsTable.roomId eq roomId) and (ParticipantsTable.pid eq participantId)
                    if (change.onlyIfHidden) target and (ParticipantsTable.hidden eq true) else target
                }) {
                    it[nickname] = change.nickname
                    it[originCode] = change.originCode
                    it[hidden] = change.hidden
                    it[updatedAt] = change.updatedAt
                }
            if (updated > 0 && change.releasesDrawWin) {
                // 당첨자가 대상이 될 수 없게 됐다(숨겼다). 당첨자를 비우면 트리거가 뽑기 전으로 돌린다.
                RoomsTable.update({
                    (RoomsTable.id eq roomId) and (RoomsTable.favorDraw eq true) and
                        (RoomsTable.favorPid eq participantId)
                }) {
                    it[favorPid] = null
                }
            }
            if (updated > 0) touch(roomId, activity)
            updated > 0
        }

    override suspend fun removeParticipant(
        roomId: String,
        participantId: String,
        activity: Activity,
    ): Boolean =
        inTransaction {
            if (!lockRoom(roomId)) return@inTransaction false
            val deleted =
                ParticipantsTable.deleteWhere {
                    (ParticipantsTable.roomId eq roomId) and
                        (ParticipantsTable.pid eq participantId)
                }
            if (deleted > 0) {
                RoomsTable.update({ (RoomsTable.id eq roomId) and (RoomsTable.favorPid eq participantId) }) {
                    it[favorPid] = null
                }
                forgetInDraw(roomId, participantId)
                touch(roomId, activity)
            }
            deleted > 0
        }

    /** 뽑기 명단에 남은 나간 사람의 ID를 지운다(당첨자였다면 트리거가 이미 뽑기 전으로 돌려 명단이 비었다). */
    private fun forgetInDraw(
        roomId: String,
        participantId: String,
    ) {
        val draw =
            RoomsTable
                .selectAll()
                .where { RoomsTable.id eq roomId }
                .singleOrNull()
                ?.favorDrawOf()
                ?: return
        if (participantId !in draw.candidates && participantId !in draw.roster) return
        val forgotten = draw.without(participantId)
        RoomsTable.update({ RoomsTable.id eq roomId }) {
            it[drawCandidates] = forgotten.candidates
            it[drawRoster] = forgotten.roster
        }
    }

    override suspend fun updateRoom(
        roomId: String,
        change: RoomChange,
        activity: Activity,
    ): Boolean =
        inTransaction {
            val favor = (change.favorParticipantId as? Change.Set)?.value
            if (favor != null && !lockedRoomHas(roomId, favor)) return@inTransaction false
            val updated =
                RoomsTable.update({
                    if (change.onlyWithoutMeetingTime) {
                        (RoomsTable.id eq roomId) and RoomsTable.meetingTime.isNull()
                    } else {
                        RoomsTable.id eq roomId
                    }
                }) {
                    change.mode?.let { mode -> it[RoomsTable.mode] = mode.name.lowercase() }
                    (change.favorParticipantId as? Change.Set)?.let { set -> it[favorPid] = set.value }
                    change.locked?.let { locked -> it[status] = statusOf(locked) }
                    (change.meetingDate as? Change.Set)?.let { set -> it[meetingDate] = set.value }
                    (change.meetingTime as? Change.Set)?.let { set -> it[meetingTime] = set.value }
                    (change.meetingBand as? Change.Set)?.let { set -> it[meetingBand] = set.value?.id }
                    if (change.endsDraw) {
                        // 지금 당첨자를 그대로 정하면 favor_pid가 같아 트리거가 알 수 없으므로 여기서 끈다.
                        it[favorDraw] = false
                        it[drawRound] = 0
                        it[drawCandidates] = null
                        it[drawRoster] = null
                        it[drawnAt] = null
                    }
                    it[expiresAt] = activity.expiresAt
                    it[lastActivityAt] = activity.at
                }
            updated > 0
        }

    override suspend fun recordOutcome(
        roomId: String,
        outcome: Outcome,
        activity: Activity,
    ): Boolean =
        inTransaction {
            val updated =
                RoomsTable.update({ RoomsTable.id eq roomId }) {
                    it[RoomsTable.outcome] = outcome.kind.name.lowercase()
                    it[outcomeStation] = outcome.stationCode
                    it[lastActivityAt] = activity.at
                    it[expiresAt] = activity.expiresAt
                }
            updated > 0
        }

    override suspend fun writeDecision(
        roomId: String,
        request: DecisionRequest,
        activity: Activity,
        rule: DecisionRule,
    ): DecisionResult =
        inTransaction {
            // 방 행을 잠그면 같은 방의 참여·나가기·출발역 변경(트리거가 방 행을 고친다)과 줄을 선다. 판정과 쓰기 사이에 끼어들 수 없다.
            val room =
                RoomsTable
                    .selectAll()
                    .where { RoomsTable.id eq roomId }
                    .forUpdate()
                    .singleOrNull()
                    ?.toRoom()
                    ?: return@inTransaction DecisionResult.RoomNotFound
            rule.verdict(room, participantsOf(roomId), request).also { verdict ->
                if (verdict == DecisionResult.Applied) {
                    RoomsTable.update({ RoomsTable.id eq roomId }) {
                        it[decidedStation] = request.decision?.stationCode
                        it[decidedByPid] = request.decision?.decidedBy
                        it[decidedAt] = request.decision?.decidedAt
                        it[lastActivityAt] = activity.at
                        it[expiresAt] = activity.expiresAt
                    }
                }
            }
        }

    override suspend fun writeDraw(
        roomId: String,
        request: DrawRequest,
        activity: Activity,
        rule: FavorDrawRule,
    ): DrawResult =
        inTransaction {
            // 정하기와 같은 잠금: 참여·나가기·숨기기(트리거가 방 행을 고친다)와 줄을 서므로 대상이 뽑는 순간의 방과 같다.
            val room =
                RoomsTable
                    .selectAll()
                    .where { RoomsTable.id eq roomId }
                    .forUpdate()
                    .singleOrNull()
                    ?.toRoom()
                    ?: return@inTransaction DrawResult.RoomNotFound
            rule.verdict(room, participantsOf(roomId), request).also { result ->
                if (result is DrawResult.Drawn) {
                    RoomsTable.update({ RoomsTable.id eq roomId }) {
                        it[favorPid] = result.winner
                        it[drawRound] = result.draw.round.toShort()
                        it[drawCandidates] = result.draw.candidates
                        it[drawRoster] = result.draw.roster
                        it[drawnAt] = result.draw.drawnAt
                        it[lastActivityAt] = activity.at
                        it[expiresAt] = activity.expiresAt
                    }
                }
            }
        }

    override suspend fun delete(roomId: String): Boolean = inTransaction { RoomsTable.deleteWhere { id eq roomId } > 0 }

    override suspend fun deleteExpired(now: Instant): Int =
        inTransaction {
            RoomsTable.deleteWhere {
                expiresAt lessEq
                    now
            }
        }

    private suspend fun <T> inTransaction(block: () -> T): T =
        withContext(ioDispatcher) { transaction(database) { block() } }

    private fun insertParticipant(
        roomId: String,
        participant: Participant,
    ) {
        ParticipantsTable.insert {
            it[this.roomId] = roomId
            it[pid] = participant.id
            it[anonId] = participant.anonId
            it[tokenHash] = participant.tokenHash.bytes
            it[nickname] = participant.nickname
            it[originCode] = participant.originCode
            it[hidden] = participant.hidden
            it[joinedAt] = participant.joinedAt
            it[updatedAt] = participant.updatedAt
            it[enteredByHost] = participant.enteredByHost
        }
    }

    /**
     * 방 행을 잠근 뒤 참여자를 본다. 나가기는 참여자 트리거가 같은 방 행을 고치므로 이 잠금과 줄을 선다. 나가기가 먼저 커밋되면 이 확인이
     * 그 사람이 없음을 보고, 나중이면 나가기가 우대 대상을 비운다. 어느 쪽이든 나간 사람이 우대 대상으로 남지 않는다.
     */
    private fun lockedRoomHas(
        roomId: String,
        participantId: String,
    ): Boolean {
        if (!lockRoom(roomId)) return false
        return ParticipantsTable
            .select(ParticipantsTable.pid)
            .where { (ParticipantsTable.roomId eq roomId) and (ParticipantsTable.pid eq participantId) }
            .any()
    }

    private fun lockedRoom(roomId: String): ResultRow? =
        RoomsTable
            .selectAll()
            .where { RoomsTable.id eq roomId }
            .forUpdate()
            .singleOrNull()

    private fun lockRoom(roomId: String): Boolean =
        RoomsTable
            .select(RoomsTable.id)
            .where { RoomsTable.id eq roomId }
            .forUpdate()
            .singleOrNull() != null

    private fun touch(
        roomId: String,
        activity: Activity,
    ) {
        RoomsTable.update({ RoomsTable.id eq roomId }) {
            it[lastActivityAt] = activity.at
            it[expiresAt] = activity.expiresAt
        }
    }

    private fun participantsOf(roomId: String): List<Participant> =
        ParticipantsTable
            .selectAll()
            .where { ParticipantsTable.roomId eq roomId }
            .orderBy(
                ParticipantsTable.joinedAt to org.jetbrains.exposed.v1.core.SortOrder.ASC,
                ParticipantsTable.pid to org.jetbrains.exposed.v1.core.SortOrder.ASC,
            ).map { it.toParticipant() }

    private fun ResultRow.toRoom() =
        Room(
            id = this[RoomsTable.id],
            hostHash = TokenHash(this[RoomsTable.hostHash]),
            hostParticipantId = this[RoomsTable.hostPid],
            hostAnonId = this[RoomsTable.hostAnonId],
            mode = RoomMode.valueOf(this[RoomsTable.mode].uppercase()),
            favorParticipantId = this[RoomsTable.favorPid],
            dataVersion = this[RoomsTable.dataVersion],
            meetingDate = this[RoomsTable.meetingDate],
            meetingTime = this[RoomsTable.meetingTime],
            meetingBand = this[RoomsTable.meetingBand]?.let(TimeBand::parseOrNull),
            expectedCount = this[RoomsTable.expectedCount]?.toInt(),
            locked = this[RoomsTable.status] == LOCKED,
            outcome =
                this[RoomsTable.outcome]?.let {
                    Outcome(OutcomeKind.valueOf(it.uppercase()), this[RoomsTable.outcomeStation])
                },
            createdAt = this[RoomsTable.createdAt],
            lastActivityAt = this[RoomsTable.lastActivityAt],
            expiresAt = this[RoomsTable.expiresAt],
            shareVersion = ShareVersion(this[RoomsTable.shareVersion]),
            decisionBasis = ShareVersion(this[RoomsTable.decisionBasisVersion]),
            decision = decisionOf(),
            favorDraw = favorDrawOf(),
            // 이 서버보다 새 서버가 더한 권역이면 null이다(어떤 역도 받지 않는다).
            region = StationRegion.entries.firstOrNull { it.name.lowercase() == this[RoomsTable.region] },
        )

    /** CHECK rooms_draw_complete가 회차 0 ⇔ 대상·명단·시각 없음을 보장한다. */
    private fun ResultRow.favorDrawOf(): FavorDraw? {
        if (!this[RoomsTable.favorDraw]) return null
        return FavorDraw(
            generation = this[RoomsTable.drawGeneration],
            round = this[RoomsTable.drawRound].toInt(),
            candidates = this[RoomsTable.drawCandidates].orEmpty(),
            roster = this[RoomsTable.drawRoster].orEmpty(),
            drawnAt = this[RoomsTable.drawnAt],
        )
    }

    /** CHECK rooms_decision_complete가 세 칸이 함께 있거나 함께 없음을 보장한다. */
    private fun ResultRow.decisionOf(): Decision? {
        val station = this[RoomsTable.decidedStation] ?: return null
        return Decision(
            station,
            requireNotNull(this[RoomsTable.decidedByPid]),
            requireNotNull(this[RoomsTable.decidedAt]),
        )
    }

    private fun ResultRow.toParticipant() =
        Participant(
            id = this[ParticipantsTable.pid],
            tokenHash = TokenHash(this[ParticipantsTable.tokenHash]),
            anonId = this[ParticipantsTable.anonId],
            nickname = this[ParticipantsTable.nickname],
            originCode = this[ParticipantsTable.originCode],
            hidden = this[ParticipantsTable.hidden],
            joinedAt = this[ParticipantsTable.joinedAt],
            updatedAt = this[ParticipantsTable.updatedAt],
            enteredByHost = this[ParticipantsTable.enteredByHost],
        )

    private fun statusOf(locked: Boolean) = if (locked) LOCKED else OPEN

    private companion object {
        const val MAX_PARTICIPANTS = 4
        const val LOCKED = "locked"
        const val OPEN = "open"
    }
}
