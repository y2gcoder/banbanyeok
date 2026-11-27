package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.StationRegion
import app.banbanyeok.server.recommendation.lasttrain.LastTrainAttacher
import app.banbanyeok.server.recommendation.lasttrain.LastTrainSource
import app.banbanyeok.server.recommendation.mapmiddle.MapMiddlePicker
import app.banbanyeok.server.recommendation.mapmiddle.StationLocations
import app.banbanyeok.server.recommendation.route.RouteAttacher
import app.banbanyeok.server.recommendation.route.RouteSource
import app.banbanyeok.server.recommendation.time.TimeBasis
import java.time.Clock

/**
 * 추천 계산의 진입점. [evaluate] 하나로 요청을 검사하고, 구분 행렬을 기다리고, 행렬과 막차 표를 **한 번씩** 읽어 [Evaluation]을 만든다.
 * 순위·지도 한가운데·순위 밖 역의 시간·막차는 모두 그 [Evaluation]에서 꺼낸다(#88: 따로 재면 그 사이에 구분 행렬 검사나 막차 표 읽기가
 * 끝나 응답의 timeBasis와 다른 구분이 섞일 수 있다).
 *
 * 생성자 인자 여덟 개는 서로 다른 포트·정책이고 [travelTimes]·[stationNames] 말고는 기본값이 있다. 묶을 자연스러운 단위가 없어
 * LongParameterList는 끈다.
 */
@Suppress("LongParameterList")
public class RecommendationService(
    private val travelTimes: TravelTimeProvider,
    stationNames: StationNames,
    toleranceSeconds: Int = 0,
    locations: StationLocations = StationLocations { null },
    lastTrains: LastTrainSource = LastTrainSource { null },
    clock: Clock = Clock.systemUTC(),
    /** 비기본 구분의 행렬을 쓸 수 있을 때까지 측정 전에 잠깐 기다린다. 서버는 app의 BackgroundSlots, 테스트는 기다리지 않는다. */
    private val slotsReady: SlotReadiness = SlotReadiness {},
    /** 사람별 경로의 노선 그래프(#120). 없으면 응답에 경로가 없다. 서버는 app의 BackgroundRoutes. */
    routes: RouteSource = RouteSource { null },
) {
    private val ranking = Ranking(stationNames, toleranceSeconds)
    private val middlePicker = MapMiddlePicker(locations)
    private val lastTrains = LastTrainAttacher(lastTrains, clock, stationNames::nameOf)
    private val routes = RouteAttacher(routes, stationNames::nameOf)

    /**
     * 요청을 검사하고 한 번 잰 행렬로 평가한다. 규칙에 맞지 않으면 [RecommendationException]. 참가자 목록은 처음에 한 번 복사해 검사부터
     * [Evaluation]의 지연 조회까지 그 사본을 쓴다: 호출자가 나중에 목록을 바꿔도 평가는 바뀌지 않는다.
     */
    public suspend fun evaluate(requested: RecommendRequest): Evaluation {
        val request = requested.withParticipants(requested.participants.toList())
        validate(request)
        slotsReady.await(request.time.slot)
        val matrix = travelTimes.measure(request.participants.map { it.originCode }, request.time.slot)
        val timeBasis = computedBasis(request, matrix)
        val riders = request.participants.map { LastTrainAttacher.Rider(it.id, it.originCode) }
        // 막차 표는 여기서 한 번 읽는다. 순위·시간·이유에는 쓰이지 않고, 순위를 다 정한 뒤 카드에 붙는다.
        val lookup = lastTrains.forRequest(request.time.slot, timeBasis.slot, request.dayCertainty, riders)
        val attached = lookup.attached
        val ranked =
            ranking
                .rank(request, matrix, timeBasis, attached, travelTimes.dataVersion)
                .copy(lastTrainPending = lookup.pending)
        // 경로도 순위를 다 정한 뒤 붙인다. 행렬을 실제로 읽은 구분의 대기로 계산해야 시간이 od와 맞는다(발행 게이트).
        val routed =
            routes.forRequest(
                matrix.slot,
                request.participants.map { RouteAttacher.Rider(it.id, it.originCode) },
            )
        val recommendation =
            if (routed == null) {
                ranked
            } else {
                ranked.copy(candidates = ranked.candidates.map { it.copy(routes = routed.at(it.stationCode)) })
            }
        return Evaluation(request, matrix, attached, recommendation, middlePicker, ranking::nameOf)
    }

    private fun RecommendRequest.withParticipants(people: List<RecommendParticipant>) =
        RecommendRequest(people, mode, favorId, time, dayCertainty)

    /** 실제로 계산한 구분. 요청한 구분의 행렬이 없으면 기본 구분이다. */
    private fun computedBasis(
        request: RecommendRequest,
        matrix: TravelMatrix,
    ): TimeBasis = if (matrix.slot == request.time.slot) request.time else TimeBasis.of(matrix.slot)

    private fun validate(request: RecommendRequest): StationRegion {
        val people = request.participants
        if (people.size !in MIN_PEOPLE..MAX_PEOPLE) reject(RecommendationError.PEOPLE_COUNT, "참가자는 2~4명이어야 합니다")
        if (people.any { it.nickname != null && !Nicknames.isValid(it.nickname) }) {
            reject(RecommendationError.INVALID_NICKNAME, "별칭이 올바르지 않습니다")
        }
        if (people.any { !travelTimes.isOrigin(it.originCode) }) {
            reject(RecommendationError.UNKNOWN_STATION, "알 수 없는 출발역이 있습니다")
        }
        val regions = people.map { travelTimes.regionOf(it.originCode) }.toSet()
        val region = regions.singleOrNull() ?: reject(RecommendationError.REGION_MISMATCH, "방과 추천은 한 권역 안에서 계산합니다")
        if (request.mode == RecommendMode.FAVOR) {
            val target = request.favorId ?: reject(RecommendationError.FAVOR_TARGET_REQUIRED, "우대 대상이 필요합니다")
            if (people.none { it.id == target }) reject(RecommendationError.FAVOR_TARGET_UNKNOWN, "우대 대상이 참가자에 없습니다")
        }
        return region
    }

    private fun reject(
        error: RecommendationError,
        message: String,
    ): Nothing = throw RecommendationException(error, message)

    private companion object {
        const val MIN_PEOPLE = 2
        const val MAX_PEOPLE = 4
    }
}
