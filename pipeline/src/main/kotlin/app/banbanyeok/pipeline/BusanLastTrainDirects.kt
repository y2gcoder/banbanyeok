package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType

/** One cell's value from a calculation source. */
internal data class BusanLtTrain(
    /** Service-day seconds at the meeting station: B1's arrival (its departure where it starts), TAGO's departure. */
    val seconds: Int,
    val destination: String,
    /** The train starts at the meeting station. */
    val origin: Boolean,
    /** TAGO's planned arrival at the meeting station, the lower bound of boarding its departure ([seconds]). B1: null. */
    val arrival: Int? = null,
)

/** One TAGO row at a station: its departure, its terminus's code and its planned arrival (null where TAGO has none). */
internal data class BusanTagoDeparture(
    val departure: Int,
    val end: String,
    val arrival: Int?,
)

/** The train boarding last at a meeting station that stops at a home station, unless trains boarding together differ. */
internal sealed interface BusanLtDirect {
    data class Train(
        val train: BusanLtTrain,
    ) : BusanLtDirect

    data object Ambiguous : BusanLtDirect
}

/** Station codes (meeting, home) → their direct. */
internal typealias BusanLtDirects = Map<Pair<String, String>, BusanLtDirect>

private fun latest(candidates: List<Pair<Int, BusanLtTrain>>): BusanLtDirect {
    val board = candidates.maxOf { it.first }
    val values = candidates.filter { it.first == board }.map { it.second }.toSet()
    return values.singleOrNull()?.let(BusanLtDirect::Train) ?: BusanLtDirect.Ambiguous
}

/** B1's numbered trains of [day] (the network input's source day). */
internal fun numberedBusanDirects(
    line: BusanLine,
    day: String,
): BusanLtDirects {
    val code = line.stations.map { it.code }
    val pairs = mutableMapOf<Pair<String, String>, MutableList<Pair<Int, BusanLtTrain>>>()
    for (train in line.trains.filter { it.day == day }) {
        val stops = train.stops
        for (i in 0 until stops.lastIndex) {
            val board = stops[i].departure ?: continue
            val value = BusanLtTrain(stops[i].arrival ?: board, code[stops.last().index], i == 0)
            for (home in stops.subList(i + 1, stops.size)) {
                pairs.getOrPut(code[stops[i].index] to code[home.index], ::mutableListOf).add(board to value)
            }
        }
    }
    return pairs.mapValues { latest(it.value) }
}

/**
 * TAGO's departures and termini by station code ([rows]) on a line in [order]: the latest departure whose terminus is
 * at or beyond home. TAGO rows carry no train identity, so no row is joined to another: K2's check of the cell says
 * whether that train stops at home (a train that passed home would differ from K2's last train stopping there).
 */
internal fun tagoBusanDirects(
    order: List<String>,
    rows: Map<String, Set<BusanTagoDeparture>>,
): BusanLtDirects {
    val position = order.withIndex().associate { it.value to it.index }
    return rows
        .flatMap { (meeting, departures) ->
            order.filter { it != meeting }.mapNotNull { home ->
                val forward = position.getValue(home) > position.getValue(meeting)
                val reach =
                    departures.filter { row ->
                        val at = position.getValue(row.end)
                        if (forward) at >= position.getValue(home) else at <= position.getValue(home)
                    }
                if (reach.isEmpty()) {
                    null
                } else {
                    (meeting to home) to
                        latest(reach.map { it.departure to BusanLtTrain(it.departure, it.end, false, it.arrival) })
                }
            }
        }.toMap()
}

/** [line]'s TAGO departures on [day] by station code, both directions; rows without a known terminus are left out. */
internal fun busanTagoRows(
    line: BusanLine,
    tago: TagoSnapshot,
    prefix: String,
    day: DayType,
): Map<String, Set<BusanTagoDeparture>> {
    fun nameKey(value: String) = value.substringBefore('(').filterNot { it in ".· " }

    val byName = line.stations.associate { nameKey(it.name) to it.code }
    val codes =
        tago.stations
            .filterKeys { it.startsWith(prefix) }
            .mapValues { (_, info) -> requireNotNull(byName[nameKey(info.first)]) { "TAGO $prefix: ${info.first}" } }
    require(codes.values.toSet() == byName.values.toSet()) { "TAGO $prefix stations differ from M1" }
    val timetable = requireNotNull(tago.raw[day]) { "TAGO has no ${day.id} timetable" }
    return codes.entries.associate { (id, code) ->
        code to
            timetable
                .getValue(id)
                .values
                .flatten()
                .mapNotNull { train ->
                    val departure = train.departure ?: return@mapNotNull null
                    val end = train.end?.let(codes::get) ?: return@mapNotNull null
                    BusanTagoDeparture(departure, end, train.arrival)
                }.toSet()
    }
}
