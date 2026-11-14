package app.banbanyeok.server.recommendation

import app.banbanyeok.applogic.Comparison
import app.banbanyeok.applogic.FavorContext
import app.banbanyeok.applogic.PersonRef
import app.banbanyeok.applogic.PersonTime
import app.banbanyeok.applogic.ReasonCode
import app.banbanyeok.applogic.ReasonGenerator
import app.banbanyeok.applogic.ReasonInput
import app.banbanyeok.applogic.ReasonMode
import app.banbanyeok.core.RankInput
import app.banbanyeok.core.RankResult
import app.banbanyeok.core.rank
import app.banbanyeok.core.Candidate as CoreCandidate

public enum class RecommendMode { FAIR, FAST, FAVOR }

/** 계산에 들어가는 사람 한 명. [id]는 방에서는 participantId, 무상태 추천에서는 입력 순서의 인덱스 문자열이다. */
public class RecommendParticipant(
    public val id: String,
    public val nickname: String?,
    public val originCode: String,
)

public class RecommendRequest(
    public val participants: List<RecommendParticipant>,
    public val mode: RecommendMode,
    /** [RecommendMode.FAVOR]일 때 우대할 사람의 [RecommendParticipant.id]. */
    public val favorId: String? = null,
)

public data class ParticipantTime(
    public val participantId: String,
    public val seconds: Int,
    public val transfers: Int,
)

public data class RecommendedStation(
    public val rank: Int,
    public val stationCode: String,
    public val stationName: String,
    public val times: List<ParticipantTime>,
    public val maxSeconds: Int,
    public val spreadSeconds: Int,
    public val totalSeconds: Int,
    public val favoredSeconds: Int?,
    public val reasonCode: String,
    public val reason: String,
)

public data class Recommendation(
    /** `ok` 또는 `no_common_candidate`. */
    public val status: String,
    public val mode: RecommendMode,
    public val dataVersion: String,
    public val baselineStationCode: String?,
    public val candidates: List<RecommendedStation>,
)

public enum class RecommendationError {
    PEOPLE_COUNT,
    INVALID_NICKNAME,
    UNKNOWN_STATION,
    FAVOR_TARGET_REQUIRED,
    FAVOR_TARGET_UNKNOWN,
}

/** 요청이 규칙에 맞지 않는다. 호출하는 쪽(HTTP 계층)이 400/409 등으로 옮긴다. */
public class RecommendationException(
    public val error: RecommendationError,
    message: String,
) : RuntimeException(message)

/**
 * shared:core의 rank를 서버 요청에 맞게 감싼다: od 행렬에서 시간을 꺼내 순위를 내고, 상위 3개에 이유 문장(shared:app-logic)을 붙인다.
 * 시간은 정수 초 그대로 돌려준다. 표시 반올림은 클라이언트가 DisplayMinutes 규칙으로 한다.
 */
