package app.banbanyeok.server.room

import app.banbanyeok.schema.StationRegion
import java.time.Instant

/** 활동 기록. 쓰기가 일어날 때 마지막 활동 시각과 새 만료 시각을 같은 트랜잭션에서 갱신한다. */
public data class Activity(
    val at: Instant,
    val expiresAt: Instant,
)

public sealed interface AddResult {
    public data object Added : AddResult

    public data object RoomNotFound : AddResult

    /** 정원(최대 4명, expectedCount가 더 작으면 그 값)에 찼다. */
    public data object Full : AddResult

    public data object Locked : AddResult
}

public data class ParticipantChange(
    val nickname: String?,
    val originCode: String,
    val hidden: Boolean,
    val updatedAt: Instant,
    /**
     * 바뀐 뒤 이 사람이 뽑기 대상이 될 수 없다([FavorDrawRule.isCandidate]). 뽑기 방에서 이 사람이 당첨자면 같은 트랜잭션에서
     * 당첨자를 비운다(트리거가 뽑기 전으로 돌린다). 저장 때 다시 보므로 읽은 뒤 다시 뽑아 당첨자가 바뀌었어도 맞다.
     */
    val releasesDrawWin: Boolean = false,
    /**
     * 저장할 때 이미 숨긴 참가자일 때만 바꾼다(ADR-0007: 새로 숨기지 않는다). 읽은 뒤 다른 요청이 숨김을 풀었다면 바꾸지 않고 false다.
     * 숨김을 유지하는([hidden] = true) 변경에 쓴다.
     */
    val onlyIfHidden: Boolean = false,
)

public data class RoomChange(
    val mode: RoomMode? = null,
    /** [Change.Set]이면 값(또는 null)으로 바꾼다. */
    val favorParticipantId: Change<String> = Change.Unchanged,
    val locked: Boolean? = null,
    val meetingDate: Change<java.time.LocalDate> = Change.Unchanged,
    val meetingTime: Change<java.time.LocalTime> = Change.Unchanged,
    /** 저장할 시간대. 시각이 있는 방은 null(시각에서 나온다). */
    val meetingBand: Change<app.banbanyeok.schema.TimeBand> = Change.Unchanged,
    /**
     * true면 약속 시각이 비어 있을 때만 바꾼다(아니면 아무 행도 바꾸지 않고 false). 시각을 건드리지 않고 시간대만 넣는 수정이,
     * 읽은 뒤 다른 요청이 넣은 시각과 어긋난 채 저장되지 않게 한다.
     */
    val onlyWithoutMeetingTime: Boolean = false,
    /** 방장이 대상을 직접 정했다: 뽑기 방이면 뽑기를 끝낸다(지금 당첨자를 그대로 정해도). */
    val endsDraw: Boolean = false,
)

/**
 * 방 저장소 포트. 정원·잠금 판정은 동시 참여에서도 맞도록 [addParticipant] 안에서 원자적으로 한다.
 * 메모리 fake와 Exposed 구현이 같은 계약 테스트를 통과한다. 쓰기마다 한 트랜잭션이라 방 하나의 쓰기를 한 포트에 둔다.
 */
@Suppress("TooManyFunctions")
public interface RoomRepository {
    public suspend fun create(
        room: Room,
        host: Participant,
    )

    public suspend fun find(roomId: String): StoredRoom?

    public suspend fun addParticipant(
        roomId: String,
        participant: Participant,
        activity: Activity,
        regions: RoomRegionRule? = null,
    ): AddResult

    /** 바뀐 행이 있으면 true. */
    public suspend fun updateParticipant(
        roomId: String,
        participantId: String,
        change: ParticipantChange,
        activity: Activity,
        regions: RoomRegionRule? = null,
    ): Boolean

    /** 우대 대상이었다면 우대 대상을 비운다. 지운 행이 있으면 true. */
    public suspend fun removeParticipant(
        roomId: String,
        participantId: String,
        activity: Activity,
    ): Boolean

    /** 우대 대상을 참여자로 바꾸는데 그 사람이 방에 없으면(읽은 뒤 나갔다) 아무것도 바꾸지 않는다. 바뀐 행이 있으면 true. */
    public suspend fun updateRoom(
        roomId: String,
        change: RoomChange,
        activity: Activity,
    ): Boolean

    public suspend fun recordOutcome(
        roomId: String,
        outcome: Outcome,
        activity: Activity,
    ): Boolean

    /**
     * 방 행을 잠그고(참여와 같은 FOR UPDATE) [rule]로 판정해 [DecisionResult.Applied]일 때만 정한 역 칸과 활동 시각을 쓴다.
     * 요청의 정함이 null이면 푼다. 공유 번호는 쓰지 않는다(트리거가 올린다).
     */
    public suspend fun writeDecision(
        roomId: String,
        request: DecisionRequest,
        activity: Activity,
        rule: DecisionRule,
    ): DecisionResult

    /**
     * 방 행을 잠그고(정하기와 같은 FOR UPDATE) [rule]로 판정해 [DrawResult.Drawn]일 때만 당첨자·뽑기 칸·활동 시각을 쓴다.
     * 운은 [rule]이 잠근 뒤의 대상으로 뽑는다.
     */
    public suspend fun writeDraw(
        roomId: String,
        request: DrawRequest,
        activity: Activity,
        rule: FavorDrawRule,
    ): DrawResult

    public suspend fun delete(roomId: String): Boolean

    /** 만료 시각이 [now] 이하인 방(과 참여자)을 지우고 지운 방 수를 돌려준다. */
    public suspend fun deleteExpired(now: Instant): Int
}

public data class AnonUser(
    val id: String,
    val deviceHash: TokenHash,
    val createdAt: Instant,
    val lastSeenAt: Instant,
)

public interface AnonUserRepository {
    public suspend fun create(user: AnonUser)

    public suspend fun findByDeviceHash(hash: TokenHash): AnonUser?

    public suspend fun touch(
        id: String,
        at: Instant,
    )

    /** [lastSeenBefore] 이전에 마지막으로 쓰였고 어떤 방·참여자도 참조하지 않는 익명 사용자를 지운다. */
    public suspend fun deleteInactive(lastSeenBefore: Instant): Int
}

/** 방이 쓸 수 있는 역 정보. 구현은 app이 현재 산출물에서 만든다. */
public interface StationCatalog {
    public val dataVersion: String

    public fun isOrigin(code: String): Boolean

    public fun regionOf(code: String): StationRegion? = StationRegion.CAPITAL

    /**
     * 폐기된(deprecated) 코드를 레지스트리의 replacedBy 사슬을 따라 정식(active) 코드로 바꾼다. 정식 코드와 모르는 코드는 그대로다.
     * 방은 입력을 저장하기 전과 결과를 계산하기 전에 이 값을 쓴다(옛 링크·옛 방이 계속 열리게).
     */
    public fun canonical(code: String): String = code

    /** 만날 역(od 후보 축)으로 쓸 수 있는 코드. 출발역 축과 다르다. [canonical]을 거친 코드로 묻는다. */
    public fun isMeetingStation(code: String): Boolean
}

/** ID와 토큰 생성. 테스트는 결정적인 구현을 쓴다. */
public interface IdGenerator {
    /** 10자 Crockford base32. */
    public fun roomId(): String

    /** 6자 base32. */
    public fun participantId(): String

    public fun anonUserId(): String

    /** 256비트 무작위, URL 안전 문자열. */
    public fun token(): String
}
