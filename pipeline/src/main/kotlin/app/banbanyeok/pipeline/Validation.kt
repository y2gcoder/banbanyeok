package app.banbanyeok.pipeline

import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.RegistryCodec
import app.banbanyeok.schema.RegistryCompatibility
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.math.abs

internal fun distribution(values: List<Int>): String {
    val sorted = values.sorted()

    fun percentile(percent: Int): Int = if (sorted.isEmpty()) 0 else sorted[(sorted.size - 1) * percent / 100]
    return """{"count":${values.size},"min":${sorted.firstOrNull() ?: 0},"p50":${percentile(50)},"p95":${percentile(95)},"max":${sorted.lastOrNull() ?: 0}}"""
}

internal fun stateTriangles(distances: List<List<Cost>>): Int {
    var violations = 0
    for (a in distances.indices) {
        for (b in distances.indices) {
            for (c in distances.indices) {
                val ab = distances[a][b]
                val bc = distances[b][c]
                val ac = distances[a][c]
                if (ab != infinity && bc != infinity && ac > Cost(ab.seconds + bc.seconds, ab.changes + bc.changes)) violations++
            }
        }
    }
    return violations
}

/** Largest minimum transfer cost between any two platforms at a physical station.
 * Only within-station walking+waiting edges are allowed; train trips cannot hide missing transfers.
 */
internal fun physicalTriangleBounds(net: Network): List<Int> =
    net.origins.map { station ->
        val platforms = net.nodes.indices.filter { net.nodes[it].first == station.code }
        val transferGraph =
            net.graph.mapIndexed { from, edges ->
                edges.filter { it.changes > 0 && net.nodes[it.to].first == net.nodes[from].first }
            }
        val maxTransfer =
            platforms.maxOf { from ->
                val distance = shortest(transferGraph, mapOf(from to 0))
                platforms.maxOf { to -> distance[to].seconds }
            }
        require(maxTransfer < infinity.seconds) { "Missing transfer connection within ${station.name}" }
        maxTransfer - platforms.minOf { net.waits.getValue(net.nodes[it].second) }
    }

internal data class Gate(
    val passed: Boolean,
    val json: String,
)

internal fun graphGate(
    net: Network,
    costs: List<List<Cost>>,
): Gate {
    val states = net.nodes.indices.map { shortest(net.graph, mapOf(it to 0)) }
    val stateViolations = stateTriangles(states)
    val bounds = physicalTriangleBounds(net)
    val sizes = mutableListOf<Int>()
    val symmetry = mutableListOf<Int>()
    val examples = mutableListOf<String>()
    var boundViolations = 0
    var abnormal = 0
    for (a in costs.indices) {
        for (c in costs.indices) {
            val seconds = costs[a][c].seconds
            if (a != c && (seconds <= 0 || seconds > 14400)) abnormal++
            if (a == c && costs[a][c] != Cost(0, 0)) abnormal++
            if (a < c) symmetry.add(abs(seconds - costs[c][a].seconds))
            for (b in costs.indices) {
                val excess = seconds - costs[a][b].seconds - costs[b][c].seconds
                if (excess > 0) {
                    sizes.add(excess)
                    if (excess > bounds[b]) boundViolations++
                    if (examples.size < 5) examples.add("${net.origins[a].name} -> ${net.origins[c].name} via ${net.origins[b].name}: excess=$excess, bound=${bounds[b]}")
                }
            }
        }
    }
    val branchOrigins = listOf("강동", "마천", "하남검단산").map { name -> net.origins.indexOfFirst { it.name == name } }
    val branchValid =
        if (branchOrigins.any { it < 0 }) {
            true
        } else {
            val (junction, macheon, hanam) = branchOrigins
            costs[macheon][hanam].changes >= 1 && costs[hanam][macheon].changes >= 1 && costs[junction][macheon].changes == 0
        }
    return Gate(
        stateViolations == 0 && boundViolations == 0 && abnormal == 0 && branchValid,
        """"branchServiceCheck":$branchValid,"stateTriangleViolations":$stateViolations,"physicalTriangleExcessSeconds":${distribution(sizes)},"physicalTriangleBoundViolations":$boundViolations,"triangleExamples":${strings(examples)},"abnormal":$abnormal,"symmetrySeconds":${distribution(symmetry)},"symmetryNonzero":${symmetry.count { it > 0 }}""",
    )
}

/** HEAD is the committed baseline; the local registry is also checked during generation. */
internal fun baselineViolations(
    root: Path,
    next: Registry,
): List<String> {
    val process = ProcessBuilder("git", "show", "HEAD:data/registry/stations.json").directory(root.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD).start()
    val text = process.inputStream.bufferedReader().readText()
    require(process.waitFor() == 0) { "Cannot read committed registry baseline" }
    return RegistryCompatibility.checkAppendOnly(RegistryCodec.parse(text), next)
}
