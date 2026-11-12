package app.banbanyeok.pipeline

import app.banbanyeok.schema.*
import java.nio.file.Path
import java.security.SecureRandom
import java.util.PriorityQueue
import kotlin.io.path.*
import kotlin.math.*

internal fun canonical(name: String): String = when (val base = name.substringBefore('(').trim().removeSuffix("역")) {
    "서울", "서울역" -> "서울역"
    "당고개" -> "불암산"
    "총신대입구", "이수" -> "총신대입구(이수)"
    "신내역" -> "신내"
    "고속터미널" -> "고속터미널"
    else -> base
}
internal data class Record(val id: String, val name: String, val line: String, val lat: Double, val lng: Double, val operator: String, val original: String, val lineId: String, val transferLines: Set<String>)
internal data class Edge(val to: Int, val seconds: Int, val changes: Int)
internal data class Cost(val seconds: Int, val changes: Int) : Comparable<Cost> {
    override fun compareTo(other: Cost): Int = compareValuesBy(this, other, Cost::seconds, Cost::changes)
}
internal val infinity = Cost(1_000_000, 1_000_000)
internal fun shortest(graph: List<List<Edge>>, seeds: Map<Int, Int>): List<Cost> {
    val result = MutableList(graph.size) { infinity }
    val queue = PriorityQueue<Pair<Int, Cost>>(compareBy { it.second })
    seeds.forEach { (node, wait) -> result[node] = Cost(wait, 0); queue.add(node to result[node]) }
    while (queue.isNotEmpty()) {
        val (node, cost) = queue.remove()
        if (result[node] != cost) continue
        graph[node].forEach { edge ->
            val next = Cost(cost.seconds + edge.seconds, cost.changes + edge.changes)
            if (next < result[edge.to]) { result[edge.to] = next; queue.add(edge.to to next) }
        }
    }
    return result
}
internal fun predecessor(line: String, name: String, previous: String): String = when (line to name) {
    "2" to "용답" -> "성수"
    "2" to "도림천" -> "신도림"
    "5" to "둔촌동" -> "강동"
    else -> previous
}
internal fun bidirectional(line: String, from: String, to: String): Boolean =
    !(line == "6" && from in setOf("응암", "역촌", "불광", "독바위", "연신내", "구산") && to in setOf("응암", "역촌", "불광", "독바위", "연신내", "구산"))