public class RecommendationService(
    private val travelTimes: TravelTimeProvider,
    private val stationNames: StationNames,
    private val toleranceSeconds: Int = 0,
) {
    public fun recommend(request: RecommendRequest): Recommendation {
        val people = request.participants
        validate(request)
        val matrix = travelTimes.measure(people.map { it.originCode })
        val ids = people.map { it.id }
        val favorIndex = if (request.mode == RecommendMode.FAVOR) ids.indexOf(request.favorId) else -1
        val result =
            rank(
                RankInput(
                    participants = ids,
                    candidates = matrix.candidates,
                    times = matrix.times,
                    transfers = matrix.transfers,
                    mode = if (favorIndex >= 0) "favor:${request.favorId}" else request.mode.name.lowercase(),
                    toleranceSeconds = toleranceSeconds,
                ),
            )
        val top = result.recommendations.take(MAX_CARDS)
        val refs = SentenceNames.of(people).mapIndexed { i, name -> PersonRef(people[i].id, name, originCode = null) }
        val favor = if (favorIndex >= 0) favorContext(result, matrix, favorIndex) else null
        return Recommendation(
            status = result.status,
            mode = request.mode,
            dataVersion = travelTimes.dataVersion,
            baselineStationCode = result.baselineStationCode,
            candidates =
                top.mapIndexed { index, card ->
                    val input = reasonInput(CardContext(request.mode, result, top, refs, favor), index)
                    RecommendedStation(
                        rank = card.rank,
                        stationCode = card.stationCode,
                        stationName = nameOf(card.stationCode),
                        times = card.times.map { ParticipantTime(it.participantId, it.seconds, it.transfers) },
                        maxSeconds = card.maxSeconds,
                        spreadSeconds = card.spreadSeconds,
                        totalSeconds = card.totalSeconds.toInt(),
                        favoredSeconds = card.favoredSeconds,
                        reasonCode = card.reasonCode,
                        reason = ReasonGenerator.generate(input),
                    )
                },
        )
    }

    private fun validate(request: RecommendRequest) {
        val people = request.participants
        if (people.size !in MIN_PEOPLE..MAX_PEOPLE) reject(RecommendationError.PEOPLE_COUNT, "참가자는 2~4명이어야 합니다")
        if (people.any { it.nickname != null && !SentenceNames.isValid(it.nickname) }) {
            reject(RecommendationError.INVALID_NICKNAME, "별칭이 올바르지 않습니다")
        }
        if (people.any { !travelTimes.isOrigin(it.originCode) }) {
            reject(RecommendationError.UNKNOWN_STATION, "알 수 없는 출발역이 있습니다")
        }
        if (request.mode == RecommendMode.FAVOR) {
            val target = request.favorId ?: reject(RecommendationError.FAVOR_TARGET_REQUIRED, "우대 대상이 필요합니다")
            if (people.none { it.id == target }) reject(RecommendationError.FAVOR_TARGET_UNKNOWN, "우대 대상이 참가자에 없습니다")
        }
    }

    private fun reject(
        error: RecommendationError,
        message: String,
    ): Nothing = throw RecommendationException(error, message)

    /** 카드 한 장의 문장을 만드는 데 쓰는 요청 전체의 맥락. */
    private data class CardContext(
        val mode: RecommendMode,
        val result: RankResult,
        val top: List<CoreCandidate>,
        val refs: List<PersonRef>,
        val favor: FavorContext?,
    )

    private fun reasonInput(
        context: CardContext,
        index: Int,
    ): ReasonInput {
        val result = context.result
        val top = context.top
        val card = top[index]
        val compared = if (index == 0) top.getOrNull(1) else top[0]
        return ReasonInput(
            mode = context.mode.reasonMode(),
            rank = card.rank,
            stationCode = card.stationCode,
            stationName = nameOf(card.stationCode),
            people = card.times.mapIndexed { i, t -> PersonTime(context.refs[i], t.seconds, t.transfers) },
            maxSeconds = card.maxSeconds,
            spreadSeconds = card.spreadSeconds,
            totalSeconds = card.totalSeconds.toInt(),
            reasonCode = ReasonCode.valueOf(card.reasonCode),
            toleranceSeconds = result.toleranceSeconds,
            comparison =
                compared?.let {
                    Comparison(it.rank, it.stationCode, nameOf(it.stationCode), it.times.map { t -> t.seconds })
                },
            favor = context.favor,
            isFairBaseline = card.stationCode == result.baselineStationCode,
        )
    }

    private fun favorContext(
        result: RankResult,
        matrix: TravelMatrix,
        favorIndex: Int,
    ): FavorContext? {
        val baselineColumn = matrix.candidates.indexOf(result.baselineStationCode)
        if (baselineColumn < 0) return null
        val caps = result.favorCaps.orEmpty()
        val topFavored = result.recommendations.firstOrNull()?.favoredSeconds
        val closerExcluded =
            topFavored != null &&
                result.excluded.any { excluded ->
                    val column = matrix.candidates.indexOf(excluded.stationCode)
                    excluded.reasonCode == "FAVOR_CAP_EXCEEDED" &&
                        (matrix.times[favorIndex][column] ?: Int.MAX_VALUE) < topFavored
                }
        return FavorContext(
            index = favorIndex,
            baselineTimesSeconds = matrix.times.map { requireNotNull(it[baselineColumn]) },
            capSeconds = result.participants.mapIndexed { i, id -> if (i == favorIndex) null else caps[id]?.toInt() },
            closerStationsExcluded = closerExcluded,
        )
    }

    private fun nameOf(code: String): String = stationNames.nameOf(code) ?: code

    private fun RecommendMode.reasonMode() =
        when (this) {
            RecommendMode.FAIR -> ReasonMode.FAIR
            RecommendMode.FAST -> ReasonMode.FAST
            RecommendMode.FAVOR -> ReasonMode.FAVOR
        }

    private companion object {
        const val MAX_CARDS = 3
        const val MIN_PEOPLE = 2
        const val MAX_PEOPLE = 4
    }
}
