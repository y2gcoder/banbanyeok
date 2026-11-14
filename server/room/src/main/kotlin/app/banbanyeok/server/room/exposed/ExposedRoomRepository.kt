package app.banbanyeok.server.room.exposed

import app.banbanyeok.server.room.Activity
import app.banbanyeok.server.room.AddResult
import app.banbanyeok.server.room.Change
import app.banbanyeok.server.room.Outcome
import app.banbanyeok.server.room.OutcomeKind
import app.banbanyeok.server.room.Participant
import app.banbanyeok.server.room.ParticipantChange
import app.banbanyeok.server.room.Room
import app.banbanyeok.server.room.RoomChange
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomRepository
import app.banbanyeok.server.room.StoredRoom
import app.banbanyeok.server.room.TokenHash
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.lessEq
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import java.time.Instant

/** Postgres(Exposed) 구현. 블로킹 JDBC이므로 IO 디스패처에서 트랜잭션 하나로 실행한다. */
public class ExposedRoomRepository(
    private val database: Database,
) : RoomRepository {
    override suspend fun create(
        room: Room,
        host: Participant,
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
            it[expectedCount] = room.expectedCount?.toShort()
            it[status] = statusOf(room.locked)
            it[createdAt] = room.createdAt
            it[lastActivityAt] = room.lastActivityAt
            it[expiresAt] = room.expiresAt
        }
        insertParticipant(room.id, host)
    }

    override suspend fun find(roomId: String): StoredRoom? =
        inTransaction {
            val room =
                RoomsTable
                    .selectAll()
                    .where { RoomsTable.id eq roomId }
                    .singleOrNull()
                    ?.toRoom()
            room?.let {
                StoredRoom(it, participantsOf(roomId))
            }
        }

    override suspend fun addParticipant(
        roomId: String,
        participant: Participant,
        activity: Activity,
    ): AddResult =
        inTransaction {
            // 방 행을 잠가 같은 방의 동시 참여를 줄 세운다. 정원 판정이 경쟁 없이 맞다.
            val room =
                RoomsTable
                    .selectAll()
                    .where { RoomsTable.id eq roomId }
                    .forUpdate()
                    .singleOrNull()
                    ?: return@inTransaction AddResult.RoomNotFound
            val count =
                ParticipantsTable
                    .selectAll()
                    .where { ParticipantsTable.roomId eq roomId }
                    .count()
                    .toInt()
            val capacity = minOf(MAX_PARTICIPANTS, room[RoomsTable.expectedCount]?.toInt() ?: MAX_PARTICIPANTS)
            when {
                room[RoomsTable.status] == LOCKED -> AddResult.Locked
                count >= capacity -> AddResult.Full
                else -> {
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
    ): Boolean =
        inTransaction {
            val updated =
                ParticipantsTable.update({
                    (ParticipantsTable.roomId eq roomId) and
                        (ParticipantsTable.pid eq participantId)
                }) {
                    it[nickname] = change.nickname
                    it[originCode] = change.originCode
                    it[hidden] = change.hidden
                    it[updatedAt] = change.updatedAt
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
            val deleted =
                ParticipantsTable.deleteWhere {
                    (ParticipantsTable.roomId eq roomId) and
                        (ParticipantsTable.pid eq participantId)
                }
            if (deleted > 0) {
                RoomsTable.update({ (RoomsTable.id eq roomId) and (RoomsTable.favorPid eq participantId) }) {
                    it[favorPid] = null
                }
                touch(roomId, activity)
            }
            deleted > 0
        }

    override suspend fun updateRoom(
        roomId: String,
        change: RoomChange,
        activity: Activity,
    ): Boolean =
        inTransaction {
            val updated =
                RoomsTable.update({ RoomsTable.id eq roomId }) {
                    change.mode?.let { mode -> it[RoomsTable.mode] = mode.name.lowercase() }
                    (change.favorParticipantId as? Change.Set)?.let { set -> it[favorPid] = set.value }
                    change.locked?.let { locked -> it[status] = statusOf(locked) }
                    (change.meetingDate as? Change.Set)?.let { set -> it[meetingDate] = set.value }
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

    override suspend fun delete(roomId: String): Boolean = inTransaction { RoomsTable.deleteWhere { id eq roomId } > 0 }

    override suspend fun deleteExpired(now: Instant): Int =
        inTransaction {
            RoomsTable.deleteWhere {
                expiresAt lessEq
                    now
            }
        }

    private suspend fun <T> inTransaction(block: () -> T): T =
        withContext(Dispatchers.IO) { transaction(database) { block() } }

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
        }
    }

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
            expectedCount = this[RoomsTable.expectedCount]?.toInt(),
            locked = this[RoomsTable.status] == LOCKED,
            outcome =
                this[RoomsTable.outcome]?.let {
                    Outcome(OutcomeKind.valueOf(it.uppercase()), this[RoomsTable.outcomeStation])
                },
            createdAt = this[RoomsTable.createdAt],
            lastActivityAt = this[RoomsTable.lastActivityAt],
            expiresAt = this[RoomsTable.expiresAt],
        )

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
        )

    private fun statusOf(locked: Boolean) = if (locked) LOCKED else OPEN

    private companion object {
        const val MAX_PARTICIPANTS = 4
        const val LOCKED = "locked"
        const val OPEN = "open"
    }
}
