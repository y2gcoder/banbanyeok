package app.banbanyeok.pipeline

import app.banbanyeok.core.DISPLAY_ROUTE_SLACK_SECONDS
import app.banbanyeok.core.Route
import app.banbanyeok.core.RouteCost
import app.banbanyeok.core.RouteSearch
import app.banbanyeok.core.RouteTree
import app.banbanyeok.schema.DataSet
import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.RouteGraph
import app.banbanyeok.schema.RouteGraphCodec
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.TimeSlot
import java.nio.file.Path
import kotlin.io.path.readBytes

/** Dev file name of the route graph (contracts/data-format.md §11). */
internal const val RG_FILE = "rg.bin"

/**
 * 화면 표시 노선 이름(#120). 웹의 노선 색표(web/src/lib/stations/lines.ts의 키)와 같은 말이어야 색이 칠해진다. 숫자 하나인 group은
 * "N호선"이다. 새 group이 생기면 여기에 더하지 않는 한 그래프를 만들지 않는다(모르는 이름을 짐작하지 않는다).
 */
private val GROUP_LINES =
    mapOf(
        "경의중앙" to "경의중앙선",
        "경춘" to "경춘선",
        "수인분당" to "수인분당선",
        "신분당" to "신분당선",
        "경강" to "경강선",
        "서해" to "서해선",
        "공항" to "공항철도",
        "인천1" to "인천1호선",
        "인천2" to "인천2호선",
        "에버라인" to "에버라인",
        "의정부" to "의정부경전철",
        "우이신설" to "우이신설선",
        "신림" to "신림선",
        "김포골드" to "김포골드라인",
        "GTX-A" to "GTX-A",
    )

internal fun displayLine(group: String): String =
    if (group.length == 1 && group[0].isDigit()) {
        "${group}호선"
    } else {
        requireNotNull(GROUP_LINES[group]) { "No display line name for service group '$group'" }
    }

/**
 * The od.bin network as a route graph: the default slot's nodes and edges with waits taken out of the transfer
 * edges, and every slot's boarding waits. Slots differ only in waits ([withWaits]); this checks it while building.
 */
internal fun routeGraph(
    slots: Map<TimeSlot, Network>,
    groupOf: (String) -> String,
): RouteGraph {
    val net = slots.getValue(TimeSlot.DEFAULT)
    val services = net.waits.keys.sorted()
    val serviceIndex = services.withIndex().associate { it.value to it.index }
    val serviceLine = services.map { displayLine(groupOf(it)) }
    val lines = serviceLine.distinct().sorted()
    val starts = IntArray(net.nodes.size + 1)
    val targets = mutableListOf<Int>()
    val times = mutableListOf<Int>()
    val waits = mutableListOf<Int>()
    net.graph.forEachIndexed { v, edges ->
        starts[v] = targets.size
        edges.forEach { edge ->
            require(edge.changes == if (edge.wait == null) 0 else 1) { "Edge changes must be 1 exactly on waits" }
            targets.add(edge.to)
            times.add(edge.wait?.let { edge.seconds - net.waits.getValue(it) } ?: edge.seconds)
            waits.add(edge.wait?.let(serviceIndex::getValue) ?: RouteGraph.NO_WAIT)
        }
    }
    starts[net.nodes.size] = targets.size
    slots.forEach { (slot, slotNet) ->
        require(slotNet.nodes == net.nodes) { "Slot $slot has other nodes" }
        slotNet.graph.forEachIndexed { v, edges ->
            edges.forEachIndexed { i, edge ->
                val e = starts[v] + i
                val wait = edge.wait?.let(slotNet.waits::getValue) ?: 0
                require(edge.to == targets[e] && edge.seconds == times[e] + wait) { "Slot $slot differs beyond waits" }
            }
        }
    }
    return RouteGraph(
        net.registry.registryVersion,
        lines,
        serviceLine.map(lines::indexOf).toIntArray(),
        net.nodes.map { StationCode.parse(it.first).value }.toIntArray(),
        net.nodes.map { serviceIndex.getValue(it.second) }.toIntArray(),
        starts,
        targets.toIntArray(),
        times.toIntArray(),
        waits.toIntArray(),
        TimeSlot.ALL.map { slot ->
            val slotWaits = slots.getValue(slot).waits
            IntArray(services.size) { slotWaits.getValue(services[it]) }
        },
    )
}

/** The route graph of the current raw sources. */
internal fun routeGraph(context: StageContext): RouteGraph {
    val groups =
        context.input.tago
            ?.lines
            ?.groups
            .orEmpty()
    return routeGraph(context.slots) { service -> groups[service] ?: service.take(1) }
}

/** What the route gate found; [problems] must be empty to publish. */
internal class RouteGateResult {
    var cells = 0L
        private set
    val problems = mutableListOf<String>()

    /** Cells whose display route is not the fastest one (fewer transfers within the slack). */
    var displayDiffers = 0L
        private set

    /** Display routes with two transfers in a row at one station, shown as one (legs < transfers + 1). */
    var mergedTransfers = 0L
        private set
    var maxTransfers = 0
        private set

    val passed: Boolean get() = problems.isEmpty()

    fun problem(text: String) {
        if (problems.size < MAX_REPORTED) {
            problems.add(text)
        } else if (problems.size == MAX_REPORTED) {
            problems.add("…")
        }
    }

