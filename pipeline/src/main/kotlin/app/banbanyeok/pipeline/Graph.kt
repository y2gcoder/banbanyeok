package app.banbanyeok.pipeline
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationStatus
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
)

internal class NetworkBuilder(
    private val registry: Registry,
    private val input: PipelineInput,
) {
    private val previous = input.previous
    private val rules = input.rules
    private val records = input.records
    private val runtime = input.runtime
    private val transfers = input.transfers
    private val headways = input.headways
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
            headways.getValue(it.take(1)) / 2
        }

    private fun rideEdges() {
        var previousRow: List<String>? = null
        runtime.forEach { row ->
            val seconds = duration(row[3])
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
        completeTransfers()
        val included = distinctNodes.map { it.first }.toSet()
        val origins = registry.stations.filter { it.status == StationStatus.ACTIVE && it.code in included }
        val excluded =
            seoulRecords
                .filter { rec ->
                    origins.none { rec.id in it.sources.values }
                }.map { "${it.line}:${it.name}" }
        return Network(registry, previous, origins, distinctNodes, graph, waits, excluded, rules.branchChecks)
    }

    private fun hasStation(
        line: String,
        name: String,
    ): Boolean =
        rules.sourceLine(line, name) != line ||
            seoulRecords.any { it.line == "${line}호선" && it.name == canonical(name) }
}
