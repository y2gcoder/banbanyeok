package app.banbanyeok.server.app.application

import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.recommendation.HolidayCalendar
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.RecommendParticipant
import app.banbanyeok.server.recommendation.RecommendRequest
import app.banbanyeok.server.recommendation.Recommendation
import app.banbanyeok.server.recommendation.RecommendationError
import app.banbanyeok.server.recommendation.RecommendationException
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.TimeSlotResolver
import app.banbanyeok.server.room.ErrorKind
import app.banbanyeok.server.room.ParticipantView
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomResultContext
import app.banbanyeok.server.room.RoomService
import app.banbanyeok.server.room.RoomView
import app.banbanyeok.server.room.ShareVersion

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
    /** 이 결과를 계산한 방 읽기의 공유 번호. 결과 카드에서 정할 때 보내는 `seenVersion`이다. */
    val shareVersion: ShareVersion,
)

/**
 * 방의 결과를 계산한다: room 모듈에서 참여자를 읽고 recommendation 모듈에 계산을 맡긴다. 두 모듈은 서로 모르므로 여기서 잇는다.
 * 숨긴 참가자의 실제 출발역은 계산에만 쓰이고 응답의 참여자 목록에는 마스킹된 뷰가 나간다.
 */
class RoomResultService(
    private val rooms: RoomService,
    private val recommendation: RecommendationService,
    /** 약속 날짜·시각 → 계산 구분. 없으면 평일 낮. */
    private val times: TimeSlotResolver = TimeSlotResolver(HolidayCalendar.bundled()),
    /** 구분 행렬 검사가 뒤에서 도는 중이면 잠깐 기다린다(StationDirectory.awaitSlots). */
    private val awaitSlots: suspend (TimeSlot) -> Unit = {},
) {
    suspend fun result(
        roomId: String,
        viewerToken: String?,
        mode: RecommendMode?,
        favorId: String?,
    ): RoomResult {
        val context = rooms.loadForResult(roomId, viewerToken)
        if (context.computeParticipants.size < MIN_PEOPLE) {
            throw AppException(ErrorKind.CONFLICT, "NOT_ENOUGH_PARTICIPANTS", "참가자가 2명 이상이어야 합니다")
        }
        val request = requestOf(context, mode, favorId)
        return RoomResult(
            mapped { recommendation.recommend(request) },
            context.view.participants,
            context.view.shareVersion,
        )
    }

    /**
     * 링크 미리보기 내용. 토큰 없이 방을 한 번 읽고(숨긴 출발역은 이미 가려져 있다) 방의 기본 기준으로 계산한다. 정한 역이 상위 후보에
     * 없으면 그 역까지의 시간을 따로 잰다. 출발역이 지금 데이터에 없으면 STATION_UNAVAILABLE(409)이다.
     */
    suspend fun preview(roomId: String): RoomPreview {
        val context = rooms.loadForResult(roomId, viewerToken = null)
        val view = context.view
        val room =
            PreviewRoom(
                roomId = view.id,
                shareVersion = view.shareVersion,
                participantCount = view.participants.size,
                canJoin = !view.locked && view.participants.size < MAX_PEOPLE,
                meetingDate = view.meetingDate,
                meetingTime = view.meetingTime,
                meetingBand = view.meetingBand,
                timeBasis = times.resolve(view.meetingDate, view.meetingTime, view.meetingBand),
            )
        if (context.computeParticipants.size < MIN_PEOPLE) return RoomPreview.Collecting(room)
        val request = requestOf(context, mode = null, favorId = null)
        val ranked = mapped { recommendation.recommend(request) }
        val labels =
            request.participants
                .map { it.id }
                .zip(ranked.labels.map { it.short })
                .toMap()
        val basis = PreviewBasis(request.mode, request.favorId?.let(labels::getValue))

        fun station(
            code: String,
            seconds: List<Int?>,
        ) = PreviewStation(code, request.participants.zip(seconds) { p, s -> PreviewTime(labels.getValue(p.id), s) })

        val decision = view.decision
        val top = ranked.candidates.firstOrNull()
        return when {
            decision != null -> {
                val seconds =
                    ranked.candidates
                        .firstOrNull { it.stationCode == decision.stationCode }
                        ?.times
                        ?.map { it.seconds }
                        ?: mapped { recommendation.timesTo(request, decision.stationCode) }?.map { it?.seconds }
                        ?: List(request.participants.size) { null }
                RoomPreview.Decided(
                    room,
                    ranked.dataVersion,
                    basis,
                    station(decision.stationCode, seconds),
                    labels.getValue(decision.decidedBy),
                    decision.decidedAt,
                )
            }

            top == null -> {
                RoomPreview.Collecting(room)
            }

            else -> {
                RoomPreview.Result(
                    room,
                    ranked.dataVersion,
                    basis,
                    station(top.stationCode, top.times.map { it.seconds }),
                )
            }
        }
    }

    private suspend fun requestOf(
        context: RoomResultContext,
        mode: RecommendMode?,
        favorId: String?,
    ): RecommendRequest {
        val view = context.view
        val resolvedMode = mode ?: view.mode.toRecommendMode()
        val time = times.resolve(view.meetingDate, view.meetingTime, view.meetingBand)
        awaitSlots(time.slot)
        return RecommendRequest(
            participants =
                context.computeParticipants.map {
                    RecommendParticipant(it.id, it.nickname, it.originCode, it.hidden)
                },
            mode = resolvedMode,
            favorId = favorTarget(resolvedMode, favorId, view, roomDefault = mode == null),
            time = time,
        )
    }

    private fun <T> mapped(block: () -> T): T =
        try {
            block()
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

    /**
     * 우대 대상. 방의 기본 기준(요청에 모드가 없음)인데 저장된 대상이 없으면(우대 대상이 나갔다) 첫 참가자를 우대한다.
     * 웹 결과 화면이 이미 같은 규칙으로 보여 주므로 미리보기와 결과가 어긋나지 않는다.
     */
    private fun favorTarget(
        mode: RecommendMode,
        requested: String?,
        view: RoomView,
        roomDefault: Boolean,
    ): String? {
        if (mode != RecommendMode.FAVOR) return null
        if (requested == HOST) return view.participants.firstOrNull { it.isHost }?.id
        val fallback = if (roomDefault) view.participants.firstOrNull()?.id else null
        return requested ?: view.favorParticipantId ?: fallback
    }

    private fun RoomMode.toRecommendMode() =
        when (this) {
            RoomMode.FAIR -> RecommendMode.FAIR
            RoomMode.FAST -> RecommendMode.FAST
            RoomMode.FAVOR -> RecommendMode.FAVOR
        }

    private companion object {
        const val MIN_PEOPLE = 2
        const val MAX_PEOPLE = 4
        const val HOST = "host"
    }
}
