package app.banbanyeok.core

import app.banbanyeok.schema.RouteGraph
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.TimeSlot

/**
 * 화면에 보일 경로의 여유(초, #120): 최단 시간보다 이만큼까지 더 걸리는 경로 가운데 **환승이 가장 적은 것**을 보인다. 같은 환승 수면 더
 * 빠른 것이다. 우리 대기는 배차/2 평균이라 1~2분 차이는 모델 오차 안이고, 지도 앱은 그 안에서 환승이 적은 길을 먼저 보인다(카카오맵 대조
 * 28쌍, #120). **표시 전용이다**: 공평 순위와 사람별 시간·환승 수(od.bin)는 이 값과 상관없이 최단 경로의 것이다.
 */
public const val DISPLAY_ROUTE_SLACK_SECONDS: Int = 120

/** 최단 경로의 시간(초)과 환승 수. od.bin의 한 칸과 같은 뜻이다(시간 동률이면 최소 환승). */
public data class RouteCost(
    val seconds: Int,
    val transfers: Int,
)

/**
 * 경로의 한 구간: [line]을 [fromCode]에서 타고 [toCode]에서 내린다. [waitSeconds]는 타기 전 시간이다: 첫 구간은 출발역 대기, 그 뒤 구간은
 * 갈아타는 역에서 걷기 + 대기. [rideSeconds]는 타고 가는 시간이다. 시간은 배차/2 평균 대기로 만든 모델 값이라 화면에 숫자로 쓰지 않는다
 * (막대 길이 비율에만 쓴다).
 */
public data class RouteLeg(
    val line: String,
    val fromCode: String,
    val toCode: String,
    val waitSeconds: Int,
    val rideSeconds: Int,
)

/**
 * 한 사람의 경로. [legs]는 1개 이상이고 이어지는 두 구간 사이가 환승이다. [transfers]는 그래프의 갈아타는 간선 수(od.bin의 환승과 같은
 * 셈)다. 한 역에서 타지 않고 두 번 갈아타면(김포공항 공항철도 → 5호선 승강장 → 서해선) 구간은 하나로 합치므로 구간 수 - 1이
 * [transfers]보다 작을 수 있다.
 */
public data class Route(
    val seconds: Int,
    val transfers: Int,
    val legs: List<RouteLeg>,
)

/** One audited rail leg or external walk (line is null for a walk). */
public data class RouteTraceSegment(
    val fromCode: String,
    val toCode: String,
    val line: String?,
)

/** Internal route comparison data. The current route wire contract only exposes rail legs. */
public data class RouteTrace(
    val cost: RouteCost,
    val segments: List<RouteTraceSegment>,
)

/**
 * [graph]에서 [slot]의 대기로 경로를 찾는다. 파이프라인 발행 게이트(od.bin 모든 칸 대조)와 서버(추천 응답의 사람별 경로)가 이 코드를
 * 함께 쓴다: 같은 그래프·같은 동률 규칙이라 서버의 경로 시간이 od.bin과 어긋나지 않는다.
 */
public class RouteSearch(
    private val graph: RouteGraph,
    slot: TimeSlot,
) {
    private val waits = graph.waitsFor(slot)
    private val arrivals by lazy {
        val outdoorArrivals = reverseOutdoorWalks(graph.outdoorWalks)
        graph.platforms.mapValues { (code, _) -> boardingNodes(graph, outdoorDistances(code, outdoorArrivals)) }
    }

    /** [originCode]에서 모든 역까지. 그래프에 없는 역이면 null. */
    public fun from(originCode: String): RouteTree? {
        val value = StationCode.parseOrNull(originCode)?.value ?: return null
        if (value !in graph.platforms) return null
        val access = outdoorDistances(value, graph.outdoorWalks)
        val origins =
            boardingNodes(
                graph,
                access,
            ).filter { waits[graph.service(it.node)] != RouteGraph.UNAVAILABLE_WAIT }
        if (origins.isEmpty()) return null
        return RouteTree(graph, waits, value, origins, access, arrivals)
    }
}

