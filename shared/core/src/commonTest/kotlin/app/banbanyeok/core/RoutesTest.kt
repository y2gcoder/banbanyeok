package app.banbanyeok.core

import app.banbanyeok.schema.RouteGraph
import app.banbanyeok.schema.RouteGraphCodec
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.TimeSlot
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private class Edge(
    val from: Int,
    val to: Int,
    val seconds: Int,
    val wait: Int = RouteGraph.NO_WAIT,
)

private fun code(station: Int): String = StationCode.ofValue(station + 1).toString()

/** 노드 = (역 번호, 계통 번호). 계통 i의 노선 이름은 [lines]의 i번째, 대기는 모든 구분에서 [waits]. */
private fun graph(
    nodes: List<Pair<Int, Int>>,
    edges: List<Edge>,
    waits: IntArray,
    lines: List<String> = List(waits.size) { "L$it" },
    formatVersion: Int = RouteGraphCodec.FORMAT_VERSION,
): RouteGraph {
    val sorted = edges.withIndex().sortedWith(compareBy({ it.value.from }, { it.index })).map { it.value }
    val starts = IntArray(nodes.size + 1)
    sorted.forEach { starts[it.from + 1]++ }
    for (v in 0 until nodes.size) starts[v + 1] += starts[v]
    return RouteGraph(
        1,
        lines,
        IntArray(waits.size) { it },
        nodes.map { StationCode.parse(code(it.first)).value }.toIntArray(),
        nodes.map { it.second }.toIntArray(),
        starts,
        sorted.map { it.to }.toIntArray(),
        sorted.map { it.seconds }.toIntArray(),
        sorted.map { it.wait }.toIntArray(),
        TimeSlot.ALL.map { waits.copyOf() },
        formatVersion,
    )
}

class RoutesTest {
    @Test
    fun outdoorWalksChargeOnlyBoardedServicesAndUnavailableServicesCannotBeBoarded() {
        val regional =
            graph(
                listOf(0 to 0, 1 to 0, 2 to 1, 3 to 1, 2 to 2, 4 to 2),
                listOf(
                    Edge(0, 1, 80),
                    Edge(1, 0, 80),
                    Edge(1, 2, 221, 1),
                    Edge(2, 1, 221, 0),
                    Edge(2, 3, 100),
                    Edge(3, 2, 100),
                    Edge(2, 4, 30, 2),
                    Edge(4, 5, 30),
                ),
                intArrayOf(60, 90, RouteGraph.UNAVAILABLE_WAIT),
                formatVersion = RouteGraphCodec.REGIONAL_FORMAT_VERSION,
            )
        val search = RouteSearch(regional, TimeSlot.DEFAULT)
        val beforeWalk = requireNotNull(search.from(code(1)))
        assertEquals(RouteCost(221, 0), beforeWalk.fastest(code(2)))
        assertEquals(RouteCost(411, 0), beforeWalk.fastest(code(3)))
        assertNull(beforeWalk.display(code(3)))
        val firstService = requireNotNull(search.from(code(0)))
        assertEquals(RouteCost(361, 0), firstService.fastest(code(2)))
        assertEquals(RouteCost(551, 1), firstService.fastest(code(3)))
        assertNull(firstService.display(code(2)))
        assertNull(firstService.display(code(3)))
        assertEquals(
            RouteTrace(
                RouteCost(551, 1),
                listOf(
                    RouteTraceSegment(code(0), code(1), "L0"),
                    RouteTraceSegment(code(1), code(2), null),
                    RouteTraceSegment(code(2), code(3), "L1"),
                ),
            ),
            firstService.trace(code(3)),
        )
        assertEquals(RouteCost(140, 0), firstService.fastest(code(1)))
        assertNull(firstService.fastest(code(4)))
        assertNull(search.from(code(4)))
    }

