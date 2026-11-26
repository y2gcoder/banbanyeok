package app.banbanyeok.server.room

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant

/**
 * 테스트용 메모리 fake. Exposed 구현과 같은 계약 테스트([roomRepositoryContract])를 통과한다.
 * 모든 쓰기는 [write]를 지나 SQL 문장 하나처럼 적용되고, 공유 번호와 정한 역은 DB 트리거의 거울([settle])이 맞춘다.
 */
class InMemoryRoomRepository : RoomRepository {
    private val lock = Mutex()
    private val rooms = LinkedHashMap<String, StoredRoom>()

    override suspend fun create(
        room: Room,
        participants: List<Participant>,
    ) = lock.withLock {
        check(room.id !in rooms) { "duplicate room id" }
        rooms[room.id] = StoredRoom(room, emptyList())
        write(room.id) { it.copy(participants = participants) }
    }

    override suspend fun find(roomId: String): StoredRoom? =
        lock.withLock {
            rooms[roomId]?.let {
                it.copy(
                    participants = it.participants.sortedWith(compareBy({ p -> p.joinedAt }, { p -> p.id })),
                )
            }
        }

    override suspend fun addParticipant(
        roomId: String,
        participant: Participant,
        activity: Activity,
        origins: OriginRule?,
    ): AddResult =
        lock.withLock {
            val stored = rooms[roomId] ?: return@withLock AddResult.RoomNotFound
            val capacity = minOf(MAX_PARTICIPANTS, stored.room.expectedCount ?: MAX_PARTICIPANTS)
            when {
                stored.room.locked -> {
                    AddResult.Locked
                }

                stored.participants.size >= capacity -> {
                    AddResult.Full
                }

                else -> {
                    val room =
                        origins?.joined(stored.room, stored.participants, participant.originCode, participant.hidden)
                            ?: stored.room
                    write(roomId) { it.copy(room = room, participants = it.participants + participant) }
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
        lock.withLock {
            val stored = rooms[roomId] ?: return@withLock false
            val current = stored.participants.firstOrNull { it.id == participantId } ?: return@withLock false
            if (change.onlyIfHidden && !current.hidden) return@withLock false
            origins?.requireAllowed(stored.room, change.originCode, change.hidden)
            write(roomId) {
                it.copy(
                    participants =
                        it.participants.map { p ->
                            if (p.id != participantId) {
                                p
                            } else {
                                p.copy(
                                    nickname = change.nickname,
                                    originCode = change.originCode,
                                    hidden = change.hidden,
                                    updatedAt = change.updatedAt,
                                )
                            }
                        },
                )
            }
            val room = rooms.getValue(roomId).room
            if (change.releasesDrawWin && room.favorDraw != null && room.favorParticipantId == participantId) {
                write(roomId) { it.copy(room = it.room.copy(favorParticipantId = null)) }
            }
            touch(roomId, activity)
            true
        }

    override suspend fun removeParticipant(
        roomId: String,
        participantId: String,
        activity: Activity,
    ): Boolean =
        lock.withLock {
            val stored = rooms[roomId] ?: return@withLock false
            if (stored.participants.none { it.id == participantId }) return@withLock false
            write(roomId) { it.copy(participants = it.participants.filter { p -> p.id != participantId }) }
            if (stored.room.favorParticipantId == participantId) {
                write(roomId) { it.copy(room = it.room.copy(favorParticipantId = null)) }
            }
            val draw = rooms.getValue(roomId).room.favorDraw
            if (draw != null && (participantId in draw.candidates || participantId in draw.roster)) {
                write(roomId) { it.copy(room = it.room.copy(favorDraw = draw.without(participantId))) }
            }
            touch(roomId, activity)
            true
        }

    override suspend fun updateRoom(
        roomId: String,
        change: RoomChange,
        activity: Activity,
    ): Boolean =
        lock.withLock {
            val stored = rooms[roomId] ?: return@withLock false
            val room = stored.room
            if (change.onlyWithoutMeetingTime && room.meetingTime != null) return@withLock false
            val favor = (change.favorParticipantId as? Change.Set)?.value
            if (favor != null && stored.participants.none { it.id == favor }) return@withLock false
            write(roomId) {
                it.copy(
                    room =
                        room.copy(
                            mode = change.mode ?: room.mode,
                            favorParticipantId = change.favorParticipantId.or(room.favorParticipantId),
                            locked = change.locked ?: room.locked,
                            meetingDate = change.meetingDate.or(room.meetingDate),
                            meetingTime = change.meetingTime.or(room.meetingTime),
                            meetingBand = change.meetingBand.or(room.meetingBand),
                            favorDraw = if (change.endsDraw) null else room.favorDraw,
                            lastActivityAt = activity.at,
                            expiresAt = activity.expiresAt,
                        ),
                )
            }
            true
        }

    override suspend fun recordOutcome(
        roomId: String,
        outcome: Outcome,
        activity: Activity,
    ): Boolean =
        lock.withLock {
            if (roomId !in rooms) return@withLock false
            write(roomId) {
                it.copy(
                    room =
                        it.room.copy(
                            outcome = outcome,
                            lastActivityAt = activity.at,
                            expiresAt = activity.expiresAt,
                        ),
                )
            }
            true
        }

    override suspend fun writeDecision(
        roomId: String,
        request: DecisionRequest,
        activity: Activity,
        rule: DecisionRule,
    ): DecisionResult =
        lock.withLock {
            val stored = rooms[roomId] ?: return@withLock DecisionResult.RoomNotFound
            rule.verdict(stored.room, stored.participants, request).also { verdict ->
                if (verdict == DecisionResult.Applied) {
                    write(roomId) {
                        it.copy(
                            room =
                                it.room.copy(
                                    decision = request.decision,
                                    lastActivityAt = activity.at,
                                    expiresAt = activity.expiresAt,
                                ),
                        )
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
        lock.withLock {
            val stored = rooms[roomId] ?: return@withLock DrawResult.RoomNotFound
            val participants = stored.participants.sortedWith(compareBy({ p -> p.joinedAt }, { p -> p.id }))
            rule.verdict(stored.room, participants, request).also { result ->
                if (result is DrawResult.Drawn) {
                    write(roomId) {
                        it.copy(
                            room =
                                it.room.copy(
                                    favorParticipantId = result.winner,
                                    favorDraw = result.draw,
                                    lastActivityAt = activity.at,
                                    expiresAt = activity.expiresAt,
                                ),
                        )
                    }
                }
            }
        }

    override suspend fun delete(roomId: String): Boolean = lock.withLock { rooms.remove(roomId) != null }

    override suspend fun deleteExpired(now: Instant): Int =
        lock.withLock {
            val expired = rooms.values.filter { !it.room.expiresAt.isAfter(now) }.map { it.room.id }
            expired.forEach(rooms::remove)
            expired.size
        }

    /** 익명 사용자 fake가 참조 여부를 판단하는 데 쓴다. */
    internal suspend fun referencedAnonIds(): Set<String> =
        lock.withLock {
            rooms.values
                .flatMap { stored -> listOf(stored.room.hostAnonId) + stored.participants.map { it.anonId } }
                .filterNotNull()
                .toSet()
        }

    private fun write(
        roomId: String,
        change: (StoredRoom) -> StoredRoom,
    ) {
        val before = rooms.getValue(roomId)
        val after = change(before)
        rooms[roomId] = after.copy(room = settle(before, after))
    }

    private fun touch(
        roomId: String,
        activity: Activity,
    ) = write(roomId) { it.copy(room = it.room.copy(lastActivityAt = activity.at, expiresAt = activity.expiresAt)) }

    private fun <T> Change<T>.or(current: T?): T? =
        when (this) {
            Change.Unchanged -> current
            is Change.Set -> value
        }

    private companion object {
        const val MAX_PARTICIPANTS = 4
    }
}

/**
 * DB 트리거(changeset 20261117-room-share-version의 두 트리거, 20261125-favor-draw의 rooms_draw_state)의 거울. 쓰기 한 번의 전후를 비교한다. 참여·나가기·출발역 변경은
 * 정한 역을 풀고, 별칭·숨기기·미리보기에 보이는 방 칸·정한 역·뽑기 변경은 번호만 올린다. 활동 시각과 결과 설문은 올리지 않는다.
 * 앱이 넣은 번호는 무시한다. 뽑기 방에서 기준·대상을 직접 바꾸면 뽑기 방이 아니게 되고, 당첨자가 비면 뽑기 전으로 돌아간다.
 */
internal fun settle(
    before: StoredRoom,
    after: StoredRoom,
): Room {
    val old = before.room
    val new = drawSettled(old, after.room.copy(shareVersion = old.shareVersion, decisionBasis = old.decisionBasis))
    val was = before.participants.associateBy { it.id }
    val kept = after.participants.mapNotNull { p -> was[p.id]?.let { it to p } }
    val releases =
        was.keys != after.participants.map { it.id }.toSet() || kept.any { (o, n) -> o.originCode != n.originCode }
    val looks = kept.any { (o, n) -> o.nickname != n.nickname || o.hidden != n.hidden }
    val decisionChanged = releases || new.decision != old.decision
    if (!decisionChanged && !looks && new.previewColumns() == old.previewColumns()) return new
    val version = ShareVersion(old.shareVersion.value + 1)
    return new.copy(
        shareVersion = version,
        decisionBasis = if (decisionChanged) version else old.decisionBasis,
        decision = if (releases) null else new.decision,
    )
}

private fun drawSettled(
    old: Room,
    new: Room,
): Room {
    val draw = new.favorDraw ?: return new
    val favor = new.favorParticipantId
    val before = old.favorDraw
    val direct =
        new.mode != RoomMode.FAVOR ||
            (
                favor != null &&
                    favor != old.favorParticipantId &&
                    draw.round == (before?.round ?: 0) &&
                    draw.generation == (before?.generation ?: 0)
            )
    return when {
        direct -> {
            new.copy(favorDraw = null)
        }

        favor == null && draw.round > 0 -> {
            new.copy(
                favorDraw = FavorDraw.PENDING.copy(generation = draw.generation + 1),
            )
        }

        else -> {
            new
        }
    }
}

private fun Room.previewColumns() =
    listOf(
        mode,
        favorParticipantId,
        locked,
        expectedCount,
        meetingDate,
        meetingTime,
        meetingBand,
        favorDraw != null,
        favorDraw?.generation,
        favorDraw?.round,
        favorDraw?.drawnAt,
    )

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
