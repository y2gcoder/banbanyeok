package app.banbanyeok.server.room

import java.time.Instant
import java.time.LocalDate

public enum class RoomMode { FAIR, FAST, FAVOR }

public enum class OutcomeKind { TOP1, TOP3, OTHER, NONE }

public class Outcome(
    public val kind: OutcomeKind,
    public val stationCode: String?,
)

/** 토큰은 평문으로 저장하지 않고 HMAC 해시만 가진다. 비교는 상수 시간이다. */
public class TokenHash(
    public val bytes: ByteArray,
) {
    override fun equals(other: Any?): Boolean =
        other is TokenHash && java.security.MessageDigest.isEqual(bytes, other.bytes)

    override fun hashCode(): Int = bytes.contentHashCode()

    override fun toString(): String = "TokenHash(***)"
}

public data class Room(
    val id: String,
    val hostHash: TokenHash,
    val hostParticipantId: String,
    val hostAnonId: String?,
    val mode: RoomMode,
    val favorParticipantId: String?,
    val dataVersion: String,
    val meetingDate: LocalDate?,
    val expectedCount: Int?,
    val locked: Boolean,
    val outcome: Outcome?,
    val createdAt: Instant,
    val lastActivityAt: Instant,
    val expiresAt: Instant,
)

public data class Participant(
    val id: String,
    val tokenHash: TokenHash,
    val anonId: String?,
    val nickname: String?,
    val originCode: String,
    val hidden: Boolean,
    val joinedAt: Instant,
    val updatedAt: Instant,
)

/** 방과 참여자(입장 순서). */
public data class StoredRoom(
    val room: Room,
    val participants: List<Participant>,
)

/** 값이 바뀌지 않았는지(Unchanged), 새 값(또는 null로 지우기)으로 바꿨는지(Set) 구별한다. */
public sealed interface Change<out T> {
    public data object Unchanged : Change<Nothing>

    public data class Set<T>(
        val value: T?,
    ) : Change<T>
}

// ---- 서비스 입력/출력 ----

public data class ParticipantInput(
    val nickname: String?,
    val originCode: String,
    val hidden: Boolean = false,
)

public data class CreateRoomCommand(
    val mode: RoomMode,
    /** 우대 대상. 방장은 [HOST_TARGET], 이후 참여자는 participantId. */
    val favorTarget: String?,
    val meetingDate: LocalDate?,
    val host: ParticipantInput,
    val expectedCount: Int?,
    val deviceToken: String?,
) {
    public companion object {
        public const val HOST_TARGET: String = "host"
    }
}

public data class CreatedRoom(
    val roomId: String,
    val hostToken: String,
    val participantId: String,
    val participantToken: String,
    val expiresAt: Instant,
)

public data class JoinedRoom(
    val participantId: String,
    val participantToken: String,
)

public data class RoomPatch(
    val mode: RoomMode? = null,
    val favorTarget: String? = null,
    val locked: Boolean? = null,
    val meetingDate: Change<LocalDate> = Change.Unchanged,
)

/**
 * 요청자가 볼 수 있는 참여자. 숨긴 참가자의 [originCode]는 요청자 본인이 아니면 null이다(시간·환승은 결과에서 그대로 보인다).
 */
public data class ParticipantView(
    val id: String,
    val nickname: String?,
    val hidden: Boolean,
    val originCode: String?,
    val isHost: Boolean,
    val isSelf: Boolean,
)

public data class RoomView(
    val id: String,
    val mode: RoomMode,
    val favorParticipantId: String?,
    val locked: Boolean,
    val meetingDate: LocalDate?,
    val expiresAt: Instant,
    val dataVersion: String,
    val participants: List<ParticipantView>,
)

/** 결과 계산에 필요한 방의 원본 정보(마스킹 전). room 모듈 밖으로 나가는 유일한 원본 출발역이다. */
public data class RoomResultContext(
    val view: RoomView,
    val computeParticipants: List<ComputeParticipant>,
)

public data class ComputeParticipant(
    val id: String,
    val nickname: String?,
    val originCode: String,
)

public data class CleanupReport(
    val rooms: Int,
    val anonUsers: Int,
)
