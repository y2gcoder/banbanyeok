package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.roundToInt

/** One TAGO timetable row. Times are service-day seconds; null when TAGO sends "0" or blanks. */
internal data class TagoTrain(
    val departure: Int?,
    val arrival: Int?,
)

/** Station id → upDownTypeCode → weekday rows. */
internal typealias TagoTimetable = Map<String, Map<String, List<TagoTrain>>>

/** "HHMMSS" → seconds; 00~02 h belong to the previous service day. Blank, "0" and malformed values → null. */
internal fun tagoSeconds(value: String?): Int? {
    val text = value?.trim().orEmpty()
    if (!Regex("[0-9]{6}").matches(text)) return null
    val hour = text.take(2).toInt()
    val minute = text.substring(2, 4).toInt()
    val second = text.substring(4).toInt()
    if (hour > 27 || minute > 59 || second > 59) return null
    return (if (hour < 3) hour + 24 else hour) * 3600 + minute * 60 + second
}

internal fun tagoTrain(item: JsonObject): TagoTrain =
    TagoTrain(
        tagoSeconds((item["depTime"] as? JsonPrimitive)?.content),
        tagoSeconds((item["arrTime"] as? JsonPrimitive)?.content),
    )

internal data class RunEstimate(
    val seconds: Int,
    val runSeconds: Int,
    val dwellSeconds: Int,
    val matched: Int,
    val ratio: Double,
    val fromDirection: String,
    val toDirection: String,
)

private const val MAX_RUN = 1800
private const val BIN = 15
private const val TOLERANCE = 30
private const val OFFPEAK_START = 36_000
private const val OFFPEAK_END = 57_600

private fun median(values: List<Int>): Int = values.sorted().let { it[it.size / 2] }

/**
 * Adjacent-station run time without train ids. A departure at [from] and an arrival at [to] belong to the
 * same train when their difference sits on the dominant offset (±30 s). Whole-day timetables are used so a
 * periodic off-peak pattern cannot alias one headway away; the reported value is the off-peak median of the
 * matched differences plus the median dwell at [to]. The direction codes are chosen by the best match because
 * through-running operators do not share U/D conventions.
 */
internal fun estimateRun(
    from: Map<String, List<TagoTrain>>,
    to: Map<String, List<TagoTrain>>,
): RunEstimate? =
    from.keys
        .flatMap { a -> to.keys.map { b -> a to b } }
        .mapNotNull { (a, b) -> estimateDirected(from.getValue(a), to.getValue(b), a, b) }
        .maxWithOrNull(compareBy<RunEstimate> { it.matched }.thenByDescending { it.runSeconds })

private fun estimateDirected(
    from: List<TagoTrain>,
    to: List<TagoTrain>,
    fromDirection: String,
    toDirection: String,
): RunEstimate? {
    val departures = from.mapNotNull { it.departure }.distinct().sorted()
    val arrivals =
        to
            .mapNotNull { it.arrival }
            .distinct()
            .sorted()
            .toIntArray()
    if (departures.isEmpty() || arrivals.isEmpty()) return null
    val bins = IntArray(MAX_RUN / BIN + 1)
    departures.forEach { departure ->
        var i = lowerBound(arrivals, departure + 1)
        while (i < arrivals.size && arrivals[i] - departure <= MAX_RUN) {
            bins[(arrivals[i] - departure) / BIN]++
            i++
        }
    }
    val window = TOLERANCE / BIN
    val center =
        bins.indices.maxBy { k -> (k - window..k + window).sumOf { bins.getOrElse(it) { 0 } } } * BIN + BIN / 2
    val matches =
        departures.mapNotNull { departure ->
            val i = lowerBound(arrivals, departure + center - TOLERANCE)
            arrivals
                .getOrNull(i)
                ?.takeIf { it - departure in (center - TOLERANCE)..(center + TOLERANCE) && it > departure }
                ?.let { departure to it - departure }
        }
    if (matches.isEmpty()) return null
    val offpeak = matches.filter { it.first in OFFPEAK_START..OFFPEAK_END }.map { it.second }
    val run = median(if (offpeak.size >= 3) offpeak else matches.map { it.second })
    val dwells =
        to.mapNotNull { train -> train.departure?.let { d -> train.arrival?.let { d - it } } }.filter {
            it in
                0..300
        }
    val dwell = if (dwells.isEmpty()) 0 else median(dwells)
    return RunEstimate(
        run + dwell,
        run,
        dwell,
        matches.size,
        matches.size.toDouble() / minOf(departures.size, arrivals.size),
        fromDirection,
        toDirection,
    )
}

private fun lowerBound(
    values: IntArray,
    key: Int,
): Int {
    var low = 0
    var high = values.size
    while (low < high) {
        val mid = (low + high) ushr 1
        if (values[mid] < key) low = mid + 1 else high = mid
    }
    return low
}

internal data class StationHeadway(
    val direction: String,
    val seconds: Int,
    val departures: Int,
)

/** Mean off-peak (10:00–16:00) departure gap per direction; whole service day when off-peak has < 2. */
internal fun tagoStationHeadways(station: Map<String, List<TagoTrain>>): List<StationHeadway> =
    station.mapNotNull { (direction, trains) ->
        val all = trains.mapNotNull { it.departure }.distinct().sorted()
        val offpeak = all.filter { it in OFFPEAK_START..OFFPEAK_END }
        val times = if (offpeak.size >= 2) offpeak else all
        if (times.size < 2) {
            null
        } else {
            StationHeadway(direction, times.zipWithNext { a, b -> b - a }.average().roundToInt(), times.size)
        }
    }

/** Per-direction median over stations, then mean of directions: the same aggregation as the Seoul S5 headways. */
internal fun serviceHeadway(stations: List<Map<String, List<TagoTrain>>>): Int? {
    val byDirection = stations.flatMap(::tagoStationHeadways).groupBy { it.direction }
    if (byDirection.isEmpty()) return null
    return byDirection.values
        .map { values -> median(values.map { it.seconds }) }
        .average()
        .roundToInt()
}
