package app.banbanyeok.server.room

import app.banbanyeok.schema.TimeBand
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

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

/**
 * 방 공유 번호. 미리보기에 보이는 것이 바뀔 때마다 커지고 줄지 않는다(내용 해시가 아니다). 공유 링크 `?sv=`의 값이다.
 * DB 트리거(changeset 20261117-room-share-version)만 올린다. 앱은 읽기만 한다.
 */
@JvmInline
public value class ShareVersion(
    public val value: Long,
) : Comparable<ShareVersion> {
    init {
        require(value >= 0) { "ShareVersion은 0 이상이어야 합니다" }
    }

    override fun compareTo(other: ShareVersion): Int = value.compareTo(other.value)

    public companion object {
        public val ZERO: ShareVersion = ShareVersion(0)
    }
}

/** 방에서 정한 만날 역. 세 값은 함께 있거나 함께 없다(DB CHECK rooms_decision_complete). */
public data class Decision(
    val stationCode: String,
    /** 정한 참가자의 participantId. 그 사람이 나가면 DB가 정함을 푼다. */
    val decidedBy: String,
    val decidedAt: Instant,
)

public data class Room(
    val id: String,
    val hostHash: TokenHash,
    val hostParticipantId: String,
    val hostAnonId: String?,
    val mode: RoomMode,
    val favorParticipantId: String?,
    val dataVersion: String,
    val meetingDate: LocalDate?,
    /** 약속 시각(선택, 분 단위). 결과를 어느 시간대 기준으로 계산할지 정한다(contracts/time-slots.json). */
    val meetingTime: LocalTime? = null,
    /**
     * 약속 시간대(선택). 시각 없이 시간대만 고른 경우에만 저장한다(시각이 있으면 null, 시간대는 시각에서 나온다).
     * 화면에 없는 시각을 만들어 저장하지 않으려는 것이다.
     */
    val meetingBand: TimeBand? = null,
    val expectedCount: Int?,
    val locked: Boolean,
    val outcome: Outcome?,
    val createdAt: Instant,
    val lastActivityAt: Instant,
    val expiresAt: Instant,
    val shareVersion: ShareVersion = ShareVersion.ZERO,
    /** 정한 역 칸이 마지막으로 바뀐(입력이 바뀌어 풀린 것 포함) [shareVersion]. 정하기·풀기의 기준이다. */
    val decisionBasis: ShareVersion = ShareVersion.ZERO,
    val decision: Decision? = null,
    /** '누구 쪽으로' 뽑기(#172). 방을 만들 때 대상을 뽑기로 정한 방에만 있다. 당첨자는 [favorParticipantId]다. */
    val favorDraw: FavorDraw? = null,
) {
    val meeting: Meeting get() = Meeting(meetingDate, meetingTime, meetingBand)
}

/** 결과를 어느 구분으로 계산할지 정하는 약속 날짜·시각·시간대. */
public data class Meeting(
    val date: LocalDate?,
    val time: LocalTime?,
    val band: TimeBand?,
)

/**
 * 저장된 뽑기 상태. [round]가 0이면 아직 안 뽑았고 [candidates]·[roster]·[drawnAt]이 비어 있다(DB CHECK rooms_draw_complete).
 * 당첨자가 비면(나가거나 숨겼다) DB 트리거가 회차를 0으로 돌리고 [generation]을 1 올린다.
 */
public data class FavorDraw(
    /** 뽑기 세대. 뽑기 전으로 돌아갈 때마다 1씩 커지고 줄지 않는다. 회차(0~2)는 세대 안에서 센다. */
    val generation: Int,
    val round: Int,
    /** 뽑을 때 대상이던 참가자 ID(입장 순서). */
    val candidates: List<String>,
    /** 뽑을 때 방에 있던 모든 참가자 ID. 그 뒤에 들어온 사람(late)과 숨겨서 빠진 사람(hidden)을 이것으로 가른다. */
    val roster: List<String>,
    val drawnAt: Instant?,
) {
    /**
     * 나간(내보내진) 참가자를 명단에서 지운다. 대상 칸은 그 자리만 남기고 원래 ID 없는 자리 표시로 바꾸고(그림 좌표·결정성 유지),
     * 전체 명단에서는 뺀다. 참가자를 지우는 같은 트랜잭션에서 쓴다(처리방침 4항: 지울 때 바로 지운다).
     */
    public fun without(participantId: String): FavorDraw =
        copy(
            candidates = candidates.mapIndexed { index, id -> if (id == participantId) leftSlot(index) else id },
            roster = roster - participantId,
        )

    public companion object {
        public val PENDING: FavorDraw = FavorDraw(0, 0, emptyList(), emptyList(), null)

        /** 나간 사람의 대상 칸. 참가자 ID 형식(base32)과 겹치지 않고 원래 ID를 담지 않는다. */
        public fun leftSlot(index: Int): String = "~$index"
    }
}

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

