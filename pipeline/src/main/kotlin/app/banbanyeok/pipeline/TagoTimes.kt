package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.roundToInt

/** One TAGO timetable row. Times are service-day seconds; null when TAGO sends "0" or blanks. */
internal data class TagoTrain(
    val departure: Int?,
    val arrival: Int?,
    /** endSubwayStationId; some rows omit it. */
    val end: String? = null,
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
        (item["endSubwayStationId"] as? JsonPrimitive)?.content,
    )

internal data class RunEstimate(
    val seconds: Int,
    val runSeconds: Int,
    val dwellSeconds: Int,
    val matched: Int,
    val ratio: Double,
)

private const val MAX_RUN = 1800
private const val BIN = 15
private const val TOLERANCE = 30
private const val OFFPEAK_START = 36_000
private const val OFFPEAK_END = 57_600
private const val ALIAS_SHARE = 0.8

private fun median(values: List<Int>): Int = values.sorted().let { it[it.size / 2] }

/**
 * Adjacent-station run time without train ids. A departure at [from] and an arrival at [to] belong to the
 * same train when their difference sits on a dominant offset (±30 s). Whole-day timetables are used so a periodic
 * off-peak pattern rarely aliases one headway away; when a smaller offset is almost as strong (≥ 80 % of the best
 * window), it is the adjacent run and the larger one a headway alias. Callers pass only the rows heading the
 * right way (by terminus): several operators list both directions under each U/D code.
 * The reported value is the off-peak median of the matched differences plus the median dwell at [to].
 */
internal fun estimateRun(
    from: List<TagoTrain>,
    to: List<TagoTrain>,
): RunEstimate? {
    val departures = from.mapNotNull { it.departure }.distinct().sorted()
    // Some operators send arrTime "0" at intermediate stations: then match departures, which already include dwell.
    val useArrivals = to.count { it.arrival != null } * 2 >= to.count { it.departure != null }
    val arrivals =
        to
            .mapNotNull { if (useArrivals) it.arrival else it.departure }
            .distinct()
            .sorted()
            .toIntArray()
    if (departures.isEmpty() || arrivals.isEmpty()) return null
    val bins = offsetBins(departures, arrivals)
    val center = firstPeak(bins) * BIN + BIN / 2
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
    val dwell = if (useArrivals) dwellAt(to) else 0
    return RunEstimate(
        run + dwell,
        run,
        dwell,
        matches.size,
        matches.size.toDouble() / minOf(departures.size, arrivals.size),
    )
}

/** Histogram (15 s bins) of every positive departure→arrival difference up to [MAX_RUN]. */
private fun offsetBins(
    departures: List<Int>,
    arrivals: IntArray,
): IntArray {
    val bins = IntArray(MAX_RUN / BIN + 1)
    departures.forEach { departure ->
        var i = lowerBound(arrivals, departure + 1)
        while (i < arrivals.size && arrivals[i] - departure <= MAX_RUN) {
            bins[(arrivals[i] - departure) / BIN]++
            i++
        }
    }
    return bins
}

/** Median departure − arrival at a station (0 when no row has both). */
private fun dwellAt(trains: List<TagoTrain>): Int {
    val dwells =
        trains.mapNotNull { train -> train.departure?.let { d -> train.arrival?.let { d - it } } }.filter {
            it in
                0..300
        }
    return if (dwells.isEmpty()) 0 else median(dwells)
}

/**
 * Bin of the first peak whose ±1-bin (45 s) count reaches [ALIAS_SHARE] of the strongest: larger offsets of similar
 * strength are headway aliases of the adjacent run. Returns the busiest raw bin around that peak.
 */
private fun firstPeak(bins: IntArray): Int {
    val smooth = IntArray(bins.size) { k -> (k - 1..k + 1).sumOf { bins.getOrElse(it) { 0 } } }
    val strongest = smooth.max()
    var k = smooth.indexOfFirst { it >= strongest * ALIAS_SHARE }
    while (k + 1 < smooth.size && smooth[k + 1] > smooth[k]) k++
    return (maxOf(0, k - 1)..minOf(bins.size - 1, k + 1)).maxBy { bins[it] }
}

/** Best of the four U/D pairings, for stations whose direction codes are trustworthy (S3 comparison only). */
internal fun estimateByCodes(
    from: Map<String, List<TagoTrain>>,
    to: Map<String, List<TagoTrain>>,
): RunEstimate? =
    from.values
        .flatMap { a -> to.values.mapNotNull { b -> estimateRun(a, b) } }
        .maxByOrNull { it.matched }

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
