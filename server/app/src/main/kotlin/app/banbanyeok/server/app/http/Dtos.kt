package app.banbanyeok.server.app.http

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// contracts/openapi.yaml의 스키마와 이름·모양을 맞춘다. 요청 DTO는 문자열을 그대로 받고 검증은 서비스가 한다.

@Serializable
data class ErrorDto(
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
)

@Serializable
data class RoomDto(
    val roomId: String,
    val mode: String,
    val favorTarget: String?,
    val locked: Boolean,
    val meetingDate: String?,
    val expiresAt: String,
    val dataVersion: String,
    val participants: List<ParticipantDto>,
)

@Serializable
data class RecommendRequestDto(
    val origins: List<String>,
    val mode: String,
    val favorIndex: Int? = null,
)

@Serializable
data class OutcomeRequestDto(
    val outcome: String,
    val stationCode: String? = null,
)

@Serializable
data class ResultDto(
    val status: String,
    val mode: String,
    val dataVersion: String,
    val participants: List<ParticipantDto>,
    val baselineStationCode: String?,
    /** 카드. `favoredSeconds`는 정수 필드라 값이 없으면 키를 생략하므로 [candidateJson]으로 직접 만든다. */
    val candidates: List<JsonObject>,
)
