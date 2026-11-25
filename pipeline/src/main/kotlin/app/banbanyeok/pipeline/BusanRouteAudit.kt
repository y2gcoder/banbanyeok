package app.banbanyeok.pipeline

import app.banbanyeok.core.RouteCost
import app.banbanyeok.core.RouteSearch
import app.banbanyeok.core.RouteTree
import app.banbanyeok.schema.DataSet
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.RouteGraphCodec
import app.banbanyeok.schema.Sha256
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.TimeSlot
import kotlinx.serialization.json.JsonObject
import java.nio.file.Path
import kotlin.io.path.readText

/** Exercise the regional codec and OD without exposing a new manifest or writing an artifact. */
internal fun busanRouteAudit(
    capital: StageContext,
    busanSlots: Map<TimeSlot, Network>,
    services: List<BusanService>,
): JsonObject {
    val metropolitan = loadDevArtifacts(capital.root.resolve("data/artifacts/dev"))
    val combined = busanSlots.mapValues { (slot, busan) -> combineRegions(capital.slots.getValue(slot), busan) }
    val metroGroups =
        capital.input.tago
            ?.lines
            ?.groups
            .orEmpty()
    val labels = services.associate { it.id to it.label }
    val graph =
        routeGraph(combined, RouteGraphCodec.REGIONAL_FORMAT_VERSION) { service ->
            labels[service] ?: metroGroups[service] ?: service.take(1)
        }
    val bytes = RouteGraphCodec.encode(graph)
    val decoded = RouteGraphCodec.decode(bytes)
    require(RouteGraphCodec.encode(decoded).contentEquals(bytes)) { "Regional graph does not round trip" }
    val slots =
        busanSlots.mapValues { (slot, busan) ->
            val search = RouteSearch(decoded, slot)
            val matrix = requireNotNull(metropolitan.odFor(slot))
            val busanCodes = busan.origins.map { it.code }
            val capitalCodes = verifyMetropolitanProjection(metropolitan, search, matrix, busanCodes)
            verifyRegionalSlot(search, busanCodes, capitalCodes)
        }
    val stations = busanSlots.getValue(TimeSlot.DEFAULT).origins.associateBy { it.code }
    val comparisons = compareRoutePairs(capital.root, RouteSearch(decoded, TimeSlot.DEFAULT), stations)
    return obj(
        "candidateCodes" to candidateCodes(capital.root, stations),
        "routeComparisons" to comparisons,
        "formatVersion" to decoded.formatVersion,
        "sha256" to Sha256.hex(bytes),
        "lines" to decoded.lines,
        "slots" to JsonObject(slots.mapKeys { it.key.id }),
    )
}

private fun verifyMetropolitanProjection(
    metropolitan: DataSet,
    search: RouteSearch,
    matrix: OdMatrix,
    busanCodes: List<String>,
): List<String> =
    List(matrix.originCount) { row ->
        val origin = matrix.originCode(row).toString()
        val tree = requireNotNull(search.from(origin)) { "Regional graph omitted metropolitan origin $origin" }
        for (column in metropolitan.candidates.candidates.indices) {
            val destination = metropolitan.candidates.candidates[column]
            val seconds = matrix.timeSeconds(row, column)
            val expected =
                if (seconds == OdMatrix.UNREACHABLE) null else RouteCost(seconds, matrix.transfers(row, column))
            require(tree.fastest(destination) == expected) { "Metropolitan OD changed: $origin → $destination" }
        }
        require(busanCodes.none { tree.fastest(it) != null }) { "Metropolitan origin reaches Busan: $origin" }
        origin
    }

private fun verifyRegionalSlot(
    search: RouteSearch,
    busanCodes: List<String>,
    capitalCodes: List<String>,
): JsonObject {
    val trees = busanCodes.associateWith(search::from)
    val boardable = trees.filterValues { it != null }
    val unavailable = trees.keys - boardable.keys
    var reachable = 0
    var connected = 0
    for ((origin, tree) in boardable) {
        val from = requireNotNull(tree)
        reachable += reachablePairs(busanCodes, from)
        connected += reachablePairs(boardable.keys, from)
        require(capitalCodes.none { from.fastest(it) != null }) { "Busan origin reaches metropolitan region: $origin" }
    }
    val disconnected = boardable.size * boardable.size - connected
    val disableReason =
        when {
            boardable.size < 2 -> "no-connected-rail"
            disconnected != 0 -> "disconnected-known-services"
            else -> null
        }
    return obj(
        "busanReachableCells" to reachable,
        "busanUnreachableCells" to busanCodes.size * busanCodes.size - reachable,
        "busanOriginsWithoutKnownService" to unavailable,
        "crossRegionUnreachableCells" to 2 * busanCodes.size * capitalCodes.size,
        "boardableDisconnectedPairs" to disconnected,
        "entireRegionDisableReason" to disableReason,
    )
}

private fun reachablePairs(
    destinations: Iterable<String>,
    tree: RouteTree,
): Int = destinations.count { tree.fastest(it) != null }

private fun candidateCodes(
    root: Path,
    stations: Map<String, Station>,
): List<String> {
    val seeds = csv(root.resolve("data/config/busan-candidates.csv").readText())
    require(seeds.first() == listOf("code", "name", "reason")) { "Busan candidate header is invalid" }
    val codes =
        seeds.drop(1).map { row ->
            require(row.size == 3 && row[2].isNotBlank()) { "Busan candidate requires code, name and reason" }
            val (code, name) = row
            require(stations[code]?.name == name) { "Busan candidate $code $name does not match the regional registry" }
            code
        }
    require(
        codes.size == 27 && codes.distinct().size == codes.size,
    ) { "Expected 27 distinct approved Busan candidates" }
    return codes.sorted()
}

private fun compareRoutePairs(
    root: Path,
    search: RouteSearch,
    stations: Map<String, Station>,
): List<JsonObject> {
    val rows = csv(root.resolve("data/config/busan-route-checks.csv").readText())
    require(rows.first() == listOf("origin", "destination", "coverage")) { "Busan comparison header is invalid" }
    val pairs = rows.drop(1)
    require(
        pairs.size == 26 && pairs.all { it.size == 3 && it[0] != it[1] } &&
            pairs.distinctBy { it[0] to it[1] }.size == pairs.size,
    ) { "Expected 26 distinct directional Busan comparisons" }
    return pairs.map { (a, b, coverage) ->
        val from = stations.getValue(a)
        val to = stations.getValue(b)
        val trace = requireNotNull(search.from(a)?.trace(b)) { "Busan comparison cannot reach $a → $b" }
        obj(
            "origin" to comparisonStation(from),
            "destination" to comparisonStation(to),
            "coverage" to coverage,
            "seconds" to trace.cost.seconds,
            "transfers" to trace.cost.transfers,
            "segments" to
                trace.segments.map {
                    obj(
                        "from" to comparisonStation(stations.getValue(it.fromCode)),
                        "to" to comparisonStation(stations.getValue(it.toCode)),
                        "line" to it.line,
                    )
                },
        )
    }
}

private fun comparisonStation(station: Station): JsonObject =
    obj("code" to station.code, "name" to station.name, "lat" to station.lat, "lng" to station.lng)
