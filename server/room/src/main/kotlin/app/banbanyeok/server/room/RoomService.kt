package app.banbanyeok.server.room

import app.banbanyeok.links.NicknameRules
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.TimeBand
import java.security.SecureRandom
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.random.RandomGenerator

/**
 * 방 유스케이스. Ktor를 모르는 일반 클래스이고 오류는 [RoomException]으로 알린다(HTTP 상태 변환은 app 몫).
 * 만료는 읽을 때 판정한다(만료된 방은 없는 방과 같다). 정리 명령([cleanup])이 실제로 지운다.
 * 방 하나의 모든 유스케이스가 같은 읽기·권한·화면 규칙(loadActive, requireHost, viewOf)을 지나도록 한 클래스에 둔다.
 */
@Suppress("TooManyFunctions", "LongParameterList")
public class RoomService(
    private val rooms: RoomRepository,
    private val anonUsers: AnonUserRepository,
    private val tokens: TokenService,
    private val ids: IdGenerator,
    private val stations: StationCatalog,
    private val clock: Clock,
    /** 뽑기의 운. 테스트는 고정 값을 넣는다. */
    drawRandom: RandomGenerator = SecureRandom(),
) {
    private val decisions = DecisionRule(stations)
    private val draws = FavorDrawRule(drawRandom, clock)

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
        val drawn = command.mode == RoomMode.FAVOR && command.favorTarget == CreateRoomCommand.DRAW_TARGET
        rooms.create(
            Room(
                id = roomId,
                hostHash = hostToken.hash,
                hostParticipantId = hostParticipantId,
                hostAnonId = anonId,
                mode = command.mode,
                favorParticipantId = if (command.mode == RoomMode.FAVOR && !drawn) hostParticipantId else null,
                dataVersion = stations.dataVersion,
                meetingDate = command.meetingDate,
                meetingTime = command.meetingTime?.withSecond(0)?.withNano(0),
                meetingBand = storedBand(command.meetingTime, command.meetingBand),
                expectedCount = command.expectedCount,
                locked = false,
                outcome = null,
                createdAt = now,
                lastActivityAt = now,
                expiresAt = expiresAt,
                favorDraw = if (drawn) FavorDraw.PENDING else null,
            ),
            newParticipant(hostParticipantId, participantToken.hash, anonId, host, now),
        )
        return CreatedRoom(
            roomId,
            hostToken.plain,
            hostParticipantId,
            participantToken.plain,
            expiresAt,
            tokens.roomHash(roomId),
        )
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

    /** 생성 응답의 두 자격이 여전히 유효하면 현재 만료 시각을 반환한다. */
    public suspend fun creationReplayExpiry(
        roomId: String,
        hostToken: String,
        participantId: String,
        participantToken: String,
    ): Instant? {
        val stored = findActive(roomId, clock.instant()) ?: return null
        if (stored.room.hostParticipantId != participantId || caller(stored, hostToken) != Caller.Host) return null
        return stored.room.expiresAt.takeIf { caller(stored, participantToken) == Caller.Member(participantId) }
    }

    /** 이미 들어온 참여자의 자리는 정원에 포함돼 있다. 잠금은 재시도에도 적용한다. */
    public suspend fun checkJoinReplay(
        roomId: String,
        participantId: String,
        participantToken: String,
    ) {
        val stored = loadActive(roomId, clock.instant())
        if (caller(stored, participantToken) != Caller.Member(participantId)) {
            reject(RoomError.PARTICIPANT_NOT_FOUND, "참여자를 찾을 수 없습니다")
        }
        if (stored.room.locked) reject(RoomError.ROOM_LOCKED, "방이 잠겼습니다")
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
            stored.participants.map {
                ComputeParticipant(
                    it.id,
                    it.nickname,
                    stations.canonical(it.originCode),
                    it.hidden,
                )
            },
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
        // 저장된 코드가 폐기된 코드여도 정식 코드가 같으면 그대로 쓴다. 출발역이 바뀐 것으로 보면 트리거가 정한 역을 풀기 때문이다.
        val storedOrigin = stored.participants.first { it.id == participantId }.originCode
        val origin = if (stations.canonical(storedOrigin) == value.originCode) storedOrigin else value.originCode
        val updated = stored.participants.first { it.id == participantId }.copy(hidden = value.hidden)
        val change =
            ParticipantChange(value.nickname, origin, value.hidden, now, releasesDrawWin = !draws.isCandidate(updated))
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
        val band = bandChange(stored.room, patch)
        val favor = favorChange(stored, patch)
        val change =
            RoomChange(
                mode = patch.mode,
                favorParticipantId = favor,
                endsDraw = stored.room.favorDraw != null && (favor as? Change.Set)?.value != null,
                locked = patch.locked,
                meetingDate = patch.meetingDate,
                meetingTime = minutes(patch.meetingTime),
                meetingBand = band,
                // 시각은 그대로 두고 시간대를 넣으면, 읽은 뒤 다른 요청이 시각을 넣었을 때 둘이 어긋난다. 저장 때 다시 확인한다.
                onlyWithoutMeetingTime =
                    patch.meetingTime == Change.Unchanged && (band as? Change.Set)?.value != null,
            )
        val expiresAt = ExpiryPolicy.expiresAt(stored.room.createdAt, now, meetingDate)
        if (!rooms.updateRoom(roomId, change, Activity(now, expiresAt))) {
            // 방이 남아 있는데 바뀌지 않았다면 저장 때 다시 확인한 두 조건(우대 대상, 시각 없는 시간대) 중 하나에 걸렸다.
            val current = rooms.find(roomId) ?: reject(RoomError.ROOM_NOT_FOUND, "방을 찾을 수 없습니다")
            val favor = (change.favorParticipantId as? Change.Set)?.value
            if (favor != null && current.participants.none { it.id == favor }) {
                reject(RoomError.FAVOR_TARGET_UNKNOWN, "우대 대상이 참여자에 없습니다")
            }
            reject(RoomError.INVALID_MEETING_BAND, "meetingBand가 meetingTime의 시간대와 다릅니다")
        }
        return viewOf(loadActive(roomId, now), null)
    }

    /**
     * 참여자 누구나 만날 역을 정하거나 바꾸거나([stationCode]) 푼다(null). [seen]은 화면이 본 공유 번호이고, 그 뒤에 입력이 바뀌었거나
     * 화면이 보지 못한 정함이 생겼으면 ROOM_CHANGED(409)다. 이미 그 상태면 아무것도 쓰지 않고 지금 방을 돌려준다(재시도 안전).
     */
    public suspend fun decide(
        roomId: String,
        token: String?,
        stationCode: String?,
        seen: ShareVersion,
    ): RoomView {
        val now = clock.instant()
        val stored = loadActive(roomId, now)
        val caller = requireCaller(stored, token)
        if (caller !is Caller.Member) reject(RoomError.FORBIDDEN, "참여자만 정할 수 있습니다")
        val decision = stationCode?.let { Decision(meetingStation(it), caller.participantId, now) }
        val activity = activityOf(stored.room, stored.room.meetingDate, now)
        when (
            rooms.writeDecision(
                stored.room.id,
                DecisionRequest(caller.participantId, decision, seen),
                activity,
                decisions,
            )
        ) {
            DecisionResult.Applied, DecisionResult.Unchanged -> Unit
            DecisionResult.Stale -> reject(RoomError.ROOM_CHANGED, "화면을 본 뒤 방이 바뀌었습니다")
            DecisionResult.TooFew -> reject(RoomError.NOT_ENOUGH_PARTICIPANTS, "참가자가 2명 이상이어야 합니다")
            DecisionResult.NotMember -> reject(RoomError.UNAUTHORIZED, "인증이 필요합니다")
            DecisionResult.RoomNotFound -> reject(RoomError.ROOM_NOT_FOUND, "방을 찾을 수 없습니다")
        }
        return viewOf(loadActive(roomId, now), caller.participantId)
    }

    /**
     * 방장이 '누구 쪽으로' 대상을 뽑는다([generation] = 화면이 본 세대, [round] = 화면이 본 회차 + 1). 같은 세대에서 방이 이미 그 회차
     * 이상이면 아무것도 쓰지 않고 지금 방을 돌려준다(재시도 안전). 뽑은 결과는 방에 저장되어 누가 열어도 같다.
     */
    public suspend fun drawFavor(
        roomId: String,
        hostToken: String?,
        generation: Int,
        round: Int,
    ): RoomView {
        val now = clock.instant()
        val stored = loadActive(roomId, now)
        requireHost(stored, hostToken)
        val activity = activityOf(stored.room, stored.room.meetingDate, now)
        when (rooms.writeDraw(stored.room.id, DrawRequest(generation, round), activity, draws)) {
            is DrawResult.Drawn, DrawResult.Unchanged -> Unit
            DrawResult.NotAvailable -> reject(RoomError.DRAW_NOT_AVAILABLE, "뽑기로 만든 방이 아닙니다")
            DrawResult.TooFew -> reject(RoomError.NOT_ENOUGH_DRAW_CANDIDATES, "출발역을 숨기지 않은 참가자가 2명 이상이어야 합니다")
            DrawResult.LimitReached -> reject(RoomError.DRAW_LIMIT_REACHED, "다시 뽑기는 한 번만 할 수 있습니다")
            DrawResult.Stale -> reject(RoomError.ROOM_CHANGED, "화면을 본 뒤 뽑기 상태가 바뀌었습니다")
            DrawResult.RoomNotFound -> reject(RoomError.ROOM_NOT_FOUND, "방을 찾을 수 없습니다")
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
    ): StoredRoom = findActive(roomId, now) ?: reject(RoomError.ROOM_NOT_FOUND, "방을 찾을 수 없습니다")

    private suspend fun findActive(
        roomId: String,
        now: Instant,
    ): StoredRoom? = rooms.find(roomId.lowercase())?.takeUnless { ExpiryPolicy.isExpired(it.room, now) }

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
            // 옛 서버가 나간 사람을 우대 대상으로 남긴 방이 있다. 우대 대상이 없는 것으로 보이고 결과는 첫 참가자를 우대한다.
            favorParticipantId = room.favorParticipantId?.takeIf { id -> stored.participants.any { it.id == id } },
            locked = room.locked || full,
            meetingDate = room.meetingDate,
            meetingTime = room.meetingTime,
            meetingBand = room.meetingTime?.let(::bandOf) ?: room.meetingBand,
            expiresAt = room.expiresAt,
            dataVersion = room.dataVersion,
            roomHash = tokens.roomHash(room.id),
            createdAt = room.createdAt,
            shareVersion = room.shareVersion,
            decision = decisions.visible(room.decision, stored.participants.map { it.id }),
            favorDraw = draws.view(room, stored.participants),
            participants =
                stored.participants.map {
                    ParticipantView(
                        id = it.id,
                        nickname = it.nickname,
                        hidden = it.hidden,
                        originCode = if (!it.hidden || it.id == selfId) stations.canonical(it.originCode) else null,
                        isHost = it.id == room.hostParticipantId,
                        isSelf = it.id == selfId,
                    )
                },
        )
    }

    private fun meetingStation(code: String): String {
        val canonical = stations.canonical(code)
        if (StationCode.parseOrNull(canonical) == null || !stations.isMeetingStation(canonical)) {
            reject(RoomError.INVALID_STATION, "만날 역 후보가 아닙니다")
        }
        return canonical
    }

    private fun favorChange(
        stored: StoredRoom,
        patch: RoomPatch,
    ): Change<String> {
        val newMode = patch.mode ?: stored.room.mode
        if (patch.mode == null && patch.favorTarget == null) return Change.Unchanged
        if (newMode != RoomMode.FAVOR) return Change.Set(null)
        // 뽑기 방에서 대상 없이 favor만 다시 보내면 그대로다. 대상을 직접 정하면 뽑기를 끝낸다(RoomChange.endsDraw).
        if (patch.favorTarget == null && stored.room.favorDraw != null) return Change.Unchanged
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
        checkMeetingBand(command.meetingTime, command.meetingBand)
        if (command.mode == RoomMode.FAVOR) {
            when (command.favorTarget) {
                null -> reject(RoomError.FAVOR_TARGET_REQUIRED, "우대 대상이 필요합니다")
                CreateRoomCommand.HOST_TARGET, CreateRoomCommand.DRAW_TARGET -> Unit
                else -> reject(RoomError.FAVOR_TARGET_UNKNOWN, "방을 만들 때 우대 대상은 host나 draw입니다")
            }
        }
    }

    /**
     * 수정 뒤 저장할 시간대. 시각·시간대 어느 쪽도 바꾸지 않으면 그대로다. 결과 시각이 있으면 null(시각에서 나온다)이고,
     * 시간대를 같이 보냈다면 그 시각의 시간대와 같아야 한다. 시각만 지우면 시간대도 없어진다(낮).
     */
    private fun bandChange(
        room: Room,
        patch: RoomPatch,
    ): Change<TimeBand> {
        if (patch.meetingTime == Change.Unchanged && patch.meetingBand == Change.Unchanged) return Change.Unchanged
        val time =
            when (val requested = patch.meetingTime) {
                Change.Unchanged -> room.meetingTime
                is Change.Set -> requested.value
            }
        val band =
            when (val requested = patch.meetingBand) {
                Change.Unchanged -> if (patch.meetingTime == Change.Unchanged) room.meetingBand else null
                is Change.Set -> requested.value
            }
        checkMeetingBand(time, band)
        return Change.Set(storedBand(time, band))
    }

    private fun storedBand(
        time: LocalTime?,
        band: TimeBand?,
    ): TimeBand? = if (time == null) band else null

    private fun checkMeetingBand(
        time: LocalTime?,
        band: TimeBand?,
    ) {
        if (time != null && band != null && bandOf(time) != band) {
            reject(RoomError.INVALID_MEETING_BAND, "meetingBand가 meetingTime의 시간대와 다릅니다")
        }
    }

    private fun bandOf(time: LocalTime): TimeBand = TimeBand.ofClock(time.hour, time.minute)

    /** 약속 시각은 분 단위로 저장한다(초는 버린다). */
    private fun minutes(change: Change<LocalTime>): Change<LocalTime> =
        when (change) {
            Change.Unchanged -> change
            is Change.Set -> Change.Set(change.value?.withSecond(0)?.withNano(0))
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
        val originCode = stations.canonical(input.originCode)
        if (!stations.isOrigin(originCode)) reject(RoomError.INVALID_STATION, "알 수 없는 출발역입니다")
        return input.copy(nickname = nickname, originCode = originCode)
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
    }
}
