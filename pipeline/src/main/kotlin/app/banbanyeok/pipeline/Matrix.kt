package app.banbanyeok.pipeline

internal fun matrixCosts(network: Network): List<List<Cost>> =
    network.origins.map { origin ->
        val seeds =
            network.nodes
                .withIndex()
                .filter { it.value.first == origin.code }
                .associate { it.index to network.waits.getValue(it.value.second) }
        val distances = shortest(network.graph, seeds)
        network.origins.map { destination ->
            if (origin.code == destination.code) {
                Cost(0, 0)
            } else {
                network.nodes
                    .withIndex()
                    .filter { it.value.first == destination.code }
                    .minOf { distances[it.index] }
            }
        }
    }
