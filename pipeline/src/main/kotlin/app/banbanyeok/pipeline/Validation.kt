package app.banbanyeok.pipeline

import kotlin.math.abs

internal fun distribution(values: List<Int>): kotlinx.serialization.json.JsonObject {
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

internal fun stateTriangles(distances: List<List<Cost>>): Int =
    distances.indices.sumOf { a ->
        distances.indices.sumOf { b ->
            distances.indices.count { c -> violatesTriangle(distances[a][b], distances[b][c], distances[a][c]) }
        }
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
    val json: kotlinx.serialization.json.JsonObject,
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
            val excesses = physicalExcesses(costs, bounds, a, c)
            sizes.addAll(excesses.map { it.second })
            boundViolations += excesses.count { (b, excess) -> excess > bounds[b] }
            excesses.take((5 - examples.size).coerceAtLeast(0)).forEach { (b, excess) ->
                examples.add(
                    "${net.origins[a].name} -> ${net.origins[c].name} via " +
                        "${net.origins[b].name}: excess=$excess, bound=${bounds[b]}",
                )
            }
        }
    }
    val branchValid = branchValid(net, costs)
    return Gate(
        stateViolations == 0 && boundViolations == 0 && abnormal == 0 && branchValid,
        obj(
            "branchServiceCheck" to branchValid,
            "stateTriangleViolations" to stateViolations,
            "physicalTriangleExcessSeconds" to distribution(sizes),
            "physicalTriangleBoundViolations" to boundViolations,
            "triangleExamples" to examples,
            "abnormal" to abnormal,
            "symmetrySeconds" to distribution(symmetry),
            "symmetryNonzero" to symmetry.count { it > 0 },
        ),
    )
}

private fun violatesTriangle(
    ab: Cost,
    bc: Cost,
    ac: Cost,
): Boolean = ab != infinity && bc != infinity && ac > Cost(ab.seconds + bc.seconds, ab.changes + bc.changes)

private fun branchValid(
    net: Network,
    costs: List<List<Cost>>,
): Boolean =
    net.branchChecks.all { names ->
        val indexes = names.map { name -> net.origins.indexOfFirst { it.name == name } }
        require(indexes.size == 3 && indexes.all { it >= 0 }) { "Missing configured branch check station" }
        val (junction, branch, main) = indexes
        costs[branch][main].changes >= 1 && costs[main][branch].changes >= 1 && costs[junction][branch].changes == 0
    }

private fun physicalExcesses(
    costs: List<List<Cost>>,
    bounds: List<Int>,
    a: Int,
    c: Int,
): List<Pair<Int, Int>> =
    bounds.indices
        .map { b -> b to costs[a][c].seconds - costs[a][b].seconds - costs[b][c].seconds }
        .filter { it.second > 0 }