/**
 * 새로 출발역을 숨기는 요청을 받는지(ADR-0007, #173). 이미 숨긴 채 방에 있는 참가자는 어느 쪽이든 방이 사라질 때까지 지금 규칙을 쓴다.
 * 숨김 코드를 걷어내는 2단계(#182)에서 함께 지운다.
 */
public enum class NewHiddenOrigins {
    /** 운영. 방 만들기·참여의 숨김과, 숨기지 않은 참가자가 고치기에서 숨기는 것을 [RoomError.HIDE_NOT_AVAILABLE]로 거절한다. */
    REJECTED,

    /** 테스트 픽스처 전용: ADR-0007 전에 숨긴 채 들어온 참가자가 있는 방(아직 남은 옛 방)을 재현한다. */
    LEGACY_FIXTURE,
}

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
    val meetingTime: LocalTime? = null,
    /** 약속 시간대(선택). [meetingTime]과 같이 오면 그 시각의 시간대와 같아야 한다(다르면 INVALID_MEETING_BAND). */
    val meetingBand: TimeBand? = null,
) {
    public companion object {
        public const val HOST_TARGET: String = "host"

        /** 방장이 나중에 뽑는다([RoomService.drawFavor]). 뽑기 전까지 방의 기본 결과는 공평하게다. */
        public const val DRAW_TARGET: String = "draw"
    }
}

public data class CreatedRoom(
    val roomId: String,
    val hostToken: String,
    val participantId: String,
    val participantToken: String,
    val expiresAt: Instant,
    /** 통계용 방 해시([TokenService.roomHash]). 방 ID를 되돌릴 수 없다. */
    val roomHash: String,
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
    val meetingTime: Change<LocalTime> = Change.Unchanged,
    val meetingBand: Change<TimeBand> = Change.Unchanged,
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
    /** 통계용 방 해시([TokenService.roomHash]). 방 ID를 되돌릴 수 없다. */
    val roomHash: String,
    /** 방을 만든 시각. 클라이언트가 통계의 `seconds_since_room_created`를 셀 때 쓴다. */
    val createdAt: Instant,
    val meetingTime: LocalTime? = null,
    /** 약속 시간대: 시각이 있으면 그 시각의 시간대, 없으면 고른 시간대, 둘 다 없으면 null. */
    val meetingBand: TimeBand? = null,
    val shareVersion: ShareVersion = ShareVersion.ZERO,
    /** 지금 데이터에서도 만날 역이고 정한 사람이 방에 있는 정함만 보인다. 역 코드는 정식 코드다. */
    val decision: Decision? = null,
    /** 뽑기 방이 아니면 null. */
    val favorDraw: FavorDrawView? = null,
)

/** 화면에 보이는 뽑기 상태. 참가자 ID·숨김 여부·입장 시각과 저장된 결과에서만 나온다(출발역과 상관없다). */
public data class FavorDrawView(
    val generation: Int,
    val round: Int,
    val maxRounds: Int,
    /**
     * 그림의 칸 순서(입장 순서). 뽑기 전에는 지금 뽑으면 들어갈 사람, 뽑은 뒤에는 뽑을 때의 대상 그대로(그 뒤에 나간 사람도 남는다:
     * 같은 세대·회차면 언제 봐도 같은 그림이어야 한다). 당첨자는 늘 방에 있다(나가면 뽑기 전으로 돌아간다).
     */
    val candidates: List<String>,
    val winner: String?,
    val drawnAt: Instant?,
    val excluded: List<DrawExclusion>,
)

public data class DrawExclusion(
    val participantId: String,
    val reason: DrawExclusionReason,
)

public enum class DrawExclusionReason {
    /** 뽑을 때(뽑기 전이면 지금) 출발역을 숨겼다. */
    HIDDEN,

    /** 뽑은 뒤에 들어왔다. */
    LATE,
}

/** 결과 계산에 필요한 방의 원본 정보(마스킹 전). room 모듈 밖으로 나가는 유일한 원본 출발역이다. */
public data class RoomResultContext(
    val view: RoomView,
    val computeParticipants: List<ComputeParticipant>,
)

public data class ComputeParticipant(
    val id: String,
    val nickname: String?,
    val originCode: String,
    /** 출발역을 숨겼다. 계산에는 [originCode]를 쓰지만 표시 이름·문장에는 출발역을 쓰지 않는다. */
    val hidden: Boolean,
)

public data class CleanupReport(
    val rooms: Int,
    val anonUsers: Int,
)
