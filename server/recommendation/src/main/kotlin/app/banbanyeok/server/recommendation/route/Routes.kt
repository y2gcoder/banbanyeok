package app.banbanyeok.server.recommendation.route

import app.banbanyeok.core.RouteLeg
import app.banbanyeok.core.RouteSearch
import app.banbanyeok.core.RouteTree
import app.banbanyeok.schema.RouteGraph
import app.banbanyeok.schema.TimeSlot

/**
 * 지금 쓸 수 있는 노선 그래프(#120, data-format §11). 없으면 null이다: 데이터가 세대 4가 아니거나, 아직 뒤에서 읽는 중이거나, 검증에
 * 실패했다. 그러면 응답에서 사람별 경로만 빠지고 순위·시간은 그대로다(화면은 중립색 막대로 그린다).
 */
public fun interface RouteSource {
    public fun current(): RouteGraph?
}

/** 경로가 지나는 역. */
public data class RouteStop(
    public val stationCode: String,
    public val stationName: String,
)

/**
 * 한 구간: [line]을 [from]에서 타고 [to]에서 내린다. [waitSeconds]는 타기 전 시간(첫 구간은 출발역 대기, 그 뒤는 갈아타는 역에서 걷기 +
 * 대기), [rideSeconds]는 타고 가는 시간이다. 시간은 배차/2 평균 대기로 만든 모델 값이라 화면에 숫자로 쓰지 않는다(막대 길이 비율에만 쓴다).
 */
public data class ParticipantRouteLeg(
    public val line: String,
    public val from: RouteStop,
    public val to: RouteStop,
    public val waitSeconds: Int,
    public val rideSeconds: Int,
)

/** 한 사람이 출발역에서 만날 역까지 가는 화면용 경로(최단 + 2분 안에서 환승이 가장 적은 길, shared:core `RouteTree.display`). */
public data class ParticipantRoute(
    public val participantId: String,
    public val legs: List<ParticipantRouteLeg>,
)

/**
 * 순위를 다 정한 뒤 만날 역마다 사람별 경로를 붙인다. 순위·시간·이유 문장에는 쓰이지 않는다.
 * **출발역을 숨긴 사람의 경로는 그 사람의 요청([viewerId])에만 넣는다**: 경로의 첫 역이 곧 출발역이다.
 */
internal class RouteAttacher(
    private val source: RouteSource,
    private val names: (String) -> String?,
) {
    class Rider(
        val id: String,
        val originCode: String,
        val hidden: Boolean,
    )

    /**
     * [slot](행렬을 실제로 읽은 구분)의 대기로 이 요청의 경로를 찾는 조회. 그래프가 없으면 null(경로 항목을 뺀다). 그래프는 여기서 **한 번**
     * 읽고, 출발역마다 계산은 처음 물을 때 한 번만 한다.
     */
    fun forRequest(
        slot: TimeSlot,
        riders: List<Rider>,
        viewerId: String?,
    ): Attached? {
        val graph = source.current() ?: return null
        return Attached(RouteSearch(graph, slot), riders.filter { !it.hidden || it.id == viewerId }, names)
    }

    class Attached(
        private val search: RouteSearch,
        private val riders: List<Rider>,
        private val names: (String) -> String?,
    ) {
        private val trees = mutableMapOf<String, RouteTree?>()

        /** [stationCode]까지 보여 줄 수 있는 사람의 경로(요청 참가자 순서). 같은 역에서 출발하거나 경로를 모르는 사람은 빠진다. */
        fun at(stationCode: String): List<ParticipantRoute> =
            riders.mapNotNull { rider ->
                val tree = trees.getOrPut(rider.originCode) { search.from(rider.originCode) }
                tree?.display(stationCode)?.let { route -> ParticipantRoute(rider.id, route.legs.map { it.view() }) }
            }

        private fun RouteLeg.view() = ParticipantRouteLeg(line, stop(fromCode), stop(toCode), waitSeconds, rideSeconds)

        private fun stop(code: String) = RouteStop(code, names(code) ?: code)
    }
}
