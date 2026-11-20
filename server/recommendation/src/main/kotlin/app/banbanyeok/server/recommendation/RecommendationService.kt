package app.banbanyeok.server.recommendation

import app.banbanyeok.applogic.Comparison
import app.banbanyeok.applogic.FavorContext
import app.banbanyeok.applogic.ParticipantLabel
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
import app.banbanyeok.schema.TimeSlot
import java.time.Clock
import app.banbanyeok.core.Candidate as CoreCandidate

public enum class RecommendMode { FAIR, FAST, FAVOR }

/**
 * 계산에 들어가는 사람 한 명. [id]는 방에서는 participantId, 무상태 추천에서는 입력 순서의 인덱스 문자열이다.
 * [hidden]이면 [originCode]는 계산에만 쓰고 표시 이름·문장에는 출발역을 쓰지 않는다.
 */
public class RecommendParticipant(
    public val id: String,
    public val nickname: String?,
    public val originCode: String,
    public val hidden: Boolean = false,
)

public class RecommendRequest(
    public val participants: List<RecommendParticipant>,
    public val mode: RecommendMode,
    /** [RecommendMode.FAVOR]일 때 우대할 사람의 [RecommendParticipant.id]. */
    public val favorId: String? = null,
    /** 언제 만나는가. 무상태 추천은 요청의 구분, 방은 약속 날짜·시각에서 정한 구분([TimeSlotResolver]). */
    public val time: TimeBasis = TimeBasis(TimeSlot.DEFAULT, TimeSlotLabels.of(TimeSlot.DEFAULT)),
    /** [time]의 요일 종류를 믿을 수 있는가. 막차 시각은 [DayCertainty.KNOWN]일 때만 낸다. */
    public val dayCertainty: DayCertainty = DayCertainty.KNOWN,
    /** 이 결과를 보는 참가자의 [RecommendParticipant.id](방에서 토큰으로 확인한 본인). 숨긴 사람의 막차는 본인 요청에만 붙는다. */
    public val viewerId: String? = null,
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
    /** 이 역에서 돌아가는 사람별 막차(#62). 막차 표를 쓸 수 없으면 null. 숨긴 사람은 본인 요청일 때만 들어 있다. */
    public val lastTrains: List<ParticipantLastTrain>? = null,
)

public data class Recommendation(
    /** `ok` 또는 `no_common_candidate`. */
    public val status: String,
    public val mode: RecommendMode,
    public val dataVersion: String,
    public val baselineStationCode: String?,
    public val candidates: List<RecommendedStation>,
    /** 요청 참가자 순서의 표시 이름(contracts/data-format.md §8). 문장도 이 이름을 쓴다. */
    public val labels: List<ParticipantLabel>,
    /** 실제로 계산한 구분. 요청한 구분의 행렬이 데이터에 없으면 기본 구분(평일 낮)이며 표시 이름도 그것을 따른다. */
    public val timeBasis: TimeBasis = TimeBasis(TimeSlot.DEFAULT, TimeSlotLabels.of(TimeSlot.DEFAULT)),
    /** 요청한(방은 약속 날짜·시각에서 정한) 구분. [timeBasis]와 다르면 기본 구분으로 대신 계산한 것이다. */
    public val requestedSlot: TimeSlot = TimeSlot.DEFAULT,
    /** 막차의 기준(요일 종류·시간표 수집일). null이면 이 응답에는 막차가 없다(후보의 `lastTrains`도 null). */
    public val lastTrainBasis: LastTrainBasis? = null,
)

