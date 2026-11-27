package app.banbanyeok.server.app.application

import app.banbanyeok.server.recommendation.MapMiddle
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.RecommendParticipant
import app.banbanyeok.server.recommendation.RecommendRequest
import app.banbanyeok.server.recommendation.Recommendation
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.lasttrain.ParticipantLastTrain
import app.banbanyeok.server.recommendation.time.TimeSlotResolver
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
    val missingServices: List<String>? = null,
)

/**
 * 방의 결과를 계산한다: room 모듈에서 참여자를 읽고 recommendation 모듈에 계산을 맡긴다. 두 모듈은 서로 모르므로 여기서 잇는다.
 * 숨긴 참가자의 실제 출발역은 계산에만 쓰이고 응답의 참여자 목록에는 마스킹된 뷰가 나간다.
 * 추천이 요청을 거절하면 [app.banbanyeok.server.recommendation.RecommendationException]을 그대로 던진다: 방 경로의 오류 코드는
 * HTTP 계층(http/Errors.kt)의 방 표가 정한다.
 */
class RoomResultService(
    private val rooms: RoomService,
    private val recommendation: RecommendationService,
    /** 약속 날짜·시각 → 계산 구분(조립 지점이 한 번 만들어 넘긴다). */
    private val times: TimeSlotResolver,
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
        val evaluation = recommendation.evaluate(request)
        return RoomResult(
            evaluation.recommendation,
            context.view.participants,
            context.view.shareVersion,
            evaluation.missingServices,
        )
    }

    /**
     * 링크 미리보기 내용. 토큰 없이 방을 한 번 읽고(숨긴 출발역은 이미 가려져 있다) 방의 기본 기준으로 계산한다. 정한 역이 상위 후보에
     * 없으면 그 역까지의 시간·막차를 같은 평가(한 번 잰 행렬, 한 번 읽은 막차 표)에서 꺼낸다. 1위 단계의 "지도 한가운데" 비교도 같은 평가에서 꺼낸다. 출발역이 지금 데이터에 없으면
     * [app.banbanyeok.server.recommendation.RecommendationError.UNKNOWN_STATION]이다.
     */
    suspend fun preview(roomId: String): RoomPreview {
        val context = rooms.loadForResult(roomId, viewerToken = null)
        val view = context.view
        val room = previewRoom(context)
        if (context.computeParticipants.size < MIN_PEOPLE) return RoomPreview.Collecting(room)
        val request = requestOf(context, mode = null, favorId = null)
        val evaluation = recommendation.evaluate(request)
        val ranked = evaluation.recommendation
        // 방장이 대신 넣은 칸이 있는 방(#227)은 순번 이름만 싣고, 출발역에서 나오는 막차와 지도 한가운데 비교를 싣지 않는다.
        val withheld = room.enteredByHost
        val labels = previewLabels(request, ranked, withheld)
        val lastTrainBasis = ranked.lastTrainBasis.takeUnless { withheld }
        val lastTrainPending = ranked.lastTrainPending && !withheld
        val drawRound = view.favorDraw?.round?.takeIf { it > 0 && request.mode == RecommendMode.FAVOR }
        val basis = PreviewBasis(request.mode, request.favorId?.let(labels::getValue), drawRound)

        fun station(
            code: String,
            seconds: List<Int?>,
            lastTrains: List<ParticipantLastTrain>?,
        ): PreviewStation {
            val trains = lastTrains.takeUnless { withheld }.orEmpty().associateBy { it.participantId }
            return PreviewStation(
                code,
                request.participants.zip(seconds) { p, s -> PreviewTime(labels.getValue(p.id), s, trains[p.id]) },
            )
        }

        val decision = view.decision
        val top = ranked.candidates.firstOrNull()
        return when {
            decision != null -> {
                val ranking = ranked.candidates.firstOrNull { it.stationCode == decision.stationCode }
                val seconds =
                    ranking?.times?.map { it.seconds }
                        ?: evaluation.timesTo(decision.stationCode)?.map { it?.seconds }
                        ?: List(request.participants.size) { null }
                // 순위 밖의 역이면 그 역의 막차를 같은 평가에서 꺼낸다(같은 표, 같은 기준 = ranked.lastTrainBasis).
                val lastTrains = ranking?.lastTrains ?: evaluation.lastTrainsAt(decision.stationCode)
                RoomPreview.Decided(
                    room,
                    ranked.dataVersion,
                    basis,
                    station(decision.stationCode, seconds, lastTrains),
                    labels.getValue(decision.decidedBy),
                    decision.decidedAt,
                    lastTrainBasis,
                    lastTrainPending,
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
                    station(top.stationCode, top.times.map { it.seconds }, top.lastTrains),
                    lastTrainBasis,
                    previewMiddle(evaluation.mapMiddle.takeUnless { withheld }, labels),
                    lastTrainPending,
                )
            }
        }
    }

    /**
     * 참여자 ID → 미리보기 이름. [withheld]면 순번("참가자 N")이다: 이름이 없는 칸의 짧은 이름은 출발역 이름이라 방장이 대신 넣은 방의
     * 미리보기에는 싣지 않는다. 방 화면(토큰으로 읽는 방·결과)은 그대로다.
     */
    private fun previewLabels(
        request: RecommendRequest,
        ranked: Recommendation,
        withheld: Boolean,
    ): Map<String, String> {
        val shortLabels =
            if (withheld) request.participants.indices.map { "참가자 ${it + 1}" } else ranked.labels.map { it.short }
        return request.participants
            .map { it.id }
            .zip(shortLabels)
            .toMap()
    }

    private fun previewRoom(context: RoomResultContext): PreviewRoom {
        val view = context.view
        return PreviewRoom(
            roomId = view.id,
            shareVersion = view.shareVersion,
            participantCount = view.participants.size,
            canJoin = !view.locked && view.participants.size < MAX_PEOPLE,
            meetingDate = view.meetingDate,
            meetingTime = view.meetingTime,
            meetingBand = view.meetingBand,
            timeBasis = times.resolve(view.meetingDate, view.meetingTime, view.meetingBand),
            enteredByHost = view.participants.any { it.enteredByHost },
        )
    }

    /** 같은 평가의 "지도 한가운데" 비교(#68 2단계)를 이름표로. 숨긴 사람이 있거나 공평 기준이 아니면 평가가 null을 준다. */
    private fun previewMiddle(
        mapMiddle: MapMiddle?,
        labels: Map<String, String>,
    ): PreviewMapMiddle? =
        mapMiddle?.let { middle ->
            PreviewMapMiddle(
                middle.stationCode,
                middle.stationName,
                middle.times.map { PreviewMiddleTime(labels.getValue(it.participantId), it.seconds) },
            )
        }

    private fun requestOf(
        context: RoomResultContext,
        mode: RecommendMode?,
        favorId: String?,
    ): RecommendRequest {
        val view = context.view
        val time = times.resolve(view.meetingDate, view.meetingTime, view.meetingBand)
        // 토큰으로 확인한 본인. 숨긴 사람의 막차는 본인 요청에만 붙는다(미리보기는 토큰 없이 읽으므로 늘 null이다).
        val viewerId = view.participants.firstOrNull { it.isSelf }?.id
        val participants =
            context.computeParticipants.map {
                RecommendParticipant(it.id, it.nickname, it.originCode, it.hidden)
            }
        // 뽑기 방에서 아직 안 뽑았으면 방의 기본 기준은 공평하게다(#172). 첫 참가자 우대로 떨어지지 않게 한다.
        val drawPending = view.favorDraw?.let { it.winner == null } == true
        val requestedMode = mode ?: if (drawPending) RecommendMode.FAIR else view.mode.toRecommendMode()
        val target = favorTarget(requestedMode, favorId, view, roomDefault = mode == null)
        // 방의 기본 기준이 숨긴 사람 쪽인데 본인이 아니면(미리보기 포함) 공평하게로 계산한다(#162). 웹 결과 화면도 같은 규칙이다.
        // 요청에 모드가 있으면 바꾸지 않는다: 추천이 FAVOR_TARGET_HIDDEN으로 거절한다.
        val hiddenDefault =
            mode == null && target != null && participants.any { it.id == target && it.hidden && it.id != viewerId }
        return RecommendRequest(
            participants = participants,
            mode = if (hiddenDefault) RecommendMode.FAIR else requestedMode,
            favorId = if (hiddenDefault) null else target,
            time = time,
            dayCertainty = times.certainty(view.meetingDate, view.meetingTime),
            viewerId = viewerId,
        )
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
