package app.banbanyeok.pipeline

import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.StationStatus
import app.banbanyeok.schema.TimeSlot

/** Builds the regional station×service graph for a slot with all six services' headways available. */
internal fun busanNetwork(
    registry: Registry,
    services: List<BusanService>,
    transfers: BusanTransfers,
    slot: TimeSlot,
): Network {
    val nodes = services.flatMap { service -> service.stations.map { it.code to service.id } }
    val indexes = nodes.withIndex().associate { it.value to it.index }
    require(indexes.size == nodes.size) { "Duplicate Busan graph node" }
    val byStation = nodes.indices.groupBy { nodes[it].first }
    val origins =
        registry.stations
            .filter {
                it.code in byStation && it.status == StationStatus.ACTIVE
            }.sortedBy { it.code }
    require(
        origins.map { it.code }.toSet() == byStation.keys,
    ) { "Busan graph contains unknown or inactive station codes" }
    require(transfers.longStations.all { byStation.getValue(it).size == 2 }) {
        "Each long Busan transfer must name a station with two services"
    }

    val waits = services.associate { it.id to it.headways.getValue(slot) / 2 }
    val graph = List(nodes.size) { mutableListOf<Edge>() }
    for (service in services) {
        for (ride in service.rides) {
            val from = indexes.getValue(service.stations[ride.from].code to service.id)
            val to = indexes.getValue(service.stations[ride.to].code to service.id)
            graph[from].add(Edge(to, ride.seconds, 0))
        }
    }
    for ((from, node) in nodes.withIndex()) {
        val code = node.first
        val walk = transfers.seconds(code)
        for (to in byStation.getValue(code) - from) {
            val service = nodes[to].second
            graph[from].add(Edge(to, walk + waits.getValue(service), 1, service))
        }
    }
    return Network(registry, registry, origins, nodes, graph, waits, emptyList())
}

/** Append platform states without adding any cross-region edges or changing the metropolitan graph. */
internal fun combineRegions(
    capital: Network,
    busan: Network,
): Network {
    require(
        capital.origins
            .map { it.code }
            .intersect(busan.origins.map { it.code }.toSet())
            .isEmpty(),
    ) {
        "Station is an origin in more than one region"
    }
    require(
        capital.waits.keys
            .intersect(busan.waits.keys)
            .isEmpty(),
    ) { "Service belongs to more than one region" }
    val offset = capital.nodes.size
    val busanEdges = busan.graph.map { edges -> edges.map { it.copy(to = it.to + offset) } }
    return capital.copy(
        origins = (capital.origins + busan.origins).sortedBy { it.code },
        nodes = capital.nodes + busan.nodes,
        graph = capital.graph + busanEdges,
        waits = capital.waits + busan.waits,
    )
}

/** Verify every cross-region cell and the two diagonal blocks of the combined OD. */
internal fun verifyRegionalOd(
    capital: Network,
    busan: Network,
    busanCosts: List<List<Cost>>,
): Int {
    val capitalCosts = matrixCosts(capital)
    val combined = combineRegions(capital, busan)
    val allCosts = matrixCosts(combined)
    val indexes = combined.origins.withIndex().associate { it.value.code to it.index }
    val capitalIndexes = capital.origins.map { indexes.getValue(it.code) }
    val busanIndexes = busan.origins.map { indexes.getValue(it.code) }
    require(capitalIndexes.map { row -> capitalIndexes.map { allCosts[row][it] } } == capitalCosts) {
        "Metropolitan OD changed"
    }
    require(busanIndexes.map { row -> busanIndexes.map { allCosts[row][it] } } == busanCosts) {
        "Busan OD changed on region combination"
    }
    val disconnected =
        capitalIndexes.all { a ->
            busanIndexes.all { b -> allCosts[a][b] == infinity && allCosts[b][a] == infinity }
        }
    require(disconnected) { "Cross-region OD must be unreachable" }
    return 2 * capitalIndexes.size * busanIndexes.size
}