/** [RecommendationService.recommendWithMapMiddle]의 결과. [mapMiddle]은 보일 조건을 채울 때만 있다. */
public data class RecommendationWithMapMiddle(
    public val recommendation: Recommendation,
    public val mapMiddle: MapMiddle?,
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
    private val locations: StationLocations = StationLocations { null },
    lastTrains: LastTrainSource = LastTrainSource { null },
    clock: Clock = Clock.systemUTC(),
) {
    private val lastTrains = LastTrainAttacher(lastTrains, clock, stationNames)

    public fun recommend(request: RecommendRequest): Recommendation {
        validate(request)
        return recommendFrom(request, measure(request))
    }

    /**
     * [recommend]와 "지도 한가운데" 비교(#68)를 **한 번 읽은 같은 행렬**로 계산한다. 순위와 비교를 따로 조회하면 구분 행렬 검사가
     * 그 사이에 끝났을 때 응답의 timeBasis와 다른 구분으로 비교 시간이 나올 수 있다(BackgroundSlots).
     */
    public fun recommendWithMapMiddle(request: RecommendRequest): RecommendationWithMapMiddle {
        validate(request)
        val matrix = measure(request)
        val recommendation = recommendFrom(request, matrix)
        return RecommendationWithMapMiddle(recommendation, mapMiddleFrom(request, recommendation, matrix))
    }

    private fun measure(request: RecommendRequest): TravelMatrix =
        travelTimes.measure(request.participants.map { it.originCode }, request.time.slot)

    private fun recommendFrom(
        request: RecommendRequest,
        matrix: TravelMatrix,
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
        val timeBasis = computedBasis(request, matrix)
        // 순위(top)를 다 정한 뒤에 붙인다. 순위·시간·이유에는 쓰이지 않는다.
        val attached = lastTrains.forRequest(request, timeBasis)
        return Recommendation(
            status = result.status,
            mode = request.mode,
            dataVersion = travelTimes.dataVersion,
            baselineStationCode = result.baselineStationCode,
            labels = ParticipantLabels.of(refs),
            requestedSlot = request.time.slot,
            timeBasis = timeBasis,
            lastTrainBasis = attached?.basis,
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
                        lastTrains = attached?.at(card.stationCode),
                    )
                },
        )
    }

    /**
     * [request]의 사람들이 [stationCode]까지 걸리는 시간(요청 참가자 순서). 순위와 상관없는 역(다른 기준 탭에서 정한 역)도 잰다.
     * 후보 축에 없는 역이면 null이고, 갈 수 없는 사람은 그 칸이 null이다. 요청 검사는 [recommend]와 같다.
     */
    public fun timesTo(
        request: RecommendRequest,
        stationCode: String,
    ): List<ParticipantTime?>? {
        validate(request)
        val matrix = travelTimes.measure(request.participants.map { it.originCode }, request.time.slot)
        val column = matrix.candidates.indexOf(stationCode).takeIf { it >= 0 } ?: return null
        return request.participants.mapIndexed { row, person ->
            matrix.times[row][column]?.let { seconds ->
                ParticipantTime(person.id, seconds, requireNotNull(matrix.transfers[row][column]))
            }
        }
    }

    /**
     * [stationCode]에서 돌아가는 사람별 막차와 그 기준. 순위와 상관없는 역(방에서 정한 역)에도 쓴다. 막차 표를 쓸 수 없거나 요청한 구분의
     * 행렬이 없으면 null이다. 숨긴 사람은 [RecommendRequest.viewerId]일 때만 들어 있다.
     */
    public fun lastTrainsTo(
        request: RecommendRequest,
        stationCode: String,
    ): Pair<LastTrainBasis, List<ParticipantLastTrain>>? {
        validate(request)
        val attached = lastTrains.forRequest(request, computedBasis(request, measure(request))) ?: return null
        return attached.basis to attached.at(stationCode)
    }

    /** 실제로 계산한 구분. 요청한 구분의 행렬이 없으면 기본 구분이다. */
    private fun computedBasis(
        request: RecommendRequest,
        matrix: TravelMatrix,
    ): TimeBasis =
        if (matrix.slot == request.time.slot) request.time else TimeBasis(matrix.slot, TimeSlotLabels.of(matrix.slot))

    /**
     * "지도 한가운데" 비교(#68)를 보일 때만 값을 준다. 하나라도 어기면 null이다.
     * - 공평 기준이고 1위 추천 역이 있다.
     * - **출발역을 숨긴 사람이 없다**: 숨긴 사람의 출발역은 평균점과 지도 한가운데 역에서 거꾸로 짐작할 수 있다.
     * - 모든 참가자의 출발역 좌표를 안다.
     * - 지도 한가운데 역이 1위 추천 역과 다르다(모두가 갈 수 있는 역 중에서 고른다).
     * - 그 역의 최장 시간이 1위 추천 역보다 [MapMiddleRule.MIN_EXTRA_MINUTES]분 이상 길다.
     * 순위는 건드리지 않는다. 시간은 순위를 낸 [matrix]와 같은 행렬(같은 데이터 버전·같은 구분)에서 꺼낸다.
     */
    private fun mapMiddleFrom(
        request: RecommendRequest,
        recommendation: Recommendation,
        matrix: TravelMatrix,
    ): MapMiddle? {
        val top = recommendation.candidates.firstOrNull() ?: return null
        val fair = request.mode == RecommendMode.FAIR && recommendation.mode == RecommendMode.FAIR
        return if (fair && request.participants.none { it.hidden }) middleStation(request, top, matrix) else null
    }

    private fun middleStation(
        request: RecommendRequest,
        top: RecommendedStation,
        matrix: TravelMatrix,
    ): MapMiddle? {
        val people = request.participants
        val points = people.mapNotNull { locations.locate(it.originCode) }
        if (points.size != people.size) return null
        val column =
            MapMiddleRule.nearest(points, matrix.candidates, locations) { c -> matrix.times.all { it[c] != null } }
                ?: return null
        val times =
            people.mapIndexed { row, person ->
                val seconds = requireNotNull(matrix.times[row][column])
                ParticipantTime(person.id, seconds, requireNotNull(matrix.transfers[row][column]))
            }
        val code = matrix.candidates[column]
        val worseEnough =
            MapMiddleRule.extraMinutes(times.map { it.seconds }, top.maxSeconds) >= MapMiddleRule.MIN_EXTRA_MINUTES
        return if (code != top.stationCode && worseEnough) MapMiddle(code, nameOf(code), times) else null
    }

    private fun validate(request: RecommendRequest) {
        val people = request.participants
        if (people.size !in MIN_PEOPLE..MAX_PEOPLE) reject(RecommendationError.PEOPLE_COUNT, "참가자는 2~4명이어야 합니다")
        if (people.any { it.nickname != null && !Nicknames.isValid(it.nickname) }) {
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
