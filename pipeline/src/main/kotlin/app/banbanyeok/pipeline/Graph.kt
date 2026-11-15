package app.banbanyeok.pipeline
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationStatus
import kotlinx.serialization.json.JsonObject
import java.util.PriorityQueue

internal data class Record(
    val id: String,
    val name: String,
    val line: String,
    val lat: Double,
    val lng: Double,
    val operator: String,
    val original: String,
    val lineId: String,
    val transferLines: Set<String>,
)

internal data class Edge(
    val to: Int,
    val seconds: Int,
    val changes: Int,
)

internal data class Cost(
    val seconds: Int,
    val changes: Int,
) : Comparable<Cost> {
    override fun compareTo(other: Cost): Int = compareValuesBy(this, other, Cost::seconds, Cost::changes)
}

internal val infinity = Cost(1_000_000, 1_000_000)

internal fun shortest(
    graph: List<List<Edge>>,
    seeds: Map<Int, Int>,
): List<Cost> {
    val result = MutableList(graph.size) { infinity }
    val queue = PriorityQueue<Pair<Int, Cost>>(compareBy { it.second })
    seeds.forEach { (node, wait) ->
        result[node] = Cost(wait, 0)
        queue.add(node to result[node])
    }
    while (queue.isNotEmpty()) {
        val (node, cost) = queue.remove()
        if (result[node] != cost) continue
        graph[node].forEach { edge ->
            val next = Cost(cost.seconds + edge.seconds, cost.changes + edge.changes)
            if (next < result[edge.to]) {
                result[edge.to] = next
                queue.add(edge.to to next)
            }
        }
    }
    return result
}

internal data class Network(
    val registry: Registry,
    val previous: Registry,
    val origins: List<Station>,
    val nodes: List<Pair<String, String>>,
    val graph: List<List<Edge>>,
    val waits: Map<String, Int>,
    val excluded: List<String>,
    val branchChecks: List<List<String>> = emptyList(),
    /** TAGO edge/headway/transfer evidence for data/config/tago-report.json. */
    val tagoReport: JsonObject? = null,
    /** Blocking data problems (unmatched TAGO pairs etc.); the validation gate fails when non-empty. */
    val issues: List<String> = emptyList(),
)

