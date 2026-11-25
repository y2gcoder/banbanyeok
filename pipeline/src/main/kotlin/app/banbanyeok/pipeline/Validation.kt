package app.banbanyeok.pipeline

import kotlin.math.abs

internal fun distribution(values: List<Int>): kotlinx.serialization.json.JsonObject = distribution(values.toIntArray())

internal fun distribution(values: IntArray): kotlinx.serialization.json.JsonObject {
    val sorted = values.sorted()

    fun percentile(percent: Int): Int = if (sorted.isEmpty()) 0 else sorted[(sorted.size - 1) * percent / 100]
    return obj(
        "count" to values.size,
        "min" to (sorted.firstOrNull() ?: 0),
        "p50" to percentile(50),
        "p95" to percentile(95),
        "max" to (sorted.lastOrNull() ?: 0),
    )
}

internal fun stateTriangles(distances: List<List<Cost>>): Int {
    val n = distances.size
    val seconds = Array(n) { a -> IntArray(n) { distances[a][it].seconds } }
    val changes = Array(n) { a -> IntArray(n) { distances[a][it].changes } }
    return (0 until n).sumOf { a ->
        (0 until n).sumOf { b -> triangleViolationsVia(seconds, changes, a, b) }
    }
}

/** Lexicographic (seconds, changes) violations of d(a,c) ≤ d(a,b) + d(b,c) for every c. */
private fun triangleViolationsVia(
    seconds: Array<IntArray>,
    changes: Array<IntArray>,
    a: Int,
    b: Int,
): Int {
    val ab = seconds[a][b]
    if (ab >= infinity.seconds) return 0
    val abChanges = changes[a][b]
    val bc = seconds[b]
    val bcChanges = changes[b]
    val ac = seconds[a]
    val acChanges = changes[a]
    var violations = 0
    for (c in bc.indices) {
        if (bc[c] >= infinity.seconds) continue
        val via = ab + bc[c]
        val worse = ac[c] > via || (ac[c] == via && acChanges[c] > abChanges + bcChanges[c])
        if (worse) violations++
    }
    return violations
}

/** Largest minimum transfer cost between any two platforms at a physical station.
 * Only within-station walking+waiting edges are allowed; train trips cannot hide missing transfers.
 */
internal fun physicalTriangleBounds(net: Network): List<Int> {
    val transferGraph =
        net.graph.mapIndexed { from, edges ->
            edges.filter { it.changes > 0 && net.nodes[it.to].first == net.nodes[from].first }
        }
    val byCode = net.nodes.indices.groupBy { net.nodes[it].first }
    return net.origins.map { station ->
        val platforms = byCode.getValue(station.code)
        val maxTransfer =
            platforms.maxOf { from ->
                val distance = shortest(transferGraph, mapOf(from to 0))
                platforms.maxOf { to -> distance[to].seconds }
            }
        require(maxTransfer < infinity.seconds) { "Missing transfer connection within ${station.name}" }
        maxTransfer - platforms.minOf { net.waits.getValue(net.nodes[it].second) }
    }
}

internal data class Gate(
    val passed: Boolean,
    val json: kotlinx.serialization.json.JsonObject,
)

/** Physical-OD triangle excesses d(A,C) − d(A,B) − d(B,C) > 0, checked against B's skipped-transfer bound. */
private class PhysicalExcess(
    private val net: Network,
    private val bounds: List<Int>,
) {
    private var sizes = IntArray(1024)
    private var count = 0
    var violations = 0
        private set
    val examples = mutableListOf<String>()

    fun add(
        a: Int,
        b: Int,
        c: Int,
        excess: Int,
    ) {
        if (count == sizes.size) sizes = sizes.copyOf(sizes.size * 2)
        sizes[count++] = excess
        if (excess > bounds[b]) violations++
        if (examples.size < 5) {
            examples.add(
                "${net.origins[a].name} -> ${net.origins[c].name} via " +
                    "${net.origins[b].name}: excess=$excess, bound=${bounds[b]}",
            )
        }
    }

    fun distribution() = distribution(sizes.copyOf(count))

    fun scan(
        plain: Array<IntArray>,
        a: Int,
        c: Int,
    ) {
        for (b in plain.indices) {
            val over = plain[a][c] - plain[a][b] - plain[b][c]
            if (over > 0) add(a, b, c, over)
        }
    }
}

internal fun graphGate(
    net: Network,
    costs: List<List<Cost>>,
): Gate {
    net.requireKnownWaits()
    val states = net.nodes.indices.map { shortest(net.graph, mapOf(it to 0)) }
    val stateViolations = stateTriangles(states)
    val excess = PhysicalExcess(net, physicalTriangleBounds(net))
    val symmetry = mutableListOf<Int>()
    val plain = Array(costs.size) { a -> IntArray(costs.size) { costs[a][it].seconds } }
    var abnormal = 0
    for (a in costs.indices) {
        for (c in costs.indices) {
            if (!normalCell(costs, a, c)) abnormal++
            if (a < c) symmetry.add(abs(costs[a][c].seconds - costs[c][a].seconds))
            excess.scan(plain, a, c)
        }
    }
    val branchValid = branchValid(net, costs)
    return Gate(
        stateViolations == 0 && excess.violations == 0 && abnormal == 0 && branchValid && net.issues.isEmpty(),
        obj(
            "dataIssues" to net.issues,
            "branchServiceCheck" to branchValid,
            "stateTriangleViolations" to stateViolations,
            "physicalTriangleExcessSeconds" to excess.distribution(),
            "physicalTriangleBoundViolations" to excess.violations,
            "triangleExamples" to excess.examples,
            "abnormal" to abnormal,
            "symmetrySeconds" to distribution(symmetry),
            "symmetryNonzero" to symmetry.count { it > 0 },
        ),
    )
}

/** 6 h: 수도권 끝과 끝(춘천↔신창 약 4시간 20분)을 넘는 값은 그래프 오류로 본다. P2(1~8호선)는 4 h였다. */
private const val MAX_OD_SECONDS = 21_600

private fun normalCell(
    costs: List<List<Cost>>,
    a: Int,
    c: Int,
): Boolean = if (a == c) costs[a][c] == Cost(0, 0) else costs[a][c].seconds in 1..MAX_OD_SECONDS

private fun branchValid(
    net: Network,
    costs: List<List<Cost>>,
): Boolean =
    net.branchChecks.all { names ->
        require(names.size == 3) { "Branch check needs junction, branch and main stations" }
        val indexes = names.map { name -> originIndex(net, name) }
        val (junction, branch, main) = indexes
        costs[branch][main].changes >= 1 && costs[main][branch].changes >= 1 && costs[junction][branch].changes == 0
    }
