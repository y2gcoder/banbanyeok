@file:OptIn(ExperimentalSerializationApi::class)

package app.banbanyeok.server.app.http

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement

// contracts/openapi.yaml의 스키마와 이름·모양을 맞춘다. 요청 DTO는 문자열을 그대로 받고 검증은 서비스가 한다.

/**
 * 오류 응답(`application/problem+json`, RFC 9457). `code`는 확장 필드이고 분기는 이 값으로 한다. `message`는 옛 웹을 위한 호환 필드로
 * `detail`과 같은 값이다(다음 정리 때 뺀다).
 */
@Serializable
data class ProblemDto(
    val type: String,
    val title: String,
    val status: Int,
    val detail: String,
    val code: String,
    val message: String,
)

@Serializable
data class AnonCreatedDto(
    val anonUserId: String,
    val deviceToken: String,
)

@Serializable
data class ParticipantInputDto(
    val nickname: String? = null,
    val originCode: String,
    val hidden: Boolean = false,
)

@Serializable
data class RoomCreateRequestDto(
    val mode: String,
    val favorTarget: String? = null,
    val meetingDate: String? = null,
    /** 문자열이 아니면 INVALID_MEETING_TIME이 되도록 JSON 값 그대로 받는다. null은 없음. */
    val meetingTime: JsonElement? = null,
    /** 시각 없이 고른 약속 시간대. 문자열이 아니거나 모르는 값이면 INVALID_MEETING_BAND. null은 없음. */
    val meetingBand: JsonElement? = null,
    val host: ParticipantInputDto,
    val expectedCount: Int? = null,
)

@Serializable
data class RoomCreatedDto(
    val roomId: String,
    val hostToken: String,
    val participantId: String,
    val participantToken: String,
    val expiresAt: String,
    /** 통계용 방 해시(contracts/events.json `room_hash`). 방 ID를 되돌릴 수 없는 값이다. */
    val roomHash: String,
)

@Serializable
data class JoinedDto(
    val participantId: String,
    val participantToken: String,
)

@Serializable
data class ParticipantDto(
    val participantId: String,
    val nickname: String?,
    val hidden: Boolean,
    val originCode: String?,
    val originName: String?,
    val isHost: Boolean,
    val isSelf: Boolean,
    /** 표시 이름(contracts/data-format.md §8). 클라이언트는 그대로 쓴다. */
    val label: String,
    /** `name` / `origin` / `ordinal`. */
    val labelKind: String,
    /** 좁은 칸용 짧은 이름(출발역이면 "{출발역}", 그 밖에는 label과 같다). */
    val shortLabel: String,
)

@Serializable
data class RoomDto(
    val roomId: String,
    val mode: String,
    val favorTarget: String?,
    val locked: Boolean,
    val meetingDate: String?,
    val meetingTime: String?,
    /** 약속 시간대: 시각이 있으면 그 시각의 시간대, 없으면 고른 시간대, 둘 다 없으면 null. */
    val meetingBand: String?,
    val expiresAt: String,
    val dataVersion: String,
    val participants: List<ParticipantDto>,
    /** 방이 계산할 기준(약속 날짜·시각에서 서버가 정한 구분과 화면 문구). 참여자 화면의 "○○ 기준으로 계산해요"가 이 `label`을 쓴다. */
    val timeBasis: TimeBasisDto,
    /** 통계용 방 해시(contracts/events.json `room_hash`). 방 ID를 되돌릴 수 없는 값이다. */
    val roomHash: String,
    /** 방을 만든 시각(통계의 `seconds_since_room_created`). */
    val createdAt: String,
    /** 공유 번호(링크 `?sv=`, 정하기의 `seenVersion`). */
    val shareVersion: Long,
    val decision: DecisionDto?,
)

@Serializable
data class DecisionDto(
    val stationCode: String,
    val stationName: String,
    /** 정한 참가자의 participantId. */
    val decidedBy: String,
    val decidedAt: String,
)