internal data class Network(val registry: Registry, val previous: Registry, val origins: List<Station>, val nodes: List<Pair<String, String>>, val graph: List<List<Edge>>, val waits: Map<String, Int>, val excluded: List<String>)
internal fun network(root: Path): Network {
    verifyRaw(root)
    val previous = RegistryCodec.parse(root.resolve("data/registry/stations.json").readText())
    val raw = root.resolve("data/raw")
    val records = xlsx(raw.resolve("kric.xlsx").readBytes()).drop(1).map { row ->
        Record("${row[11]}:${row[2]}:${row[0]}", canonical(row[1]), row[3], row[9].toDouble(), row[10].toDouble(), row[11], row[1], row[2], row[7].split('+').toSet())
    }
    val stations = previous.stations.toMutableList()
    val random = SecureRandom()
    val used = stations.mapTo(mutableSetOf()) { it.code }
    val newVersion = previous.registryVersion + 1
    records.forEach { record ->
        val sourceKey = "kric:${record.operator}:${record.line}"
        val bySource = stations.indexOfFirst { it.status == StationStatus.ACTIVE && it.sources[sourceKey] == record.id }
        // A normalized name is only a candidate: coordinates AND operator/line source identity are checked.
        val byLocation = stations.indexOfFirst {
            it.status == StationStatus.ACTIVE && canonical(it.name) == record.name && hypot((it.lat - record.lat) * 111.0, (it.lng - record.lng) * 88.0) < 0.85 &&
                it.sources[sourceKey].let { existing -> existing == null || existing == record.id } &&
                records.any { existing -> existing.id in it.sources.values && (record.lineId in existing.transferLines || existing.lineId in record.transferLines || existing.id == record.id) }
        }
        val index = if (bySource >= 0) bySource else byLocation
        if (index >= 0) {
            val old = stations[index]
            stations[index] = old.copy(name = record.name, lines = (old.lines + record.line).distinct().sorted(), sources = old.sources + (sourceKey to record.id), aliases = (old.aliases + old.name + record.original).filter { it != record.name }.distinct().sorted())
        } else {
            var code: String
            do { code = StationCode.ofValue(random.nextInt(StationCode.CAPACITY)).toString() } while (!used.add(code))
            stations.add(Station(code, record.name, StationStatus.ACTIVE, record.lat, record.lng, listOf(record.line), listOf(record.original).filter { it != record.name }, mapOf(sourceKey to record.id), newVersion))
        }
    }
    // Consolidate older draft records when source transfer IDs, names and coordinates agree.
    // Retire the other code instead of reusing/deleting it, preserving links from earlier drafts.
    for (i in stations.indices) {
        if (stations[i].status != StationStatus.ACTIVE) continue
        for (j in i + 1 until stations.size) {
            val a = stations[i]; val b = stations[j]
            if (b.status != StationStatus.ACTIVE || canonical(a.name) != canonical(b.name)) continue
            if (hypot((a.lat - b.lat) * 111.0, (a.lng - b.lng) * 88.0) >= 0.85) continue
            val ar = records.filter { it.id in a.sources.values }; val br = records.filter { it.id in b.sources.values }
            if (ar.none { x -> br.any { y -> x.lineId in y.transferLines || y.lineId in x.transferLines } }) continue
            stations[i] = a.copy(lines = (a.lines + b.lines).distinct().sorted(), aliases = (a.aliases + b.aliases + b.name).filter { it != a.name }.distinct().sorted(), sources = a.sources + b.sources)
            stations[j] = b.copy(status = StationStatus.DEPRECATED, deprecatedIn = newVersion, replacedBy = a.code)
        }
    }
    // S1 lists 까치산 only under line 5; S3/S4 explicitly identify its line 2 branch.
    val kachi = stations.indexOfFirst { it.name == "까치산" && "5호선" in it.lines && it.sources.keys.any { key -> key.startsWith("kric:서울교통공사:") } }
    require(kachi >= 0)
    stations[kachi] = stations[kachi].copy(lines = (stations[kachi].lines + "2호선").distinct().sorted(), sources = stations[kachi].sources + ("seoul:S3:2" to "까치산"))
    val sorted = stations.sortedBy { it.code }
    val registry = Registry(1, if (sorted == previous.stations) previous.registryVersion else newVersion, sorted)
    RegistryCodec.validate(registry)
    require(RegistryCompatibility.checkAppendOnly(previous, registry).isEmpty()) { "Registry append-only violation" }
    val runtime = csvBytes(raw.resolve("runtime.csv").readBytes()).drop(1)
    val seoulRecords = records.filter { it.operator == "서울교통공사" && it.line in (1..8).map { n -> "${n}호선" } }
    fun station(line: String, name: String): Station {
        val lookupLine = if (line == "2" && name == "까치산") "5" else line
        val match = seoulRecords.filter { it.line == "${lookupLine}호선" && it.name == canonical(name) }.distinctBy { it.id }
        require(match.size == 1) { "S3/S4 mapping ambiguous/missing: $line $name (${match.size})" }
        return registry.stations.single { it.status == StationStatus.ACTIVE && match.single().id in it.sources.values }
    }
    val macheonNames = setOf("둔촌동", "올림픽공원", "방이", "오금", "개롱", "거여", "마천")
    fun service(line: String, name: String): String = when {
        line == "5" && canonical(name) in macheonNames -> "5마천계통"
        line == "2" && canonical(name) in setOf("용답", "신답", "용두", "신설동") -> "2성수지선"
        line == "2" && canonical(name) in setOf("도림천", "양천구청", "신정네거리", "까치산") -> "2신정지선"
        else -> line
    }
    val nodes = mutableListOf<Pair<String, String>>()
    runtime.forEach { row -> nodes.add(station(row[1], row[2]).code to service(row[1], row[2])) }
    nodes.add(station("2", "성수").code to "2성수지선")
    nodes.add(station("2", "신도림").code to "2신정지선")
    val line5Trunk = runtime.filter { it[1] == "5" }.takeWhile { it[2] != "길동" }
    // Both train services run on the common trunk, then diverge at 강동.
    line5Trunk.forEach { nodes.add(station("5", it[2]).code to "5마천계통") }
    val distinctNodes = nodes.distinct()
    fun node(line: String, name: String, override: String? = null): Int = distinctNodes.indexOf(station(line, name).code to (override ?: service(line, name))).also { require(it >= 0) { "Missing graph node: $line $name" } }
    val graph = List(distinctNodes.size) { mutableListOf<Edge>() }
    fun edge(from: Int, to: Int, seconds: Int, changes: Int = 0) { require(seconds > 0); graph[from].add(Edge(to, seconds, changes)) }
    val config = root.resolve("data/config/headways.json").readText()
    val headways = Regex("\"([1-8])\"\\s*:\\s*\\{\\s*\"seconds\"\\s*:\\s*([0-9]+)").findAll(config).associate { it.groupValues[1] to it.groupValues[2].toInt() }
    require(headways.size == 8 && headways.values.all { it in 60..1800 }) { "Missing/invalid headways" }
    val waits = distinctNodes.map { it.second }.distinct().associateWith { headways.getValue(it.take(1)) / 2 }
    var previousRow: List<String>? = null
    runtime.forEach { row ->
        val seconds = duration(row[3])
        if (seconds > 0) {
            val prev = requireNotNull(previousRow)
            require(prev[1] == row[1]) { "Unexpected line boundary" }
            val fromName = predecessor(row[1], row[2], prev[2])
            val branch = service(row[1], row[2])
            val from = node(row[1], fromName, branch)
            val to = node(row[1], row[2])
            edge(from, to, seconds)
            if (bidirectional(row[1], fromName, row[2])) edge(to, from, seconds)
        }
        previousRow = row
    }
    // Duplicate trunk running edges for Macheon trains: a branch-to-branch trip must reboard.
    val trunkCopies = distinctNodes.indices.filter { distinctNodes[it].second == "5" }.associateWith { index ->
        distinctNodes.indexOf(distinctNodes[index].first to "5마천계통")
    }.filterValues { it >= 0 }
    trunkCopies.forEach { (from, copy) ->
        graph[from].filter { it.changes == 0 && it.to in trunkCopies }.forEach { ride ->
            edge(copy, trunkCopies.getValue(ride.to), ride.seconds)
        }
        // Same-direction branch trains share the platform; boarding another service pays waiting only.
        edge(from, copy, waits.getValue("5마천계통"), 1)
        edge(copy, from, waits.getValue("5"), 1)
    }
    val transfers = csvBytes(raw.resolve("transfer.csv").readBytes()).drop(1)
    transfers.forEach { row ->
        val line = row[1]; val other = row[3].removeSuffix("호선")
        if (other !in headways) return@forEach
        val name = row[2]
        // 1호선 at 신도림/창동 etc is operated by Korail, outside this graph.
        if ((line != "2" || name != "까치산") && seoulRecords.none { it.line == "${line}호선" && it.name == canonical(name) }) return@forEach
        if ((other != "2" || name != "까치산") && seoulRecords.none { it.line == "${other}호선" && it.name == canonical(name) }) return@forEach
        val from = node(line, name)
        val to = if (line == other && line == "2") node(line, name, if (name == "성수") "2성수지선" else "2신정지선") else node(other, name)
        edge(from, to, duration(row[5]) + waits.getValue(distinctNodes[to].second), 1)
        // S4 has only one record for same-line branch boarding; walking is assumed symmetric.
        if (line == other) edge(to, from, duration(row[5]) + waits.getValue(distinctNodes[from].second), 1)
    }
    // S4 line-5 walks apply to either service on the shared trunk.
    val suppliedWalks = graph.flatMapIndexed { from, edges -> edges.filter { it.changes > 0 }.map { from to it } }
    suppliedWalks.forEach { (from, transfer) ->
        if (from in trunkCopies && transfer.to !in trunkCopies.values) edge(trunkCopies.getValue(from), transfer.to, transfer.seconds, transfer.changes)
        if (transfer.to in trunkCopies && from !in trunkCopies.values) edge(from, trunkCopies.getValue(transfer.to), transfer.seconds, transfer.changes)
    }
    // Preserve supplied directional differences; only mirror when S4 omits the reverse direction.
    val walkingEdges = graph.flatMapIndexed { from, edges -> edges.filter { it.changes > 0 }.map { from to it } }
    walkingEdges.forEach { (from, transfer) ->
        if (graph[transfer.to].none { it.to == from && it.changes > 0 }) {
            val walking = transfer.seconds - waits.getValue(distinctNodes[transfer.to].second)
            edge(transfer.to, from, walking + waits.getValue(distinctNodes[from].second), transfer.changes)
        }
    }
    val included = distinctNodes.map { it.first }.toSet()
    val origins = registry.stations.filter { it.status == StationStatus.ACTIVE && it.code in included }
    val excluded = seoulRecords.filter { rec -> origins.none { rec.id in it.sources.values } }.map { "${it.line}:${it.name}" }
    return Network(registry, previous, origins, distinctNodes, graph, waits, excluded)
}
