package app.banbanyeok.server.room

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant

/** 테스트용 메모리 fake. Exposed 구현과 같은 계약 테스트([roomRepositoryContract])를 통과한다. */
class InMemoryRoomRepository : RoomRepository {
    private val lock = Mutex()
    private val rooms = LinkedHashMap<String, Room>()
    private val participants = LinkedHashMap<String, MutableList<Participant>>()

    override suspend fun create(
        room: Room,
        host: Participant,
    ) = lock.withLock {
        check(room.id !in rooms) { "duplicate room id" }
        rooms[room.id] = room
        participants[room.id] = mutableListOf(host)
    }

    override suspend fun find(roomId: String): StoredRoom? =
        lock.withLock {
            rooms[roomId]?.let { StoredRoom(it, ordered(roomId)) }
        }

    override suspend fun addParticipant(
        roomId: String,
        participant: Participant,
        activity: Activity,
    ): AddResult =
        lock.withLock {
            val room = rooms[roomId] ?: return@withLock AddResult.RoomNotFound
            val list = participants.getValue(roomId)
            val capacity = minOf(MAX_PARTICIPANTS, room.expectedCount ?: MAX_PARTICIPANTS)
            when {
                room.locked -> AddResult.Locked
                list.size >= capacity -> AddResult.Full
                else -> {
                    list += participant
                    touch(room, activity)
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
        lock.withLock {
            val list = participants[roomId] ?: return@withLock false
            val index = list.indexOfFirst { it.id == participantId }
            if (index < 0) return@withLock false
            list[index] =
                list[index].copy(
                    nickname = change.nickname,
                    originCode = change.originCode,
                    hidden = change.hidden,
                    updatedAt = change.updatedAt,
                )
            touch(rooms.getValue(roomId), activity)
            true
        }

    override suspend fun removeParticipant(
        roomId: String,
        participantId: String,
        activity: Activity,
    ): Boolean =
        lock.withLock {
            val list = participants[roomId] ?: return@withLock false
            if (!list.removeAll { it.id == participantId }) return@withLock false
            val room = rooms.getValue(roomId)
            rooms[roomId] =
                room.copy(favorParticipantId = room.favorParticipantId.takeIf { it != participantId })
            touch(rooms.getValue(roomId), activity)
            true
        }

    override suspend fun updateRoom(
        roomId: String,
        change: RoomChange,
        activity: Activity,
    ): Boolean =
        lock.withLock {
            val room = rooms[roomId] ?: return@withLock false
            rooms[roomId] =
                room.copy(
                    mode = change.mode ?: room.mode,
                    favorParticipantId =
                        (change.favorParticipantId as? Change.Set)?.value
                            ?: room.favorParticipantId.takeIf { change.favorParticipantId is Change.Unchanged },
                    locked = change.locked ?: room.locked,
                    meetingDate =
                        (change.meetingDate as? Change.Set)?.value
                            ?: room.meetingDate.takeIf { change.meetingDate is Change.Unchanged },
                    lastActivityAt = activity.at,
                    expiresAt = activity.expiresAt,
                )
            true
        }

    override suspend fun recordOutcome(
        roomId: String,
        outcome: Outcome,
        activity: Activity,
    ): Boolean =
        lock.withLock {
            val room = rooms[roomId] ?: return@withLock false
            rooms[roomId] = room.copy(outcome = outcome)
            touch(rooms.getValue(roomId), activity)
            true
        }

    override suspend fun delete(roomId: String): Boolean =
        lock.withLock {
            participants.remove(roomId)
            rooms.remove(roomId) != null
        }

    override suspend fun deleteExpired(now: Instant): Int =
        lock.withLock {
            val expired = rooms.values.filter { !it.expiresAt.isAfter(now) }.map { it.id }
            expired.forEach {
                rooms.remove(it)
                participants.remove(it)
            }
            expired.size
        }

    /** 익명 사용자 fake가 참조 여부를 판단하는 데 쓴다. */
    internal suspend fun referencedAnonIds(): Set<String> =
        lock.withLock {
            (rooms.values.mapNotNull { it.hostAnonId } + participants.values.flatten().mapNotNull { it.anonId }).toSet()
        }

    private fun ordered(roomId: String) =
        participants.getValue(roomId).sortedWith(compareBy({ it.joinedAt }, { it.id }))

    private fun touch(
        room: Room,
        activity: Activity,
    ) {
        rooms[room.id] = rooms.getValue(room.id).copy(lastActivityAt = activity.at, expiresAt = activity.expiresAt)
    }

    private companion object {
        const val MAX_PARTICIPANTS = 4
    }
}

class InMemoryAnonUserRepository(
    private val rooms: InMemoryRoomRepository,
) : AnonUserRepository {
    private val lock = Mutex()
    private val users = LinkedHashMap<String, AnonUser>()

    override suspend fun create(user: AnonUser) =
        lock.withLock {
            check(users.values.none { it.deviceHash == user.deviceHash }) { "duplicate device hash" }
            users[user.id] = user
        }

    override suspend fun findByDeviceHash(hash: TokenHash): AnonUser? =
        lock.withLock {
            users.values.firstOrNull {
                it.deviceHash ==
                    hash
            }
        }

    override suspend fun touch(
        id: String,
        at: Instant,
    ) = lock.withLock {
        users[id]?.let { users[id] = it.copy(lastSeenAt = at) }
        Unit
    }

    override suspend fun deleteInactive(lastSeenBefore: Instant): Int {
        val referenced = rooms.referencedAnonIds()
        return lock.withLock {
            val stale =
                users.values
                    .filter {
                        it.lastSeenAt.isBefore(
                            lastSeenBefore,
                        ) && it.id !in referenced
                    }.map { it.id }
            stale.forEach(users::remove)
            stale.size
        }
    }
}