/**
 * 한 출발역에서 환승 수별로 층을 나눈 최단 시간 표(층 k = 정확히 환승 k번).
 *
 * 계산: 층마다 타고 가는 간선만으로 다익스트라를 돌리고, 갈아타는 간선은 다음 층의 시작점이 된다. 어느 노드의 층 k 시간이 환승이 더 적은
 * 층들의 최단보다 빠르지 않으면 버린다(환승이 적고 늦지 않은 길이 있으면 그 뒤로 이어지는 길도 모두 그쪽이 낫다). 그래서 남은 층 k 값은
 * "환승 k번 이하로 갈 수 있는 가장 빠른 시간"이 줄어드는 곳에만 있고, 층은 몇 개에서 끝난다.
 *
 * 동률 규칙(결정적): 힙은 (시간, 노드 색인) 순서로 꺼내고, 값은 **더 빠를 때만** 바꾼다(먼저 찾은 쪽이 남는다). 간선은 그래프의 순서대로
 * 본다. 도착역에 노드가 여럿이면 색인이 작은 노드를 쓴다.
 */
public class RouteTree internal constructor(
    private val graph: RouteGraph,
    private val waits: IntArray,
    private val originValue: Int,
    origins: List<WalkingAccess>,
    private val outdoorAccess: Map<Int, Int>,
    private val arrivals: Map<Int, List<WalkingAccess>>,
) {
    private val layers = mutableListOf<Layer>()

    /** 층 수 상한에 걸려 끝까지 계산하지 못했다. 이때는 어떤 값도 내지 않는다(모르면 끈다). */
    private var truncated = false

    private class Layer(
        size: Int,
    ) {
        val label = IntArray(size) { INF }
        val predNode = IntArray(size) { -1 }
        val predEdge = IntArray(size) { -1 }
    }

    /** 다음 층의 시작점: 노드마다 가장 빠른 값과 그 값을 낸 (이전 노드, 간선). 같으면 먼저 온 것이 남는다. */
    private class Seeds(
        size: Int,
    ) {
        val time = IntArray(size) { INF }
        val node = IntArray(size) { -1 }
        val edge = IntArray(size) { -1 }

        fun offer(
            to: Int,
            seconds: Int,
            from: Int,
            via: Int,
        ) {
            if (seconds < time[to]) {
                time[to] = seconds
                node[to] = from
                edge[to] = via
            }
        }
    }

    private val heap = LongHeap()

    // 위의 상태(층, 힙)가 모두 만들어진 뒤에 계산한다.
    init {
        search(origins)
    }

    private fun search(origins: List<WalkingAccess>) {
        val n = graph.nodeCount
        // best[v]: 지금까지 계산한 층들(환승이 더 적은 길)에서 v에 닿는 가장 빠른 시간.
        val best = IntArray(n) { INF }
        var seeds = Seeds(n)
        origins.forEach { (node, walk) -> seeds.offer(node, waits[graph.service(node)] + walk, -1, -1) }
        while (true) {
            val layer = seed(seeds, best) ?: return
            if (layers.size == MAX_LAYERS) {
                truncated = true
                return
            }
            seeds = settle(layer, best)
            for (v in 0 until n) best[v] = minOf(best[v], layer.label[v])
            layers.add(layer)
        }
    }

    /** 환승이 더 적은 길보다 빠른 시작점만으로 새 층을 연다. 그런 시작점이 없으면 null(계산 끝). */
    private fun seed(
        seeds: Seeds,
        best: IntArray,
    ): Layer? {
        val layer = Layer(graph.nodeCount)
        for (v in 0 until graph.nodeCount) {
            if (seeds.time[v] < best[v]) {
                layer.label[v] = seeds.time[v]
                layer.predNode[v] = seeds.node[v]
                layer.predEdge[v] = seeds.edge[v]
                heap.push(key(seeds.time[v], v))
            }
        }
        return if (heap.isEmpty()) null else layer
    }

    /** 층 안의 다익스트라(타고 가는 간선). 갈아타는 간선은 다음 층의 시작점으로 모은다. */
    private fun settle(
        layer: Layer,
        best: IntArray,
    ): Seeds {
        val next = Seeds(graph.nodeCount)
        while (!heap.isEmpty()) {
            val top = heap.pop()
            val time = (top ushr NODE_BITS).toInt()
            val v = (top and NODE_MASK).toInt()
            if (time == layer.label[v]) relax(v, time, layer, best, next)
        }
        return next
    }

    private fun relax(
        v: Int,
        time: Int,
        layer: Layer,
        best: IntArray,
        next: Seeds,
    ) {
        for (e in graph.edgeStart(v) until graph.edgeEnd(v)) {
            val w = graph.edgeTarget(e)
            val wait = graph.edgeWaitService(e)
            if (waits[graph.service(w)] == RouteGraph.UNAVAILABLE_WAIT ||
                (wait != RouteGraph.NO_WAIT && waits[wait] == RouteGraph.UNAVAILABLE_WAIT)
            ) {
                continue
            }
            if (wait != RouteGraph.NO_WAIT) {
                next.offer(w, time + graph.edgeSeconds(e) + waits[wait], v, e)
            } else {
                val arrival = time + graph.edgeSeconds(e)
                if (arrival < layer.label[w] && arrival < best[w]) {
                    layer.label[w] = arrival
                    layer.predNode[w] = v
                    layer.predEdge[w] = e
                    heap.push(key(arrival, w))
                }
            }
        }
    }

    /** 층마다 그 역의 "환승 k번 이하" 최단 시간. 갈 수 없으면 null. */
    private fun stationBests(
        destination: List<WalkingAccess>,
        onlyWalk: Int,
    ): IntArray? {
        if (truncated) return null
        var running = onlyWalk
        val bests =
            IntArray(layers.size) { k ->
                destination.forEach { (node, walk) ->
                    val riding = layers[k].label[node]
                    if (riding < INF) running = minOf(running, riding + walk)
                }
                running
            }
        return bests.takeIf { it.isNotEmpty() && it.last() < INF }
    }

    private fun isOrigin(destinationCode: String): Boolean =
        StationCode.parseOrNull(destinationCode)?.value == originValue

    /** 최단 경로의 시간·환승 수(od.bin 한 칸과 같은 값). 출발역과 같은 역이면 0, 0. 갈 수 없거나 그래프에 없는 역이면 null. */
    public fun fastest(destinationCode: String): RouteCost? {
        if (isOrigin(destinationCode)) return if (truncated) null else RouteCost(0, 0)
        val value = StationCode.parseOrNull(destinationCode)?.value ?: return null
        val bests = stationBests(arrivals[value].orEmpty(), outdoorAccess[value] ?: INF) ?: return null
        val seconds = bests.last()
        return RouteCost(seconds, bests.indexOfFirst { it == seconds })
    }

    /**
     * 화면에 보일 경로: 최단 시간보다 [slackSeconds] 이내로 더 걸리는 경로 가운데 환승이 가장 적은 것(같은 환승 수면 가장 빠른 것).
     * 출발역과 같은 역이거나 갈 수 없거나 그래프에 없는 역이면 null.
     */
    public fun display(
        destinationCode: String,
        slackSeconds: Int = DISPLAY_ROUTE_SLACK_SECONDS,
    ): Route? {
        val target = choose(destinationCode, slackSeconds) ?: return null
        val node = target.node ?: return null
        val path = restorePath(target.layer, node)
        if (target.walk != 0 || hasOutdoorWalk(path)) return null
        return Route(target.seconds, target.layer, legs(path.nodes, path.edges))
    }

    /** An audit of the same selected route, including any outdoor portions omitted from the wire. */
    public fun trace(
        destinationCode: String,
        slackSeconds: Int = DISPLAY_ROUTE_SLACK_SECONDS,
    ): RouteTrace? {
        val target = choose(destinationCode, slackSeconds) ?: return null
        val node = target.node
        val segments =
            if (node == null) {
                listOf(RouteTraceSegment(code(originValue), destinationCode, null))
            } else {
                traceSegments(restorePath(target.layer, node), destinationCode)
            }
        return RouteTrace(RouteCost(target.seconds, target.layer), segments)
    }

    private fun choose(
        destinationCode: String,
        slackSeconds: Int,
    ): Target? {
        require(slackSeconds >= 0) { "slackSeconds는 0 이상이어야 합니다" }
        if (isOrigin(destinationCode)) return null
        val value = StationCode.parseOrNull(destinationCode)?.value ?: return null
        val destination = arrivals[value].orEmpty()
        val onlyWalk = outdoorAccess[value] ?: INF
        val bests = stationBests(destination, onlyWalk) ?: return null
        val limit = bests.last().toLong() + slackSeconds
        val k = bests.indexOfFirst { it <= limit }
        val chosen =
            destination.firstOrNull { (node, walk) ->
                val riding = layers[k].label[node]
                onlyWalk != bests[k] && riding < INF && riding + walk == bests[k]
            }
        return Target(k, chosen?.node, chosen?.seconds ?: 0, bests[k])
    }

    private data class Target(
        val layer: Int,
        val node: Int?,
        val walk: Int,
        val seconds: Int,
    )

    private data class Path(
        val nodes: List<Int>,
        val edges: List<Int>,
    )

    private fun restorePath(
        layer: Int,
        target: Int,
    ): Path {
        val nodes = mutableListOf<Int>()
        val edges = mutableListOf<Int>()
        var k = layer
        var v = target
        while (true) {
            nodes.add(v)
            val edge = layers[k].predEdge[v]
            if (edge < 0) break
            val from = layers[k].predNode[v]
            if (graph.edgeWaitService(edge) != RouteGraph.NO_WAIT) k -= 1
            edges.add(edge)
            v = from
        }
        check(k == 0) { "경로 복원이 출발 층에서 끝나지 않았습니다" }
        return Path(nodes.asReversed(), edges.asReversed())
    }

    private fun hasOutdoorWalk(path: Path): Boolean =
        graph.codeValue(path.nodes.first()) != originValue ||
            path.edges.indices.any { i ->
                graph.edgeWaitService(path.edges[i]) != RouteGraph.NO_WAIT &&
                    graph.codeValue(path.nodes[i]) != graph.codeValue(path.nodes[i + 1])
            }

    private fun traceSegments(
        path: Path,
        destination: String,
    ): List<RouteTraceSegment> =
        buildList {
            val first = nodeCode(path.nodes.first())
            if (first != code(originValue)) add(RouteTraceSegment(code(originValue), first, null))
            var railStart = 0
            path.edges.forEachIndexed { i, edge ->
                if (graph.edgeWaitService(edge) != RouteGraph.NO_WAIT) {
                    if (railStart < i) add(railSegment(path.nodes[railStart], path.nodes[i]))
                    val from = nodeCode(path.nodes[i])
                    val to = nodeCode(path.nodes[i + 1])
                    if (from != to) add(RouteTraceSegment(from, to, null))
                    railStart = i + 1
                }
            }
            if (railStart < path.edges.size) add(railSegment(path.nodes[railStart], path.nodes.last()))
            val final = nodeCode(path.nodes.last())
            if (final != destination) add(RouteTraceSegment(final, destination, null))
        }

    private fun railSegment(
        from: Int,
        to: Int,
    ): RouteTraceSegment = RouteTraceSegment(nodeCode(from), nodeCode(to), graph.lineOf(from))

    private fun nodeCode(node: Int): String = code(graph.codeValue(node))

    private fun code(value: Int): String = StationCode.ofValue(value).toString()

    private fun legs(
        nodes: List<Int>,
        edges: List<Int>,
    ): List<RouteLeg> {
        val legs = mutableListOf<RouteLeg>()
        var start = nodes.first()
        var wait = waits[graph.service(start)]
        var ride = 0
        edges.forEachIndexed { i, e ->
            val service = graph.edgeWaitService(e)
            if (service == RouteGraph.NO_WAIT) {
                ride += graph.edgeSeconds(e)
            } else {
                val transfer = graph.edgeSeconds(e) + waits[service]
                // 타지 않은 구간(같은 역에서 연달아 갈아탐)은 만들지 않고 그 시간을 다음 구간의 갈아타는 시간에 더한다.
                if (ride > 0) {
                    legs.add(leg(start, nodes[i], wait, ride))
                    wait = transfer
                } else {
                    wait += transfer
                }
                start = nodes[i + 1]
                ride = 0
            }
        }
        legs.add(leg(start, nodes.last(), wait, ride))
        return legs
    }

    private fun leg(
        from: Int,
        to: Int,
        wait: Int,
        ride: Int,
    ) = RouteLeg(
        graph.lineOf(from),
        StationCode.ofValue(graph.codeValue(from)).toString(),
        StationCode.ofValue(graph.codeValue(to)).toString(),
        wait,
        ride,
    )

    private companion object {
        const val INF = Int.MAX_VALUE

        /** 층 수(= 환승 수 + 1) 상한. 실제 데이터는 이보다 훨씬 적다. 넘으면 값을 내지 않는다. */
        const val MAX_LAYERS = 32
        const val NODE_BITS = 17
        const val NODE_MASK = (1L shl NODE_BITS) - 1

        fun key(
            time: Int,
            node: Int,
        ): Long = (time.toLong() shl NODE_BITS) or node.toLong()
    }
}

