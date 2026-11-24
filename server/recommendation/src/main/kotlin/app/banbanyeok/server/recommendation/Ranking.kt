package app.banbanyeok.server.recommendation

import app.banbanyeok.applogic.Comparison
import app.banbanyeok.applogic.FavorContext
import app.banbanyeok.applogic.ParticipantLabels
import app.banbanyeok.applogic.PersonRef
import app.banbanyeok.applogic.PersonTime
import app.banbanyeok.applogic.ReasonCode
import app.banbanyeok.applogic.ReasonGenerator
import app.banbanyeok.applogic.ReasonInput
import app.banbanyeok.applogic.ReasonMode
import app.banbanyeok.core.RankInput
import app.banbanyeok.core.RankResult
import app.banbanyeok.core.rank
import app.banbanyeok.server.recommendation.lasttrain.LastTrainAttacher
import app.banbanyeok.server.recommendation.time.TimeBasis
import app.banbanyeok.core.Candidate as CoreCandidate

/**
 * shared:core의 rank를 서버 요청에 맞게 감싼다: 잰 행렬에서 순위를 내고, 상위 3개에 이유 문장(shared:app-logic)을 붙인다.
 * 시간은 정수 초 그대로 돌려준다. 표시 반올림은 클라이언트가 DisplayMinutes 규칙으로 한다.
 */
internal class Ranking(
    private val stationNames: StationNames,
    private val toleranceSeconds: Int,
) {
    /** [matrix]는 [request]에 대해 한 번 잰 행렬이고 [timeBasis]는 그 행렬의 실제 구분이다. 막차는 순위를 다 정한 뒤에 붙인다. */
    fun rank(
        request: RecommendRequest,
        matrix: TravelMatrix,
        timeBasis: TimeBasis,
        lastTrains: LastTrainAttacher.Attached?,
        dataVersion: String,
    ): Recommendation {
        val people = request.participants
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
        val hidden = HiddenTimes.of(request)
        // 순위는 정확한 값으로 정했다. 여기부터는 보이는 값(숨긴 다른 사람의 칸은 뭉뚱그림, #142)으로 카드·집계·문장을 만든다.
        val top = result.recommendations.take(MAX_CARDS).map { shown(it, hidden, favorIndex) }
        val refs = personRefs(people)
        val favor = if (favorIndex >= 0) favorContext(result, matrix, favorIndex, hidden) else null
        return Recommendation(
            status = result.status,
            mode = request.mode,
            dataVersion = dataVersion,
            baselineStationCode = result.baselineStationCode,
            labels = ParticipantLabels.of(refs),
            requestedSlot = request.time.slot,
            timeBasis = timeBasis,
            lastTrainBasis = lastTrains?.basis,
            candidates =
                top.mapIndexed { index, card ->
                    val input = reasonInput(CardContext(request.mode, result, top, refs, favor, hidden.any), index)
                    RecommendedStation(
                        rank = card.rank,
                        stationCode = card.stationCode,
                        stationName = nameOf(card.stationCode),
                        times = card.times,
                        maxSeconds = card.maxSeconds,
                        spreadSeconds = card.spreadSeconds,
                        totalSeconds = card.totalSeconds,
                        favoredSeconds = card.favoredSeconds,
                        reasonCode = card.reasonCode,
                        reason = ReasonGenerator.generate(input),
                        lastTrains = lastTrains?.at(card.stationCode),
                    )
                },
        )
    }

    fun nameOf(code: String): String = stationNames.nameOf(code) ?: code

    /** 표시 이름과 문장의 입력. 숨긴 사람은 출발역 코드·이름을 넘기지 않는다(data-format §8). */
    private fun personRefs(people: List<RecommendParticipant>): List<PersonRef> =
        people.map {
            PersonRef(
                id = it.id,
                name = it.nickname?.trim()?.takeIf(String::isNotEmpty),
                originCode = if (it.hidden) null else it.originCode,
                originName = if (it.hidden) null else stationNames.nameOf(it.originCode),
            )
        }

    /** 보는 사람에게 보이는 카드 한 장: 시간과 그 시간에서 다시 계산한 최장·차이·합계·우대 시간. 순위·이유 코드는 코어 그대로다. */
    private data class ShownCard(
        val rank: Int,
        val stationCode: String,
        val times: List<ParticipantTime>,
        val maxSeconds: Int,
        val spreadSeconds: Int,
        val totalSeconds: Int,
        val favoredSeconds: Int?,
        val reasonCode: String,
    )

    private fun shown(
        card: CoreCandidate,
        hidden: HiddenTimes,
        favorIndex: Int,
    ): ShownCard {
        val times = card.times.mapIndexed { i, t -> hidden.time(i, t.participantId, t.seconds, t.transfers) }
        val seconds = times.map { it.seconds }
        return ShownCard(
            rank = card.rank,
            stationCode = card.stationCode,
            times = times,
            maxSeconds = seconds.max(),
            spreadSeconds = seconds.max() - seconds.min(),
            totalSeconds = seconds.sum(),
            favoredSeconds = card.favoredSeconds?.let { seconds[favorIndex] },
            reasonCode = card.reasonCode,
        )
    }

    /** 카드 한 장의 문장을 만드는 데 쓰는 요청 전체의 맥락. [approximate]: 뭉뚱그린 칸이 있다. */
    private data class CardContext(
        val mode: RecommendMode,
        val result: RankResult,
        val top: List<ShownCard>,
        val refs: List<PersonRef>,
        val favor: FavorContext?,
        val approximate: Boolean,
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
            totalSeconds = card.totalSeconds,
            reasonCode = ReasonCode.valueOf(card.reasonCode),
            toleranceSeconds = result.toleranceSeconds,
            comparison =
                compared?.let {
                    Comparison(it.rank, it.stationCode, nameOf(it.stationCode), it.times.map { t -> t.seconds })
                },
            favor = context.favor,
            isFairBaseline = card.stationCode == result.baselineStationCode,
            approximate = context.approximate,
        )
    }

    /**
     * 배려 문장의 맥락. 기준역 시간은 보이는 값(숨긴 다른 사람은 뭉뚱그림)이고, 숨긴 다른 사람의 상한은 null이다: 상한은 기준 시간 +
     * min(15분, 50%)이라 "상한 +N분"에서 숨긴 사람의 정확한 기준 시간이 거꾸로 나온다(#142).
     */
    private fun favorContext(
        result: RankResult,
        matrix: TravelMatrix,
        favorIndex: Int,
        hidden: HiddenTimes,
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
            baselineTimesSeconds =
                matrix.times.mapIndexed {
                    i,
                    row,
                    ->
                    hidden.seconds(i, requireNotNull(row[baselineColumn]))
                },
            capSeconds =
                result.participants.mapIndexed { i, id ->
                    if (i == favorIndex || hidden.isMasked(i)) null else caps[id]?.toInt()
                },
            closerStationsExcluded = closerExcluded,
        )
    }

    private fun RecommendMode.reasonMode() =
        when (this) {
            RecommendMode.FAIR -> ReasonMode.FAIR
            RecommendMode.FAST -> ReasonMode.FAST
            RecommendMode.FAVOR -> ReasonMode.FAVOR
        }

    private companion object {
        const val MAX_CARDS = 3
    }
}
