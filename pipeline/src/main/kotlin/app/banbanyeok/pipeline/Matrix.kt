package app.banbanyeok.pipeline

import app.banbanyeok.schema.RouteGraph

internal fun Network.requireKnownWaits() {
    require(RouteGraph.UNAVAILABLE_WAIT !in waits.values) {
        "This OD computation requires known boarding waits for every service"
    }
}

internal fun matrixCosts(network: Network): List<List<Cost>> {
    network.requireKnownWaits()
    if (network.outdoor.isNotEmpty()) return regionalMatrixCosts(network)
    val platforms = network.nodes.indices.groupBy { network.nodes[it].first }
    return network.origins.map { origin ->
        val seeds =
            platforms.getValue(origin.code).associateWith { network.waits.getValue(network.nodes[it].second) }
        val distances = shortest(network.graph, seeds)
        network.origins.map { destination ->
            if (origin.code == destination.code) {
                Cost(0, 0)
            } else {
                platforms.getValue(destination.code).minOf { distances[it] }
            }
        }
    }
}

/** Independently builds regional OD from platform edges and access/egress walks, without the encoded graph. */
internal fun regionalMatrixCosts(network: Network): List<List<Cost>> {
    val waits = network.nodes.map { (_, service) -> network.waits.getValue(service) }
    val available = waits.indices.filter { waits[it] != RouteGraph.UNAVAILABLE_WAIT }.toSet()
    val platforms = available.groupBy { network.nodes[it].first }
    val graph =
        network.graph.map { edges ->
            edges.filter { it.to in available && it.wait?.let(network.waits::get) != RouteGraph.UNAVAILABLE_WAIT }
        }
    val entrance = network.origins.associate { (code) -> code to (network.outdoor[code].orEmpty() + (code to 0)) }
    val exits =
        entrance
            .flatMap { (from, walks) -> walks.map { (to, seconds) -> to to (from to seconds) } }
            .groupBy({ it.first }, { it.second })
    return network.origins.map { (origin) ->
        val walks = entrance.getValue(origin)
        val seeds = walks.flatMap { (code, walk) -> platforms[code].orEmpty().map { it to (waits[it] + walk) } }.toMap()
        if (seeds.isEmpty()) {
            List(network.origins.size) { infinity }
        } else {
            val distances = shortest(graph, seeds)
            network.origins.map { (destination) ->
                val walkOnly = walks[destination]?.let { Cost(it, 0) } ?: infinity
                val rail =
                    exits
                        .getValue(destination)
                        .flatMap { (code, walk) ->
                            platforms[code].orEmpty().map { node ->
                                val cost = distances[node]
                                if (cost == infinity) infinity else cost.copy(seconds = cost.seconds + walk)
                            }
                        }.minOrNull() ?: infinity
                minOf(walkOnly, rail)
            }
        }
    }
}