    // 역: 0 A, 1 B, 2 C, 3 D, 4 E. 계통: 0 2호선, 1 4호선, 2 7호선, 3 5호선. 대기는 모두 60초.
    // 빠른 길: A 2호선 → B 4호선 → C 7호선 → D (환승 2, 940초). 환승 1: A 2호선 → E 5호선 → D (1040초, 100초 더).
    private val nodes = listOf(0 to 0, 1 to 0, 1 to 1, 2 to 1, 2 to 2, 3 to 2, 4 to 0, 4 to 3, 3 to 3)
    private val lines = listOf("2호선", "4호선", "7호선", "5호선")
    private val sample =
        graph(
            nodes,
            listOf(
                Edge(0, 1, 300),
                Edge(0, 6, 400),
                Edge(1, 2, 30, 1),
                Edge(2, 3, 200),
                Edge(3, 4, 30, 2),
                Edge(4, 5, 200),
                Edge(6, 7, 30, 3),
                Edge(7, 8, 490),
            ),
            intArrayOf(60, 60, 60, 60),
            lines,
        )
    private val tree = requireNotNull(RouteSearch(sample, TimeSlot.DEFAULT).from(code(0)))

    @Test
    fun fastestIsTheOdCellAndDisplayPrefersFewerTransfersWithinTwoMinutes() {
        assertEquals(RouteCost(940, 2), tree.fastest(code(3)))
        assertEquals(
            Route(
                1040,
                1,
                listOf(
                    RouteLeg("2호선", code(0), code(4), 60, 400),
                    RouteLeg("5호선", code(4), code(3), 90, 490),
                ),
            ),
            tree.display(code(3)),
        )
        // 여유가 100초보다 작으면 가장 빠른 길이다.
        val fastest = requireNotNull(tree.display(code(3), slackSeconds = 99))
        assertEquals(940, fastest.seconds)
        assertEquals(listOf("2호선", "4호선", "7호선"), fastest.legs.map { it.line })
        assertEquals(listOf(code(1), code(2)), fastest.legs.drop(1).map { it.fromCode })
        assertEquals(120, DISPLAY_ROUTE_SLACK_SECONDS)
    }

    @Test
    fun sameStationAndUnknownStationsHaveNoRoute() {
        assertEquals(RouteCost(0, 0), tree.fastest(code(0)))
        assertNull(tree.display(code(0)))
        assertNull(tree.fastest(code(40)))
        assertNull(tree.display("zzz"))
        assertNull(RouteSearch(sample, TimeSlot.DEFAULT).from(code(40)))
        // 거꾸로 가는 간선이 없으면 갈 수 없다.
        assertNull(RouteSearch(sample, TimeSlot.DEFAULT).from(code(3))?.fastest(code(0)))
    }

    @Test
    fun twoTransfersInARowAtOneStationAreShownAsOne() {
        // A 계통0 → B에서 계통1 승강장을 거쳐(타지 않음) 계통2로 → C. 직접 잇는 간선은 없다.
        val g =
            graph(
                listOf(0 to 0, 1 to 0, 1 to 1, 1 to 2, 2 to 2),
                listOf(Edge(0, 1, 100), Edge(1, 2, 10, 1), Edge(2, 3, 20, 2), Edge(3, 4, 100)),
                intArrayOf(50, 40, 30),
            )
        val route = requireNotNull(RouteSearch(g, TimeSlot.DEFAULT).from(code(0))?.display(code(2)))
        assertEquals(2, route.transfers)
        assertEquals(
            listOf(RouteLeg("L0", code(0), code(1), 50, 100), RouteLeg("L2", code(1), code(2), 10 + 40 + 20 + 30, 100)),
            route.legs,
        )
    }

