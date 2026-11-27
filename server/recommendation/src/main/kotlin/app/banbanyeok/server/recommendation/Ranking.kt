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
import app.banbanyeok.core.Candidate
import app.banbanyeok.core.RankInput
import app.banbanyeok.core.RankResult
import app.banbanyeok.core.rank
import app.banbanyeok.server.recommendation.lasttrain.LastTrainAttacher
import app.banbanyeok.server.recommendation.time.TimeBasis

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
        val top = result.recommendations.take(MAX_CARDS)
        val refs = personRefs(people)
        val favor = if (favorIndex >= 0) favorContext(result, matrix, favorIndex) else null
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
                        lastTrains = lastTrains?.at(card.stationCode),
                    )
                },
        )
    }

    fun nameOf(code: String): String = stationNames.nameOf(code) ?: code

    /** 표시 이름과 문장의 입력(data-format §8). */
    private fun personRefs(people: List<RecommendParticipant>): List<PersonRef> =
        people.map {
            PersonRef(
                id = it.id,
                name = it.nickname?.trim()?.takeIf(String::isNotEmpty),
                originCode = it.originCode,
                originName = stationNames.nameOf(it.originCode),
            )
        }

    /** 카드 한 장의 문장을 만드는 데 쓰는 요청 전체의 맥락. */
    private data class CardContext(
        val mode: RecommendMode,
        val result: RankResult,
        val top: List<Candidate>,
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

    /** 배려 문장의 기준역 시간과 상한. */
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
            capSeconds = result.participants.map { caps[it]?.toInt() },
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
