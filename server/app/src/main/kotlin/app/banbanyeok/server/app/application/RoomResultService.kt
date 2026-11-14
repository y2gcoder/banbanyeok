package app.banbanyeok.server.app.application

import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.RecommendParticipant
import app.banbanyeok.server.recommendation.RecommendRequest
import app.banbanyeok.server.recommendation.Recommendation
import app.banbanyeok.server.recommendation.RecommendationError
import app.banbanyeok.server.recommendation.RecommendationException
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.room.ErrorKind
import app.banbanyeok.server.room.ParticipantView
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomService

/** HTTP를 모르는 오류. HTTP 계층이 [kind]로 상태 코드를, [code]로 오류 코드를 정한다. */
class AppException(
    val kind: ErrorKind,
    val code: String,
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

class RoomResult(
    val recommendation: Recommendation,
    /** 요청자에게 보이는 참여자(숨긴 참가자의 출발역은 가려져 있다). */
    val participants: List<ParticipantView>,
)

/**
 * 방의 결과를 계산한다: room 모듈에서 참여자를 읽고 recommendation 모듈에 계산을 맡긴다. 두 모듈은 서로 모르므로 여기서 잇는다.
 * 숨긴 참가자의 실제 출발역은 계산에만 쓰이고 응답의 참여자 목록에는 마스킹된 뷰가 나간다.
 */
class RoomResultService(
    private val rooms: RoomService,
    private val recommendation: RecommendationService,
) {
    suspend fun result(
        roomId: String,
        viewerToken: String?,
        mode: RecommendMode?,
        favorId: String?,
    ): RoomResult {
        val context = rooms.loadForResult(roomId, viewerToken)
        val view = context.view
        if (context.computeParticipants.size < MIN_PEOPLE) {
            throw AppException(ErrorKind.CONFLICT, "NOT_ENOUGH_PARTICIPANTS", "참가자가 2명 이상이어야 합니다")
        }
        val resolvedMode = mode ?: view.mode.toRecommendMode()
        val favor = favorTarget(resolvedMode, favorId, view.favorParticipantId, view.participants)
        val request =
            RecommendRequest(
                participants =
                    context.computeParticipants.map {
                        RecommendParticipant(
                            it.id,
                            it.nickname,
                            it.originCode,
                        )
                    },
                mode = resolvedMode,
                favorId = favor,
            )
        return RoomResult(compute(request), view.participants)
    }

    private fun compute(request: RecommendRequest): Recommendation =
        try {
            recommendation.recommend(request)
        } catch (e: RecommendationException) {
            throw when (e.error) {
                RecommendationError.UNKNOWN_STATION -> {
                    AppException(ErrorKind.CONFLICT, "STATION_UNAVAILABLE", "참가자의 출발역이 현재 데이터에 없습니다", e)
                }

                RecommendationError.PEOPLE_COUNT -> {
                    AppException(ErrorKind.CONFLICT, "NOT_ENOUGH_PARTICIPANTS", "참가자가 2명 이상이어야 합니다", e)
                }

                RecommendationError.INVALID_NICKNAME -> {
                    AppException(ErrorKind.INVALID, "INVALID_NICKNAME", "별칭이 올바르지 않습니다", e)
                }

                RecommendationError.FAVOR_TARGET_REQUIRED -> {
                    AppException(ErrorKind.INVALID, "FAVOR_TARGET_REQUIRED", "우대 대상이 필요합니다", e)
                }

                RecommendationError.FAVOR_TARGET_UNKNOWN -> {
                    AppException(ErrorKind.INVALID, "FAVOR_TARGET_UNKNOWN", "우대 대상이 참가자에 없습니다", e)
                }
            }
        }

    private fun favorTarget(
        mode: RecommendMode,
        requested: String?,
        stored: String?,
        participants: List<ParticipantView>,
    ): String? {
        if (mode != RecommendMode.FAVOR) return null
        if (requested == HOST) return participants.firstOrNull { it.isHost }?.id
        return requested ?: stored
    }

    private fun RoomMode.toRecommendMode() =
        when (this) {
            RoomMode.FAIR -> RecommendMode.FAIR
            RoomMode.FAST -> RecommendMode.FAST
            RoomMode.FAVOR -> RecommendMode.FAVOR
        }

    private companion object {
        const val MIN_PEOPLE = 2
        const val HOST = "host"
    }
}