    /** One cell: the fastest (seconds, transfers) must be the od cell and the display route must keep its rules. */
    fun cell(
        label: String,
        tree: RouteTree,
        origin: String,
        destination: String,
        od: RouteCost,
    ) {
        cells++
        val fastest = tree.fastest(destination)
        if (fastest != od) return problem("$label: graph $fastest, od $od")
        maxTransfers = maxOf(maxTransfers, od.transfers)
        val route = tree.display(destination)
        when {
            origin == destination -> {
                if (route != null) problem("$label: route to itself")
            }

            route == null -> {
                problem("$label: no display route")
            }

            !route.keepsTheRules(origin, destination, od) -> {
                problem("$label: invalid display route $route")
            }

            else -> {
                if (route.seconds != od.seconds || route.transfers != od.transfers) displayDiffers++
                if (route.legs.size < route.transfers + 1) mergedTransfers++
            }
        }
    }

    override fun toString(): String =
        "route gate: $cells cells, ${problems.size} problems, display≠fastest $displayDiffers, " +
            "merged transfers $mergedTransfers, max transfers $maxTransfers"
}

/** Within the slack of [fastest], no more transfers, legs that ride and link origin to destination, times that add up. */
private fun Route.keepsTheRules(
    origin: String,
    destination: String,
    fastest: RouteCost,
): Boolean =
    seconds in fastest.seconds..fastest.seconds + DISPLAY_ROUTE_SLACK_SECONDS &&
        transfers <= fastest.transfers &&
        legs.size <= transfers + 1 &&
        legs.all { it.rideSeconds > 0 } &&
        legs.zipWithNext().all { (a, b) -> a.toCode == b.fromCode } &&
        legs.first().fromCode == origin &&
        legs.last().toCode == destination &&
        legs.sumOf { it.waitSeconds + it.rideSeconds } == seconds

/**
 * 발행 게이트(#120): 산출물 그래프로 shared:core의 [RouteSearch]가 다시 계산한 시간·환승 수가 **모든 구분·모든 칸**에서 od 행렬과 같아야
 * 한다. 서버가 같은 그래프·같은 코드로 경로를 만들므로, 이 게이트를 통과하면 화면의 경로가 od의 시간과 어긋나지 않는다. 표시 경로도
 * 규칙(시간 ≤ 최단 + 여유, 환승 ≤ 최단의 환승, 구간이 출발역에서 도착역까지 이어짐)을 지키는지 본다.
 */
internal fun routeGate(
    graph: RouteGraph,
    ods: Map<TimeSlot, OdMatrix>,
): RouteGateResult {
    val result = RouteGateResult()
    TimeSlot.ALL.forEach { slot ->
        val od = ods[slot] ?: return@forEach result.problem("$slot: no od matrix")
        val search = RouteSearch(graph, slot)
        for (i in 0 until od.originCount) {
            val origin = od.originCode(i).toString()
            val tree = search.from(origin) ?: return@forEach result.problem("$slot: origin $origin not in graph")
            for (j in 0 until od.candidateCount) {
                val destination = od.candidateCode(j).toString()
                val cost = RouteCost(od.timeSeconds(i, j), od.transfers(i, j))
                result.cell("$slot $origin→$destination", tree, origin, destination, cost)
            }
        }
    }
    return result
}

private const val MAX_REPORTED = 20

/**
 * The route graph (rg.bin). Built after the travel matrices, which it is checked against: the gate recomputes every
 * slot and cell from the encoded bytes with the shared route search.
 */
internal object RouteGraphStage : ArtifactStage {
    override val name = "route-graph"

    override fun build(
        context: StageContext,
        parts: ReleaseParts,
    ) {
        val started = System.nanoTime()
        val bytes = RouteGraphCodec.encode(routeGraph(context))
        val graph = RouteGraphCodec.decode(bytes)
        val gate = routeGate(graph, odMatrices(context.net, parts))
        println("Route graph ${bytes.size} bytes; $gate; ${(System.nanoTime() - started) / 1_000_000} ms")
        require(gate.passed) { "Route gate failed; no artifacts written:\n" + gate.problems.joinToString("\n") }
        parts.routeGraph = bytes
    }

    override fun validate(
        context: StageContext,
        dataset: DataSet,
    ) {
        val file = requireNotNull(dataset.manifest.files.routeGraph) { "Artifact has no route graph" }
        val dev =
            context.root
                .resolve("data/artifacts/dev")
                .resolve(file.path)
                .readBytes()
        require(RouteGraphCodec.encode(routeGraph(context)).contentEquals(dev)) {
            "Artifact route graph differs from current graph; rebuild required"
        }
        val graph = DataSetLoader.routeGraph(dataset, dev)
        val gate = routeGate(graph, TimeSlot.ALL.associateWith { requireNotNull(dataset.odFor(it)) })
        require(gate.passed) { "Route gate failed:\n" + gate.problems.joinToString("\n") }
    }
}

/** The dev artifact set's route graph, validated against [dataSet] (null for data before generation 4). */
internal fun loadDevRouteGraph(
    output: Path,
    dataSet: DataSet,
): RouteGraph? =
    dataSet.manifest.files.routeGraph
        ?.let { DataSetLoader.routeGraph(dataSet, output.resolve(it.path).readBytes()) }
