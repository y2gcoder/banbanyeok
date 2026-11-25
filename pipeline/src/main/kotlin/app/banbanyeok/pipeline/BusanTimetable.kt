package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal data class BusanStop(
    val code: String,
    val name: String,
)

internal data class NumberedStop(
    val index: Int,
    val arrival: Int?,
    val departure: Int?,
)

internal data class BusanTrain(
    val number: String,
    val day: String,
    val stops: List<NumberedStop>,
) {
    val direction: String = direction(stops.first().index, stops.last().index)
}

internal data class BusanLine(
    val stations: List<BusanStop>,
    val trains: List<BusanTrain>,
)

internal data class BusanRide(
    val from: Int,
    val to: Int,
    val seconds: Int,
)

internal const val BUSAN_FORWARD = "forward"
internal const val BUSAN_REVERSE = "reverse"

private fun direction(
    from: Int,
    to: Int,
): String = if (from < to) BUSAN_FORWARD else BUSAN_REVERSE

internal fun parseBusanLine(data: JsonObject): BusanLine {
    val stations =
        data.getValue("stations").jsonArray.map {
            val station = it.jsonObject
            BusanStop(station.text("code"), station.text("name"))
        }
    require(stations.size >= 2 && stations.map(BusanStop::code).distinct().size == stations.size) {
        "Busan line needs at least two distinct station codes"
    }
    val trains = data.getValue("trains").jsonArray.map { parseBusanTrain(it.jsonObject, stations.indices) }
    require(
        trains.distinctBy { it.day to it.number }.size == trains.size,
    ) { "Duplicate Busan train number for one day" }
    return BusanLine(stations, trains)
}

private fun parseBusanTrain(
    data: JsonObject,
    stationIndices: IntRange,
): BusanTrain {
    val number = data.text("number")
    val stops =
        data.getValue("stops").jsonArray.map {
            val row = it.jsonArray
            require(row.size == 3) { "Train $number: invalid stop" }
            val (station, arrival, departure) = row
            NumberedStop(station.jsonPrimitive.int, arrival.jsonPrimitive.intOrNull, departure.jsonPrimitive.intOrNull)
        }
    val steps = stops.zipWithNext { a, b -> b.index - a.index }.toSet()
    require(stops.all { it.index in stationIndices } && (steps == setOf(-1) || steps == setOf(1))) {
        "Train $number: stops must be adjacent and in order"
    }
    return BusanTrain(number, data.text("day"), stops)
}

/** Run plus dwell from the same numbered train, two directions per consecutive station pair. */
internal fun numberedRides(
    line: BusanLine,
    day: String = "weekday",
    minimumSeconds: Int = RUN_RANGE.first,
): List<BusanRide> {
    val samples = mutableMapOf<Pair<Int, Int>, MutableList<Int>>()
    line.trains.filter { it.day == day }.forEach { train ->
        train.stops.zipWithNext().forEachIndexed { index, (from, to) ->
            val departure =
                requireNotNull(from.departure) { "Train ${train.number} missing departure at stop ${from.index}" }
            // At a train's terminus the arrival is the end of the ride, even if K1 repeats it as a departure.
            val end = if (index + 1 < train.stops.lastIndex) to.departure ?: to.arrival else to.arrival
            requireNotNull(end) { "Train ${train.number} missing arrival at stop ${to.index}" }
            val seconds = end - departure
            require(
                seconds in minimumSeconds..RUN_RANGE.last,
            ) { "Train ${train.number} has an implausible ride (${seconds}s)" }
            samples.getOrPut(from.index to to.index, ::mutableListOf).add(seconds)
        }
    }

    fun median(
        from: Int,
        to: Int,
    ): BusanRide {
        val sorted = requireNotNull(samples[from to to]) { "No numbered rides at stop $from → $to" }.sorted()
        return BusanRide(from, to, sorted[sorted.size / 2])
    }
    return (0 until line.stations.lastIndex).flatMap { i -> listOf(median(i, i + 1), median(i + 1, i)) }
}

/** Actual day only. A train ending at a stop contributes no departure to the boarding headway. */
internal fun numberedDepartures(
    line: BusanLine,
    day: String,
): List<Map<String, List<TagoTrain>>> {
    val trains = line.trains.filter { it.day == day }
    if (trains.isEmpty()) return emptyList()
    val stations = List(line.stations.size) { mutableMapOf<String, MutableList<TagoTrain>>() }
    for (train in trains) {
        for (stop in train.stops.dropLast(1)) {
            val departure = stop.departure ?: continue
            stations[stop.index].getOrPut(train.direction, ::mutableListOf).add(TagoTrain(departure, stop.arrival))
        }
    }
    return stations
}

/** Both TAGO U/D streams contain both physical directions of 부산김해. */
internal fun busanLightRailDirections(
    ids: List<String>,
    timetable: TagoTimetable,
): List<Map<String, List<TagoTrain>>> {
    val byTerminus = mapOf(ids.first() to BUSAN_REVERSE, ids.last() to BUSAN_FORWARD)
    return ids.map { station ->
        val grouped =
            timetable.getValue(station).values.flatten().distinct().groupBy {
                requireNotNull(byTerminus[it.end]) { "Busan light rail at $station: missing or unknown terminus" }
            }
        byTerminus.values.associateWith { grouped[it].orEmpty() }
    }
}