/** `stationCode`가 null이면 푼다. 두 키 모두 있어야 한다(없으면 400 INVALID_REQUEST). */
@Serializable
data class DecisionRequestDto(
    val stationCode: String?,
    val seenVersion: Long,
)

@Serializable
data class RecommendRequestDto(
    val origins: List<String>,
    val mode: String,
    val favorIndex: Int? = null,
    val nicknames: List<String?>? = null,
    /** 언제 만나는가(`weekday-day` 형식). 없거나 null이면 기본 구분(평일 낮). 문자열이 아니면 INVALID_TIME_SLOT이 되도록 JSON 값 그대로 받는다. */
    val timeSlot: JsonElement? = null,
)

@Serializable
data class OutcomeRequestDto(
    val outcome: String,
    val stationCode: String? = null,
)

// 응답 모양을 타입으로 둔다. 값이 없을 때 키를 생략하는 필드는 `@EncodeDefault(NEVER)`와 기본값이다(전역 `explicitNulls`는 켜 두어, 그 밖의
// null 필드는 `null`로 나간다). 필드 선언 순서가 곧 응답의 키 순서다.

/** 사람 한 명이 어떤 역까지 걸리는 시간. */
@Serializable
data class ParticipantTimeDto(
    val participantId: String,
    val seconds: Int,
    val transfers: Int,
)

/** 순위 카드(openapi `Candidate`). `favoredSeconds`는 배려 모드에서만, `lastTrains`는 막차 표를 쓸 수 있을 때만 있다. */
@Serializable
data class CandidateDto(
    val rank: Int,
    val stationCode: String,
    val stationName: String,
    val times: List<ParticipantTimeDto>,
    val maxSeconds: Int,
    val spreadSeconds: Int,
    val totalSeconds: Int,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val favoredSeconds: Int? = null,
    val reasonCode: String,
    val reason: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val lastTrains: List<LastTrainDto>? = null,
)

/** "지도 한가운데" 비교(openapi `MapMiddle`). */
@Serializable
data class MapMiddleDto(
    val stationCode: String,
    val stationName: String,
    val times: List<ParticipantTimeDto>,
)

/**
 * 막차 한 건(openapi `LastTrain`). 값과 분류만 싣는다: `margin`의 10분 단위 내림과 문구는 클라이언트가 한다. 확인 필요(`check`)면 시각이 없다.
 * `transfer`는 여유 시각(`margin`)에만 있고, 행선지(`boundFor`)는 열차 한 대로 가는 길에만 있다. 사람 구분(`participantId`)은 순위 카드에만 있다.
 */
@Serializable
data class LastTrainDto(
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val participantId: String? = null,
    val kind: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val minute: Int? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val transfer: Boolean? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val boundFor: BoundForDto? = null,
)

/** 직행 열차의 행선지(종착역). */
@Serializable
data class BoundForDto(
    val stationCode: String,
    val stationName: String,
)

/** 귀갓길 막차의 기준(openapi `LastTrainBasis`). `unavailable`은 시각을 내지 않는 이유이고 `partial`은 참일 때만 있다. */
@Serializable
data class LastTrainBasisDto(
    val dayType: String,
    val asOf: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val unavailable: String? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val partial: Boolean = false,
)

/** 계산 기준. `label`은 화면 문구("토요일 저녁")이고 클라이언트는 그대로 쓴다. */
@Serializable
data class TimeBasisDto(
    val timeSlot: String,
    /** 요청한(방은 약속 날짜·시각에서 정한) 구분. [timeSlot]과 다르면 기본 구분으로 대신 계산했다. */
    val requestedTimeSlot: String,
    val dayType: String,
    val band: String,
    val label: String,
    val holidayName: String?,
)