    @Test
    fun usesTheWaitsOfTheRequestedSlot() {
        val slots = TimeSlot.ALL.map { intArrayOf(60, 60, 60, 60) }.toMutableList()
        val night = TimeSlot.ALL.indexOfFirst { it != TimeSlot.DEFAULT }
        slots[night] = intArrayOf(60, 600, 600, 60)
        val g =
            RouteGraph(
                1,
                sample.lines,
                intArrayOf(0, 1, 2, 3),
                IntArray(sample.nodeCount) { sample.codeValue(it) },
                IntArray(sample.nodeCount) { sample.service(it) },
                IntArray(sample.nodeCount + 1) {
                    if (it ==
                        sample.nodeCount
                    ) {
                        sample.edgeCount
                    } else {
                        sample.edgeStart(it)
                    }
                },
                IntArray(sample.edgeCount) { sample.edgeTarget(it) },
                IntArray(sample.edgeCount) { sample.edgeSeconds(it) },
                IntArray(sample.edgeCount) { sample.edgeWaitService(it) },
                slots,
            )
        // 4·7호선 대기가 길면 환승 1번 길이 가장 빠르다.
        val cost = RouteSearch(g, TimeSlot.ALL[night]).from(code(0))?.fastest(code(3))
        assertEquals(RouteCost(1040, 1), cost)
    }

    @Test
    fun matchesABruteForceReferenceOnRandomGraphs() {
        val random = Random(120)
        repeat(400) { iteration ->
            val stations = random.nextInt(2, 7)
            val services = random.nextInt(1, 4)
            val nodes =
                List(random.nextInt(stations, stations + 8)) { i ->
                    (
                        if (i <
                            stations
                        ) {
                            i
                        } else {
                            random.nextInt(stations)
                        }
                    ) to
                        random.nextInt(services)
                }
            val edges =
                List(random.nextInt(nodes.size, nodes.size * 3)) {
                    val from = random.nextInt(nodes.size)
                    // 갈아타는 간선은 같은 역의 다른 노드로만 간다(그래프 불변식).
                    val platforms = nodes.indices.filter { v -> v != from && nodes[v].first == nodes[from].first }
                    if (platforms.isEmpty() || random.nextBoolean()) {
                        Edge(from, random.nextInt(nodes.size), random.nextInt(1, 400))
                    } else {
                        Edge(from, platforms.random(random), random.nextInt(0, 120), random.nextInt(services))
                    }
                }.filter { it.from != it.to }
            val waits = IntArray(services) { random.nextInt(1, 200) }
            val g = graph(nodes, edges, waits)
            val reference = Reference(nodes, edges, waits)
            val search = RouteSearch(g, TimeSlot.DEFAULT)
            for (origin in 0 until stations) {
                val tree = requireNotNull(search.from(code(origin)))
                for (destination in (0 until stations).filter { it != origin }) {
                    val expected = reference.fastest(origin, destination)
                    val label = "iteration $iteration: $origin→$destination"
                    assertEquals(expected, tree.fastest(code(destination)), label)
                    assertEquals(reference.lexicographic(origin, destination), expected, label)
                    val slack = listOf(0, 60, 120, 300)[iteration % 4]
                    val route = tree.display(code(destination), slack)
                    if (expected == null) {
                        assertNull(route, label)
                    } else {
                        requireNotNull(route)
                        assertEquals(
                            reference.display(origin, destination, slack),
                            route.seconds to route.transfers,
                            label,
                        )
                        assertEquals(route.seconds, route.legs.sumOf { it.waitSeconds + it.rideSeconds }, label)
                        assertTrue(route.legs.all { it.rideSeconds > 0 }, label)
                        assertTrue(route.legs.zipWithNext().all { (a, b) -> a.toCode == b.fromCode }, label)
                        assertEquals(code(origin), route.legs.first().fromCode, label)
                        assertEquals(code(destination), route.legs.last().toCode, label)
                    }
                }
            }
            // 같은 입력이면 같은 경로(결정적).
            val again = RouteSearch(g, TimeSlot.DEFAULT).from(code(0))
            for (destination in 1 until stations) {
                assertEquals(search.from(code(0))?.display(code(destination)), again?.display(code(destination)))
            }
        }
    }
}

