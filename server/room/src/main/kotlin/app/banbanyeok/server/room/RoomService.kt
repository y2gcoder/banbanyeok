package app.banbanyeok.server.room

import app.banbanyeok.links.NicknameRules
import app.banbanyeok.schema.StationCode
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate

/**
 * 방 유스케이스. Ktor를 모르는 일반 클래스이고 오류는 [RoomException]으로 알린다(HTTP 상태 변환은 app 몫).
 * 만료는 읽을 때 판정한다(만료된 방은 없는 방과 같다). 정리 명령([cleanup])이 실제로 지운다.
 */
public class RoomService(
    private val rooms: RoomRepository,
    private val anonUsers: AnonUserRepository,
    private val tokens: TokenService,
    private val ids: IdGenerator,
    private val stations: StationCatalog,
    private val clock: Clock,
) {
    public suspend fun create(command: CreateRoomCommand): CreatedRoom {
        val now = clock.instant()
        val host = validated(command.host)
        validateCreation(command, now)
        val roomId = ids.roomId()
        val hostParticipantId = ids.participantId()
        val hostToken = tokens.issue()
        val participantToken = tokens.issue()
        val expiresAt = ExpiryPolicy.expiresAt(now, now, command.meetingDate)
        val anonId = anonIdOf(command.deviceToken, now)
        rooms.create(
            Room(
                id = roomId,
                hostHash = hostToken.hash,
                hostParticipantId = hostParticipantId,
                hostAnonId = anonId,
                mode = command.mode,
                favorParticipantId = if (command.mode == RoomMode.FAVOR) hostParticipantId else null,
                dataVersion = stations.dataVersion,
                meetingDate = command.meetingDate,
                expectedCount = command.expectedCount,
                locked = false,
                outcome = null,
                createdAt = now,
                lastActivityAt = now,
                expiresAt = expiresAt,
            ),
            newParticipant(hostParticipantId, participantToken.hash, anonId, host, now),
        )
        return CreatedRoom(roomId, hostToken.plain, hostParticipantId, participantToken.plain, expiresAt)
    }

    public suspend fun join(
        roomId: String,
        input: ParticipantInput,
        deviceToken: String?,
    ): JoinedRoom {
        val now = clock.instant()
        val room = loadActive(roomId, now).room
        val participant = validated(input)
        val participantId = ids.participantId()
        val token = tokens.issue()
        val participantEntity = newParticipant(participantId, token.hash, anonIdOf(deviceToken, now), participant, now)
        when (rooms.addParticipant(room.id, participantEntity, activityOf(room, room.meetingDate, now))) {
            AddResult.Added -> Unit
            AddResult.RoomNotFound -> reject(RoomError.ROOM_NOT_FOUND, "방을 찾을 수 없습니다")
            AddResult.Full -> reject(RoomError.ROOM_FULL, "방이 가득 찼습니다")
            AddResult.Locked -> reject(RoomError.ROOM_LOCKED, "방이 잠겼습니다")
        }
        return JoinedRoom(participantId, token.plain)
    }

    /** 토큰은 선택이다. 유효한 participantToken이면 본인 항목의 출발역이 숨김이어도 보인다. 잘못된 토큰은 무시한다. */
    public suspend fun get(
        roomId: String,
        viewerToken: String?,
    ): RoomView {
        val stored = loadActive(roomId, clock.instant())
        return viewOf(stored, (caller(stored, viewerToken) as? Caller.Member)?.participantId)
    }

    public suspend fun loadForResult(
        roomId: String,
        viewerToken: String?,
    ): RoomResultContext {
        val stored = loadActive(roomId, clock.instant())
        val selfId = (caller(stored, viewerToken) as? Caller.Member)?.participantId
        return RoomResultContext(
            viewOf(stored, selfId),
            stored.participants.map { ComputeParticipant(it.id, it.nickname, it.originCode) },
        )
    }

    public suspend fun updateParticipant(
        roomId: String,
        participantId: String,
        token: String?,
        input: ParticipantInput,
    ): ParticipantView {
        val now = clock.instant()
        val stored = loadActive(roomId, now)
        if (stored.participants.none { it.id == participantId }) {
            reject(RoomError.PARTICIPANT_NOT_FOUND, "참여자를 찾을 수 없습니다")
        }
        val caller = requireCaller(stored, token)
        if (caller !is Caller.Member || caller.participantId != participantId) {
            reject(RoomError.FORBIDDEN, "본인 항목만 고칠 수 있습니다")
        }
        val value = validated(input)
        val change = ParticipantChange(value.nickname, value.originCode, value.hidden, now)
        val activity = activityOf(stored.room, stored.room.meetingDate, now)
        if (!rooms.updateParticipant(roomId, participantId, change, activity)) {
            reject(RoomError.PARTICIPANT_NOT_FOUND, "참여자를 찾을 수 없습니다")
        }
        return get(roomId, token).participants.first { it.id == participantId }
    }

    /** 본인 항목 삭제, 또는 방장이 강퇴한다. */
    public suspend fun removeParticipant(
        roomId: String,
        participantId: String,
        token: String?,
    ) {
        val now = clock.instant()
        val stored = loadActive(roomId, now)
        if (stored.participants.none { it.id == participantId }) {
            reject(RoomError.PARTICIPANT_NOT_FOUND, "참여자를 찾을 수 없습니다")
        }
        val caller = requireCaller(stored, token)
        val allowed = caller is Caller.Host || (caller is Caller.Member && caller.participantId == participantId)
        if (!allowed) reject(RoomError.FORBIDDEN, "본인 항목이거나 방장만 지울 수 있습니다")
        rooms.removeParticipant(roomId, participantId, activityOf(stored.room, stored.room.meetingDate, now))
    }

    public suspend fun updateRoom(
        roomId: String,
        hostToken: String?,
        patch: RoomPatch,
    ): RoomView {
        val now = clock.instant()
        val stored = loadActive(roomId, now)
        requireHost(stored, hostToken)
        val meetingDate =
            when (val requested = patch.meetingDate) {
                Change.Unchanged -> stored.room.meetingDate
                is Change.Set -> requested.value?.also { checkMeetingDate(it, now) }
            }
        val change =
            RoomChange(
                mode = patch.mode,
                favorParticipantId = favorChange(stored, patch),
                locked = patch.locked,
                meetingDate = patch.meetingDate,
            )
        val expiresAt = ExpiryPolicy.expiresAt(stored.room.createdAt, now, meetingDate)
        if (!rooms.updateRoom(roomId, change, Activity(now, expiresAt))) {
            reject(RoomError.ROOM_NOT_FOUND, "방을 찾을 수 없습니다")
        }
        return viewOf(loadActive(roomId, now), null)
    }

    public suspend fun delete(
        roomId: String,
        hostToken: String?,
    ) {
        val stored = loadActive(roomId, clock.instant())
        requireHost(stored, hostToken)
        rooms.delete(roomId)
    }

    public suspend fun recordOutcome(
        roomId: String,
        token: String?,
        outcome: Outcome,
    ) {
        val now = clock.instant()
        val stored = loadActive(roomId, now)
        val caller = requireCaller(stored, token)
        if (caller !is Caller.Member) reject(RoomError.FORBIDDEN, "참여자만 답할 수 있습니다")
        if (outcome.stationCode != null && StationCode.parseOrNull(outcome.stationCode) == null) {
            reject(RoomError.INVALID_OUTCOME, "역 코드가 올바르지 않습니다")
        }
        rooms.recordOutcome(roomId, outcome, activityOf(stored.room, stored.room.meetingDate, now))
    }

    /** 만료된 방과 오래 쓰지 않은 익명 사용자를 지운다. 스케줄러가 아니라 운영 명령으로 실행한다. */
    public suspend fun cleanup(): CleanupReport {
        val now = clock.instant()
        return CleanupReport(rooms.deleteExpired(now), anonUsers.deleteInactive(now.minus(ANON_RETENTION)))
    }

    // ---- 내부 ----

    private sealed interface Caller {
        data object Anonymous : Caller

        data object Unknown : Caller

        data object Host : Caller

        data class Member(
            val participantId: String,
        ) : Caller
    }

    private suspend fun loadActive(
        roomId: String,
        now: Instant,
    ): StoredRoom {
        val stored = rooms.find(roomId.lowercase())
        if (stored == null || ExpiryPolicy.isExpired(stored.room, now)) {
            reject(RoomError.ROOM_NOT_FOUND, "방을 찾을 수 없습니다")
        }
        return stored
    }

    private fun caller(
        stored: StoredRoom,
        token: String?,
    ): Caller {
        if (token == null) return Caller.Anonymous
        val hash = tokens.hash(token)
        if (hash == stored.room.hostHash) return Caller.Host
        val member = stored.participants.firstOrNull { it.tokenHash == hash } ?: return Caller.Unknown
        return Caller.Member(member.id)
    }

    private fun requireCaller(
        stored: StoredRoom,
        token: String?,
    ): Caller =
        caller(stored, token).also {
            if (it is Caller.Anonymous || it is Caller.Unknown) reject(RoomError.UNAUTHORIZED, "인증이 필요합니다")
        }

    private fun requireHost(
        stored: StoredRoom,
        token: String?,
    ) {
        if (requireCaller(stored, token) !is Caller.Host) reject(RoomError.FORBIDDEN, "방장만 할 수 있습니다")
    }

    private fun viewOf(
        stored: StoredRoom,
        selfId: String?,
    ): RoomView {
        val room = stored.room
        val full = room.expectedCount != null && stored.participants.size >= room.expectedCount
        return RoomView(
            id = room.id,
            mode = room.mode,
            favorParticipantId = room.favorParticipantId,
            locked = room.locked || full,
            meetingDate = room.meetingDate,
            expiresAt = room.expiresAt,
            dataVersion = room.dataVersion,
            participants =
                stored.participants.map {
                    ParticipantView(
                        id = it.id,
                        nickname = it.nickname,
                        hidden = it.hidden,
                        originCode = if (!it.hidden || it.id == selfId) it.originCode else null,
                        isHost = it.id == room.hostParticipantId,
                        isSelf = it.id == selfId,
                    )
                },
        )
    }

    private fun favorChange(
        stored: StoredRoom,
        patch: RoomPatch,
    ): Change<String> {
        val newMode = patch.mode ?: stored.room.mode
        if (patch.mode == null && patch.favorTarget == null) return Change.Unchanged
        if (newMode != RoomMode.FAVOR) return Change.Set(null)
        val target =
            when (val requested = patch.favorTarget) {
                null -> stored.room.favorParticipantId
                CreateRoomCommand.HOST_TARGET -> stored.room.hostParticipantId
                else -> requested
            } ?: reject(RoomError.FAVOR_TARGET_REQUIRED, "우대 대상이 필요합니다")
        if (stored.participants.none { it.id == target }) {
            reject(RoomError.FAVOR_TARGET_UNKNOWN, "우대 대상이 참여자에 없습니다")
        }
        return Change.Set(target)
    }

    private fun validateCreation(
        command: CreateRoomCommand,
        now: Instant,
    ) {
        if (command.expectedCount != null && command.expectedCount !in MIN_PEOPLE..MAX_PEOPLE) {
            reject(RoomError.INVALID_EXPECTED_COUNT, "예상 인원은 2~4명이어야 합니다")
        }
        command.meetingDate?.let { checkMeetingDate(it, now) }
        if (command.mode == RoomMode.FAVOR) {
            when (command.favorTarget) {
                null -> reject(RoomError.FAVOR_TARGET_REQUIRED, "우대 대상이 필요합니다")
                CreateRoomCommand.HOST_TARGET -> Unit
                else -> reject(RoomError.FAVOR_TARGET_UNKNOWN, "방을 만들 때 우대 대상은 host뿐입니다")
            }
        }
    }

    private fun checkMeetingDate(
        date: LocalDate,
        now: Instant,
    ) {
        if (!ExpiryPolicy.isValidMeetingDate(date, now)) reject(RoomError.INVALID_MEETING_DATE, "약속일이 지났습니다")
    }

    private fun validated(input: ParticipantInput): ParticipantInput {
        val nickname = input.nickname?.trim()?.takeIf { it.isNotEmpty() }
        if (nickname != null) {
            val valid =
                NicknameRules.isWellFormed(nickname) &&
                    NicknameRules.codePointCount(nickname) <= NicknameRules.MAX_CODE_POINTS &&
                    nickname.none { Character.isISOControl(it) }
            if (!valid) reject(RoomError.INVALID_NICKNAME, "별칭이 올바르지 않습니다")
        }
        if (!stations.isOrigin(input.originCode)) reject(RoomError.INVALID_STATION, "알 수 없는 출발역입니다")
        return input.copy(nickname = nickname)
    }

    private fun newParticipant(
        id: String,
        tokenHash: TokenHash,
        anonId: String?,
        input: ParticipantInput,
        now: Instant,
    ) = Participant(id, tokenHash, anonId, input.nickname, input.originCode, input.hidden, now, now)

    private fun activityOf(
        room: Room,
        meetingDate: LocalDate?,
        now: Instant,
    ) = Activity(now, ExpiryPolicy.expiresAt(room.createdAt, now, meetingDate))

    private suspend fun anonIdOf(
        deviceToken: String?,
        now: Instant,
    ): String? {
        if (deviceToken == null) return null
        val user = anonUsers.findByDeviceHash(tokens.hash(deviceToken)) ?: return null
        anonUsers.touch(user.id, now)
        return user.id
    }

    private companion object {
        const val MIN_PEOPLE = 2
        const val MAX_PEOPLE = 4
        val ANON_RETENTION: Duration = Duration.ofDays(90)
    }
}