@Serializable
data class ResultDto(
    val status: String,
    val mode: String,
    val dataVersion: String,
    val participants: List<ParticipantDto>,
    val baselineStationCode: String?,
    val candidates: List<CandidateDto>,
    val timeBasis: TimeBasisDto,
    /** "지도 한가운데" 비교(#68). 조건을 모두 만족할 때만 있고, 방 결과에는 아직 없다. 없으면 키를 생략한다. */
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val mapMiddle: MapMiddleDto? = null,
    /** 방 결과에만 있다(`/recommend`에는 키가 없다). */
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val shareVersion: Long? = null,
    /** 귀갓길 막차의 기준(#62). 막차 표를 쓸 수 없으면 키가 없고, 그때는 후보의 `lastTrains`도 없다. */
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val lastTrainBasis: LastTrainBasisDto? = null,
    /** 막차 표를 아직 읽는 중이라 막차가 빠졌을 때만 `true`. 아니면 키가 없다. */
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val lastTrainPending: Boolean? = null,
)

@Serializable
data class PreviewRoomDto(
    val roomId: String,
    val shareVersion: Long,
    val participantCount: Int,
    val canJoin: Boolean,
    val meetingDate: String?,
    val meetingTime: String?,
    val meetingBand: String?,
    val timeBasis: TimeBasisDto,
)

@Serializable
data class PreviewBasisDto(
    val mode: String,
    val favorLabel: String?,
)

@Serializable
data class PreviewTimeDto(
    val label: String,
    val seconds: Int?,
    /** 그 역에서 돌아가는 막차. 막차 표를 쓸 수 없거나 출발역을 숨긴 사람이면 키가 없다. */
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val lastTrain: LastTrainDto? = null,
)

@Serializable
data class PreviewStationDto(
    val stationCode: String,
    val stationName: String,
    val times: List<PreviewTimeDto>,
)

/** openapi `PreviewMapMiddle`: 방 미리보기의 "지도 한가운데" 비교. 이름표와 시간만(출발역·참여자 ID 없음). */
@Serializable
data class PreviewMapMiddleDto(
    val stationCode: String,
    val stationName: String,
    val times: List<PreviewMiddleTimeDto>,
)

@Serializable
data class PreviewMiddleTimeDto(
    val label: String,
    val seconds: Int,
)

/** contracts/openapi.yaml `RoomPreview`. 단계(`stage`)마다 있는 필드가 다르다. */
@Serializable
@JsonClassDiscriminator("stage")
sealed interface RoomPreviewDto {
    val room: PreviewRoomDto

    @Serializable
    @SerialName("collecting")
    data class Collecting(
        override val room: PreviewRoomDto,
    ) : RoomPreviewDto

    @Serializable
    @SerialName("result")
    data class Result(
        override val room: PreviewRoomDto,
        val dataVersion: String,
        val basis: PreviewBasisDto,
        val station: PreviewStationDto,
        @EncodeDefault(EncodeDefault.Mode.NEVER)
        val lastTrainBasis: LastTrainBasisDto? = null,
        /** "지도 한가운데" 비교. 보일 조건을 채우지 못하면 키가 없다. */
        @EncodeDefault(EncodeDefault.Mode.NEVER)
        val mapMiddle: PreviewMapMiddleDto? = null,
        /** 막차 표를 아직 읽는 중이라 막차가 빠졌을 때만 `true`. 아니면 키가 없다. */
        @EncodeDefault(EncodeDefault.Mode.NEVER)
        val lastTrainPending: Boolean? = null,
    ) : RoomPreviewDto

    @Serializable
    @SerialName("decided")
    data class Decided(
        override val room: PreviewRoomDto,
        val dataVersion: String,
        val basis: PreviewBasisDto,
        val station: PreviewStationDto,
        val decidedBy: String,
        val decidedAt: String,
        @EncodeDefault(EncodeDefault.Mode.NEVER)
        val lastTrainBasis: LastTrainBasisDto? = null,
        @EncodeDefault(EncodeDefault.Mode.NEVER)
        val lastTrainPending: Boolean? = null,
    ) : RoomPreviewDto
}
