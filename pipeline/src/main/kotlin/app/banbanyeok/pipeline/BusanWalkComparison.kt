package app.banbanyeok.pipeline

import app.banbanyeok.core.RankInput
import app.banbanyeok.core.RouteCost
import app.banbanyeok.core.RouteSearch
import app.banbanyeok.core.rank
import app.banbanyeok.schema.RouteGraph
import app.banbanyeok.schema.RouteGraphCodec
import app.banbanyeok.schema.TimeSlot
import kotlinx.serialization.json.JsonObject
import java.nio.file.Path

/** Re-run both walking estimates with the same stations, timetables, and fair ranking. */
internal fun busanWalkComparison(
    root: Path,
    services: List<BusanService>,
    before: Map<TimeSlot, Network>,
    after: Map<TimeSlot, Network>,
): JsonObject {
    val origins = before.getValue(TimeSlot.DEFAULT).origins
    val codes = origins.map { it.code }
    val candidates = candidateCodes(root, origins.associateBy { it.code })
    val columns = candidates.map(codes::indexOf)
    val labels = services.associate { it.id to it.label }
    val baseline = routeGraph(before, RouteGraphCodec.REGIONAL_FORMAT_VERSION, labels::getValue)
    val adjusted = routeGraph(after, RouteGraphCodec.REGIONAL_FORMAT_VERSION, labels::getValue)
    val slots =
        TimeSlot.ALL.associate { slot ->
            val old = localOd(baseline, slot, codes)
            val new = localOd(adjusted, slot, codes)
            val comparison = walkCellComparison(old, new)
            slot.id to
                obj(
                    "od" to comparison,
                    "candidateOd" to walkCellComparison(selectColumns(old, columns), selectColumns(new, columns)),
                    "twoOriginFair" to compareMeetingRanks(codes, candidates, columns, old, new),
                )
        }
    return JsonObject(slots)
}

private fun localOd(
    graph: RouteGraph,
    slot: TimeSlot,
    codes: List<String>,
): List<List<RouteCost?>> {
    val search = RouteSearch(graph, slot)
    return codes.map { origin ->
        val tree = search.from(origin)
        codes.map { destination -> tree?.fastest(destination) }
    }
}

private fun selectColumns(
    od: List<List<RouteCost?>>,
    columns: List<Int>,
): List<List<RouteCost?>> = od.map { row -> columns.map(row::get) }

private fun walkCellComparison(
    old: List<List<RouteCost?>>,
    new: List<List<RouteCost?>>,
): JsonObject {
    val increases = mutableListOf<Int>()
    var changedTransfers = 0
    var reachable = 0
    for (row in old.indices) {
        for (column in old[row].indices) {
            val before = old[row][column]
            val after = new[row][column]
            require((before == null) == (after == null)) { "Walking estimate changed reachability" }
            if (before == null || after == null) continue
            reachable++
            val delta = after.seconds - before.seconds
            require(delta >= 0) { "Longer walking estimate reduced travel time" }
            if (delta > 0) increases.add(delta)
            if (after.transfers != before.transfers) changedTransfers++
        }
    }
    return obj(
        "reachableCells" to reachable,
        "increasedSeconds" to distribution(increases),
        "changedTransfers" to changedTransfers,
    )
}

private fun compareMeetingRanks(
    codes: List<String>,
    candidates: List<String>,
    columns: List<Int>,
    old: List<List<RouteCost?>>,
    new: List<List<RouteCost?>>,
): JsonObject {
    var pairs = 0
    var changedFirst = 0
    var changedTopThree = 0
    val available = old.indices.filter { old[it][it] != null }
    for ((index, a) in available.withIndex()) {
        for (b in available.drop(index + 1)) {
            val people = listOf(codes[a], codes[b])
            val previous = topThree(people, candidates, columns, listOf(old[a], old[b]))
            val adjusted = topThree(people, candidates, columns, listOf(new[a], new[b]))
            if (previous.isEmpty()) continue
            pairs++
            if (previous.firstOrNull() != adjusted.firstOrNull()) changedFirst++
            if (previous != adjusted) changedTopThree++
        }
    }
    return obj("pairs" to pairs, "changedFirst" to changedFirst, "changedTopThree" to changedTopThree)
}

private fun topThree(
    people: List<String>,
    candidates: List<String>,
    columns: List<Int>,
    rows: List<List<RouteCost?>>,
): List<String> =
    rank(
        RankInput(
            participants = people,
            candidates = candidates,
            times = rows.map { row -> columns.map { row[it]?.seconds } },
            transfers = rows.map { row -> columns.map { row[it]?.transfers } },
        ),
    ).recommendations.take(3).map { it.stationCode }
