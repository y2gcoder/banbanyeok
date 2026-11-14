package app.banbanyeok.server.room

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
)

public data class RoomChange(
    val mode: RoomMode? = null,
    /** [Change.Set]이면 값(또는 null)으로 바꾼다. */
    val favorParticipantId: Change<String> = Change.Unchanged,
    val locked: Boolean? = null,
    val meetingDate: Change<java.time.LocalDate> = Change.Unchanged,
)

/**
 * 방 저장소 포트. 정원·잠금 판정은 동시 참여에서도 맞도록 [addParticipant] 안에서 원자적으로 한다.
 * 메모리 fake와 Exposed 구현이 같은 계약 테스트를 통과한다.
 */
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
    ): AddResult

    /** 바뀐 행이 있으면 true. */
    public suspend fun updateParticipant(
        roomId: String,
        participantId: String,
        change: ParticipantChange,
        activity: Activity,
    ): Boolean

    /** 우대 대상이었다면 우대 대상을 비운다. 지운 행이 있으면 true. */
    public suspend fun removeParticipant(
        roomId: String,
        participantId: String,
        activity: Activity,
    ): Boolean

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

    /**
     * 폐기된(deprecated) 코드를 레지스트리의 replacedBy 사슬을 따라 정식(active) 코드로 바꾼다. 정식 코드와 모르는 코드는 그대로다.
     * 방은 입력을 저장하기 전과 결과를 계산하기 전에 이 값을 쓴다(옛 링크·옛 방이 계속 열리게).
     */
    public fun canonical(code: String): String = code
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
