package app.banbanyeok.pipeline

import app.banbanyeok.schema.Station

/**
 * Config files name stations (candidates, SEO hubs, comparison pairs). A name may match two physical stations
 * since D1 (신촌 2호선/경의중앙선, 양평 5호선/경의중앙선): a unique match wins, otherwise the Seoul Metro station,
 * otherwise it is an error. Callers then work with codes, never with the first name match.
 */
internal fun stationNamed(
    stations: List<Station>,
    name: String,
): Station {
    val matches = stations.filter { it.name == name }
    val station =
        matches.singleOrNull()
            ?: matches.singleOrNull { it.sources.keys.any { key -> key.startsWith("kric:서울교통공사:") } }
    return requireNotNull(station) { "Station name $name is missing or ambiguous (${matches.size})" }
}

/** Index in [Network.origins] of the station [name] resolves to, by code. */
internal fun originIndex(
    net: Network,
    name: String,
): Int {
    val code = stationNamed(net.origins, name).code
    return net.origins.indexOfFirst { it.code == code }
}