internal class NetworkBuilder(
    private val registry: Registry,
    input: PipelineInput,
) {
    private val previous = input.previous
    private val rules = input.rules
    private val records = input.records
    private val runtime = input.runtime
    private val transfers = input.transfers
    private val headways = input.headways
    private val tago = input.tago
    private val tagoCodes = tago?.let { TagoRegistry(records, rules, it).codes(registry.stations) }.orEmpty()
    private val tagoHeadways = tago?.let(::tagoServiceHeadways).orEmpty()
    private val issues = mutableListOf<String>()
    private val tagoEdges = mutableListOf<JsonObject>()
    private val tagoTransfers = mutableListOf<JsonObject>()
    val seoulRecords = records.filter { it.operator == "서울교통공사" && it.line in (1..8).map { n -> "${n}호선" } }

    private fun canonical(name: String) = rules.canonical(name)

    private fun station(
        line: String,
        name: String,
    ): Station {
        val lookupLine = rules.sourceLine(line, name)
        val match =
            seoulRecords
                .filter {
                    it.line == "${lookupLine}호선" && it.name ==
                        canonical(
                            name,
                        )
                }.distinctBy { it.id }
        require(match.size == 1) { "S3/S4 mapping ambiguous/missing: $line $name (${match.size})" }
        return registry.stations.single { it.status == StationStatus.ACTIVE && match.single().id in it.sources.values }
    }

    private fun service(
        line: String,
        name: String,
    ): String = rules.service(line, name)

    private val nodes = mutableListOf<Pair<String, String>>()

    init {
        runtime.forEach { row -> nodes.add(station(row[1], row[2]).code to service(row[1], row[2])) }
        rules.branchRoots().forEach { (service, line, root) -> nodes.add(station(line, root).code to service) }
        val line5Trunk = runtime.filter { it[1] == rules.trunkLine }.takeWhile { it[2] != rules.trunkEnd }
        // Both train services run on the common trunk, then diverge at 강동.
        line5Trunk.forEach { nodes.add(station(rules.trunkLine, it[2]).code to rules.trunkService) }
        tago?.let { nodes.addAll(tagoNodes(it, tagoCodes)) }
    }

    private val distinctNodes = nodes.distinct()

    private fun node(
        line: String,
        name: String,
        override: String? = null,
    ): Int =
        distinctNodes.indexOf(station(line, name).code to (override ?: service(line, name))).also {
            require(it >= 0) { "Missing graph node: $line $name" }
        }

    val graph = List(distinctNodes.size) { mutableListOf<Edge>() }

    private fun edge(
        from: Int,
        to: Int,
        seconds: Int,
        changes: Int = 0,
    ) {
        require(seconds > 0)
        graph[from].add(Edge(to, seconds, changes))
    }

    private val waits =
        distinctNodes.map { it.second }.distinct().associateWith {
            (tagoHeadways[it] ?: headways.getValue(it.take(1))) / 2
        }

    private val tagoServices = tago?.lines?.groups.orEmpty()

    private fun group(service: String): String = tagoServices[service] ?: service.take(1)

    private val nodesByCode = distinctNodes.indices.groupBy { distinctNodes[it].first }

    private fun rideEdges() {
        var previousRow: List<String>? = null
        runtime.forEach { row ->
            val seconds = duration(row[3]).let { if (it > 0) it + rules.s3DwellSeconds else 0 }
            if (seconds > 0) {
                val prev = requireNotNull(previousRow)
                require(prev[1] == row[1]) { "Unexpected line boundary" }
                val fromName = rules.predecessor(row[1], row[2], prev[2])
                val branch = service(row[1], row[2])
                val from = node(row[1], fromName, branch)
                val to = node(row[1], row[2])
                edge(from, to, seconds)
                if (rules.bidirectional(row[1], fromName, row[2])) edge(to, from, seconds)
            }
            previousRow = row
        }
    }

    private val trunkCopies =
        distinctNodes.indices
            .filter { distinctNodes[it].second == rules.trunkLine }
            .associateWith { index ->
                distinctNodes.indexOf(distinctNodes[index].first to rules.trunkService)
            }.filterValues { it >= 0 }

    private fun trunkEdges() {
        // Duplicate trunk running edges for Macheon trains: a branch-to-branch trip must reboard.
        trunkCopies.forEach { (from, copy) ->
            graph[from].filter { it.changes == 0 && it.to in trunkCopies }.forEach { ride ->
                edge(copy, trunkCopies.getValue(ride.to), ride.seconds)
            }
            // Same-direction branch trains share the platform; boarding another service pays waiting only.
            edge(from, copy, waits.getValue(rules.trunkService), 1)
            edge(copy, from, waits.getValue(rules.trunkLine), 1)
        }
    }

    private fun transferEdges() {
        transfers.forEach { row ->
            val line = row[1]
            val other = row[3].removeSuffix("호선")
            if (other !in headways) return@forEach
            val name = row[2]
            // 1호선 at 신도림/창동 etc is operated by Korail, outside this graph.
            if (!hasStation(line, name)) return@forEach
            if (!hasStation(other, name)) return@forEach
            val from = node(line, name)
            val to =
                if (line == other &&
                    line == "2"
                ) {
                    node(line, name, rules.branchAt(line, name))
                } else {
                    node(other, name)
                }
            edge(from, to, duration(row[5]) + waits.getValue(distinctNodes[to].second), 1)
            // S4 has only one record for same-line branch boarding; walking is assumed symmetric.
            if (line == other) edge(to, from, duration(row[5]) + waits.getValue(distinctNodes[from].second), 1)
        }
    }

    private fun completeTransfers() {
        // S4 line-5 walks apply to either service on the shared trunk.
        val suppliedWalks = graph.flatMapIndexed { from, edges -> edges.filter { it.changes > 0 }.map { from to it } }
        suppliedWalks.forEach { (from, transfer) ->
            if (from in trunkCopies &&
                transfer.to !in trunkCopies.values
            ) {
                edge(trunkCopies.getValue(from), transfer.to, transfer.seconds, transfer.changes)
            }
            if (transfer.to in trunkCopies &&
                from !in trunkCopies.values
            ) {
                edge(from, trunkCopies.getValue(transfer.to), transfer.seconds, transfer.changes)
            }
        }
        // Preserve supplied directional differences; only mirror when S4 omits the reverse direction.
        val walkingEdges = graph.flatMapIndexed { from, edges -> edges.filter { it.changes > 0 }.map { from to it } }
        walkingEdges.forEach { (from, transfer) ->
            if (graph[transfer.to].none { it.to == from && it.changes > 0 }) {
                val walking = transfer.seconds - waits.getValue(distinctNodes[transfer.to].second)
                edge(transfer.to, from, walking + waits.getValue(distinctNodes[from].second), transfer.changes)
            }
        }
    }

    fun build(): Network {
        rideEdges()
        trunkEdges()
        transferEdges()
        tago?.let {
            tagoRideEdges(it)
            groupTransfers(it)
        }
        completeTransfers()
        tago?.let {
            patternSwitches()
            defaultTransfers(it)
        }
        val included = distinctNodes.map { it.first }.toSet()
        val origins = registry.stations.filter { it.status == StationStatus.ACTIVE && it.code in included }
        val excluded =
            seoulRecords
                .filter { rec ->
                    origins.none { rec.id in it.sources.values }
                }.map { "${it.line}:${it.name}" }
        val report =
            tago?.let {
                obj(
                    "serviceHeadways" to JsonObject(tagoHeadways.mapValues { (_, v) -> jsonValue(v) }),
                    "edges" to tagoEdges,
                    "transfers" to tagoTransfers,
                    "s3Comparison" to tagoVersusS3(it, runtime, rules),
                )
            }
        return Network(
            registry,
            previous,
            origins,
            distinctNodes,
            graph,
            waits,
            excluded,
            rules.branchChecks,
            report,
            issues,
        )
    }

    private fun tagoNode(
        service: MetroService,
        id: String,
    ): Int = distinctNodes.indexOf(tagoCodes.getValue(id) to (service.joins[id] ?: service.id))

    private fun stationName(code: String) = registry.stations.first { it.code == code }.name

    private val headings = mutableMapOf<String, TagoHeading>()

    private fun tagoRideEdges(tago: TagoInput) {
        tago.lines.services.forEach { service ->
            service.stations.zipWithNext().forEach { (a, b) -> tagoRide(tago, service, a, b) }
        }
    }

    private fun tagoRide(
        tago: TagoInput,
        service: MetroService,
        a: String,
        b: String,
    ) {
        val from = tagoNode(service, a)
        val to = tagoNode(service, b)
        val copied = service.s3Line?.let { s3Copy(it, tagoCodes.getValue(a), tagoCodes.getValue(b)) }
        if (copied != null) {
            edge(from, to, copied.first)
            edge(to, from, copied.second)
            return
        }
        val heading = headings.getOrPut(service.id) { TagoHeading(tago, service, tagoCodes) }
        val (forward, reverse, rejected) = tagoRunTimes(heading, a, b)
        if (forward == null || reverse == null) {
            issues.add("TAGO run time unmatched: ${service.id} $a→$b")
        } else {
            edge(from, to, forward.seconds)
            edge(to, from, reverse.seconds)
        }
        tagoEdges.add(
            obj(
                "service" to service.id,
                "from" to "$a ${stationName(tagoCodes.getValue(a))}",
                "to" to "$b ${stationName(tagoCodes.getValue(b))}",
                "forward" to forward?.json,
                "reverse" to reverse?.json,
                "rejected" to rejected,
            ),
        )
    }

    /** S3 seconds of the existing service between two stations, both directions, if S3 has that ride. */
    private fun s3Copy(
        line: String,
        a: String,
        b: String,
    ): Pair<Int, Int>? {
        val from = distinctNodes.indexOf(a to line)
        val to = distinctNodes.indexOf(b to line)
        if (from < 0 || to < 0) return null
        val forward = graph[from].firstOrNull { it.to == to && it.changes == 0 }?.seconds
        val reverse = graph[to].firstOrNull { it.to == from && it.changes == 0 }?.seconds
        return if (forward != null && reverse != null) forward to reverse else null
    }

    private fun isTago(node: Int) = distinctNodes[node].second in tagoServices

    private fun groupNodes(
        code: String,
        group: String,
    ) = nodesByCode[code].orEmpty().filter { group(distinctNodes[it].second) == group }

    /** S4 walks also apply to every TAGO service node of the same line group at that station. */
    private fun groupTransfers(tago: TagoInput) {
        transfers.forEach { row ->
            val other =
                tago.lines.s4LineGroups[row[3]] ?: row[3].removeSuffix("호선").takeIf { it in headways }
            if (other == null || other == row[1] || !hasStation(row[1], row[2])) return@forEach
            val code = station(row[1], row[2]).code
            val sources = groupNodes(code, row[1])
            val targets = groupNodes(code, other)
            if (sources.isEmpty() || targets.isEmpty()) {
                tagoTransfers.add(obj("station" to row[2], "from" to row[1], "to" to other, "status" to "no nodes"))
                return@forEach
            }
            sources.forEach { from ->
                targets.filter { isTago(from) || isTago(it) }.forEach { to ->
                    edge(from, to, duration(row[5]) + waits.getValue(distinctNodes[to].second), 1)
                }
            }
        }
    }

    /** Same-group TAGO services stopping at one station share the platform: wait for the other train only. */
    private fun patternSwitches() {
        nodesByCode.values.forEach { indexes ->
            indexes.forEach { from ->
                indexes
                    .filter { to ->
                        to != from && group(distinctNodes[to].second) == group(distinctNodes[from].second) &&
                            (isTago(from) || isTago(to))
                    }.forEach { to -> edge(from, to, waits.getValue(distinctNodes[to].second), 1) }
            }
        }
    }

    /** Rule-based (or sourced override) walk for line groups that meet at one physical station without S4. */
    private val usedOverrides = mutableSetOf<Pair<String, Set<String>>>()

    private fun defaultTransfers(tago: TagoInput) {
        nodesByCode.forEach { (code, indexes) ->
            val groups = indexes.map { group(distinctNodes[it].second) }.distinct().sorted()
            groups.forEachIndexed { i, a ->
                groups.drop(i + 1).forEach { b -> defaultTransfer(tago, code, a, b) }
            }
        }
        // A sourced override that never applies is a stale config entry (renamed station, S4 now covers it, ...).
        (tago.lines.transferOverrides.keys - usedOverrides).forEach { issues.add("Unused transfer override: $it") }
    }

    private fun defaultTransfer(
        tago: TagoInput,
        code: String,
        a: String,
        b: String,
    ) {
        val left = groupNodes(code, a)
        val right = groupNodes(code, b)
        val linked =
            left.any { x -> graph[x].any { it.changes > 0 && it.to in right } } ||
                right.any { y -> graph[y].any { it.changes > 0 && it.to in left } }
        if (linked || (left + right).none(::isTago)) return
        val override = tago.lines.transferOverrides[stationName(code) to setOf(a, b)]
        if (override != null) usedOverrides.add(stationName(code) to setOf(a, b))
        val walk = override ?: tago.lines.walkSeconds(a, b)
        val pairs = left.flatMap { x -> right.map { y -> x to y } }
        pairs.forEach { (x, y) ->
            edge(x, y, walk + waits.getValue(distinctNodes[y].second), 1)
            edge(y, x, walk + waits.getValue(distinctNodes[x].second), 1)
        }
        tagoTransfers.add(
            obj(
                "station" to stationName(code),
                "from" to a,
                "to" to b,
                "walkSeconds" to walk,
                "status" to if (override == null) "default" else "sourced",
            ),
        )
    }

    private fun hasStation(
        line: String,
        name: String,
    ): Boolean =
        rules.sourceLine(line, name) != line ||
            seoulRecords.any { it.line == "${line}호선" && it.name == canonical(name) }
}