internal data class WalkingAccess(
    val node: Int,
    val seconds: Int,
)

private fun boardingNodes(
    graph: RouteGraph,
    walk: Map<Int, Int>,
): List<WalkingAccess> =
    walk.flatMap { (code, seconds) -> graph.platforms[code]?.map { WalkingAccess(it, seconds) }.orEmpty() }

private fun reverseOutdoorWalks(walks: Map<Int, Map<Int, Int>>): Map<Int, Map<Int, Int>> {
    val reverse = mutableMapOf<Int, MutableMap<Int, Int>>()
    for ((from, edges) in walks) {
        for ((to, seconds) in edges) {
            reverse.getOrPut(to, ::mutableMapOf)[from] = seconds
        }
    }
    return reverse
}

/** Shortest walks on the sparse graph of external station links, independent of rail boarding. */
private fun outdoorDistances(
    start: Int,
    walks: Map<Int, Map<Int, Int>>,
): Map<Int, Int> {
    val best = mutableMapOf(start to 0)
    val pending = mutableSetOf(start)
    while (pending.isNotEmpty()) {
        val current = pending.minBy(best::getValue)
        pending.remove(current)
        val elapsed = best.getValue(current)
        for ((next, seconds) in walks[current].orEmpty()) {
            val candidate = elapsed + seconds
            if (candidate < (best[next] ?: Int.MAX_VALUE)) {
                best[next] = candidate
                pending.add(next)
            }
        }
    }
    return best
}

/** 최소 힙(Long). 공통 코드라 java.util.PriorityQueue를 쓰지 않는다. */
private class LongHeap {
    private var items = LongArray(INITIAL)
    private var size = 0

    fun isEmpty(): Boolean = size == 0

    fun push(value: Long) {
        if (size == items.size) items = items.copyOf(size * 2)
        var i = size++
        items[i] = value
        while (i > 0) {
            val parent = (i - 1) / 2
            if (items[parent] <= items[i]) break
            swap(i, parent)
            i = parent
        }
    }

    fun pop(): Long {
        val top = items[0]
        size -= 1
        items[0] = items[size]
        var i = 0
        var child = smallerChild(0)
        while (child >= 0 && items[child] < items[i]) {
            swap(i, child)
            i = child
            child = smallerChild(i)
        }
        return top
    }

    private fun smallerChild(i: Int): Int {
        val left = 2 * i + 1
        return when {
            left >= size -> -1
            left + 1 < size && items[left + 1] < items[left] -> left + 1
            else -> left
        }
    }

    private fun swap(
        a: Int,
        b: Int,
    ) {
        val t = items[a]
        items[a] = items[b]
        items[b] = t
    }

    private companion object {
        const val INITIAL = 256
    }
}
