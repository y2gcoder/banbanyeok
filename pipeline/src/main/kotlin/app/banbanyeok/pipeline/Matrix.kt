package app.banbanyeok.pipeline

internal fun matrixCosts(network: Network): List<List<Cost>> {
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