/** 가지치기·동률 규칙 없이 환승 수별로 정확히 계산하는 기준 구현(작은 그래프용). */
private class Reference(
    private val nodes: List<Pair<Int, Int>>,
    private val edges: List<Edge>,
    private val waits: IntArray,
) {
    private val inf = Long.MAX_VALUE / 4

    private fun seconds(edge: Edge): Long =
        edge.seconds.toLong() + if (edge.wait == RouteGraph.NO_WAIT) 0 else waits[edge.wait]

    /** 환승 k번 이하로 각 역까지 가장 빠른 시간(k = 0..노드 수). */
    private fun atMost(origin: Int): List<LongArray> {
        var exact =
            LongArray(nodes.size) { v ->
                if (nodes[v].first ==
                    origin
                ) {
                    waits[nodes[v].second].toLong()
                } else {
                    inf
                }
            }
        val result = mutableListOf<LongArray>()
        var running = LongArray(nodes.size) { inf }
        repeat(nodes.size + 1) {
            exact = rides(exact)
            running = LongArray(nodes.size) { v -> minOf(running[v], exact[v]) }
            result.add(running)
            val next = LongArray(nodes.size) { inf }
            edges.filter { edge -> edge.wait != RouteGraph.NO_WAIT && exact[edge.from] < inf }.forEach { edge ->
                next[edge.to] = minOf(next[edge.to], exact[edge.from] + seconds(edge))
            }
            exact = next
        }
        return result
    }

    private fun rides(start: LongArray): LongArray {
        val dist = start.copyOf()
        val done = BooleanArray(nodes.size)
        while (true) {
            val v = dist.indices.filter { !done[it] && dist[it] < inf }.minByOrNull { dist[it] } ?: return dist
            done[v] = true
            edges.filter { it.from == v && it.wait == RouteGraph.NO_WAIT }.forEach {
                dist[it.to] = minOf(dist[it.to], dist[v] + seconds(it))
            }
        }
    }

    private fun stationBests(
        origin: Int,
        destination: Int,
    ): List<Long> =
        atMost(origin).map { layer ->
            nodes.indices.filter { nodes[it].first == destination }.minOf { layer[it] }
        }

    fun fastest(
        origin: Int,
        destination: Int,
    ): RouteCost? {
        val bests = stationBests(origin, destination)
        val best = bests.last()
        return if (best >= inf) null else RouteCost(best.toInt(), bests.indexOfFirst { it == best })
    }

    fun display(
        origin: Int,
        destination: Int,
        slack: Int,
    ): Pair<Int, Int> {
        val bests = stationBests(origin, destination)
        val k = bests.indexOfFirst { it <= bests.last() + slack }
        return bests[k].toInt() to k
    }

    /** 파이프라인 Graph.kt와 같은 (시간, 환승) 사전순 다익스트라. */
    fun lexicographic(
        origin: Int,
        destination: Int,
    ): RouteCost? {
        val dist =
            Array(nodes.size) { v ->
                if (nodes[v].first ==
                    origin
                ) {
                    waits[nodes[v].second].toLong() to 0
                } else {
                    inf to 0
                }
            }
        val done = BooleanArray(nodes.size)
        val order = compareBy<Pair<Long, Int>>({ it.first }, { it.second })
        while (true) {
            val v =
                dist.indices.filter { !done[it] && dist[it].first < inf }.minWithOrNull {
                    a,
                    b,
                    ->
                    order.compare(dist[a], dist[b])
                }
                    ?: break
            done[v] = true
            edges.filter { it.from == v }.forEach {
                val next = dist[v].first + seconds(it) to dist[v].second + if (it.wait == RouteGraph.NO_WAIT) 0 else 1
                if (order.compare(next, dist[it.to]) < 0) dist[it.to] = next
            }
        }
        val best =
            nodes.indices
                .filter { nodes[it].first == destination }
                .map { dist[it] }
                .minWithOrNull(order)
        return best?.takeIf { it.first < inf }?.let { RouteCost(it.first.toInt(), it.second) }
    }
}
