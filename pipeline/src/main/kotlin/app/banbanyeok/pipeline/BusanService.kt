package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.TimeSlot
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path
import kotlin.io.path.readText

internal data class BusanService(
    val id: String,
    val label: String,
    val stations: List<BusanStop>,
    val rides: List<BusanRide>,
    val headways: Map<TimeSlot, Int>,
    val comparison: JsonObject? = null,
)

internal fun readBusanServices(
    root: Path,
    input: Path,
): List<BusanService> {
    val config = parseObject(root.resolve("data/config/busan-services.json").readText())
    val source = parseObject(input.readText())
    require(config.text("region") == TagoRegion.BUSAN.configKey && source.text("region") == config.text("region")) {
        "Busan service configuration and network input must both use the Busan region"
    }
    val definitions = config.getValue("services").jsonObject
    val lines = source.getValue("lines").jsonObject
    require(definitions.keys == lines.keys) { "M1 and Busan service configuration cover different lines" }
    val tago = readRegionalTago(root, TagoRegion.BUSAN)
    return definitions.map { (id, definition) ->
        val line = parseBusanLine(lines.getValue(id).jsonObject)
        buildBusanService(id, definition.jsonObject, line, tago)
    }
}

private fun buildBusanService(
    id: String,
    rule: JsonObject,
    line: BusanLine,
    tago: TagoSnapshot,
): BusanService {
    val label = rule.text("label")
    val prefix = rule["tagoPrefix"]?.jsonPrimitive?.content
    if (prefix != null) {
        val days = tagoDays(line, prefix, tago, ::busanLightRailDirections)
        val rides = lightRailRides(days.getValue(DayType.WEEKDAY))
        // K1's BGL minute precision rounds one adjacent ride to 0 s. Preserve it for comparison only.
        val reference = numberedRides(line, rule.text("numberedComparisonDay"), minimumSeconds = 0)
        val deltas =
            rides.zip(reference).map { (actual, expected) ->
                require(actual.from == expected.from && actual.to == expected.to)
                actual.seconds - expected.seconds
            }
        return BusanService(
            id,
            label,
            line.stations,
            rides,
            headways(label, days),
            obj(
                "tagoMinusK1RideSeconds" to distribution(deltas),
                "k1ZeroSecondRides" to reference.count { it.seconds == 0 },
            ),
        )
    }
    val headways = headways(label, numberedDays(line, rule.getValue("numberedDays").jsonObject))
    val comparison =
        rule["tagoComparisonPrefix"]?.jsonPrimitive?.content?.let { otherPrefix ->
            val otherDays = tagoDays(line, otherPrefix, tago, ::donghaeDirections)
            val otherHeadways = headways(label, otherDays)
            val common = headways.keys.intersect(otherHeadways.keys)
            val deltas = common.associate { it.id to jsonValue(headways.getValue(it) - otherHeadways.getValue(it)) }
            obj("k1MinusTagoHeadwaySeconds" to JsonObject(deltas))
        }
    return BusanService(id, label, line.stations, numberedRides(line), headways, comparison)
}

private typealias BusanDepartures = List<Map<String, List<TagoTrain>>>

private fun numberedDays(
    line: BusanLine,
    dayMapping: JsonObject,
): Map<DayType, BusanDepartures> =
    DayType.entries
        .mapNotNull { day ->
            dayMapping[day.id]?.jsonPrimitive?.content?.let { sourceDay ->
                val stations = numberedDepartures(line, sourceDay)
                require(stations.isNotEmpty()) { "Missing numbered Busan trains for $sourceDay" }
                day to stations
            }
        }.toMap()

private fun tagoDays(
    line: BusanLine,
    prefix: String,
    tago: TagoSnapshot,
    directions: (List<String>, TagoTimetable) -> BusanDepartures,
): Map<DayType, BusanDepartures> {
    fun nameKey(value: String) = value.substringBefore('(').filterNot { it in ".· " }

    val scoped = tago.stations.filterKeys { it.startsWith(prefix) }
    val byName = scoped.entries.associate { (id, info) -> nameKey(info.first) to id }
    val stations = line.stations.map { nameKey(it.name) }
    require(scoped.size == byName.size && stations.size == byName.size && stations.toSet() == byName.keys) {
        "M1 and TAGO have different stations for $prefix"
    }
    val ids = stations.map(byName::getValue)
    return tago.raw
        .mapNotNull { (day, timetable) ->
            val rows = directions(ids, timetable)
            if (rows.any { station -> station.values.any { it.isNotEmpty() } }) day to rows else null
        }.toMap()
}

private fun donghaeDirections(
    ids: List<String>,
    timetable: TagoTimetable,
): BusanDepartures =
    ids.map { id ->
        val rows = timetable.getValue(id)
        mapOf(BUSAN_FORWARD to rows.getValue("D"), BUSAN_REVERSE to rows.getValue("U"))
    }

private fun lightRailRides(timetable: BusanDepartures): List<BusanRide> {
    val dwell = ordinaryDwell(timetable.flatMap { it.values })

    fun estimate(
        from: Int,
        to: Int,
        direction: String,
    ): BusanRide {
        val ordinary = if (to == 0 || to == timetable.lastIndex) 0 else dwell
        val run = estimateRun(timetable[from].getValue(direction), timetable[to].getValue(direction), ordinary)
        require(run != null && run.matched >= MIN_MATCHED && run.ratio >= MIN_RATIO && run.seconds in RUN_RANGE) {
            "No reliable Busan light-rail estimate at stop $from → $to"
        }
        return BusanRide(from, to, run.seconds)
    }
    return (0 until timetable.lastIndex).flatMap { i ->
        listOf(estimate(i, i + 1, BUSAN_FORWARD), estimate(i + 1, i, BUSAN_REVERSE))
    }
}

private fun headways(
    label: String,
    days: Map<DayType, BusanDepartures>,
): Map<TimeSlot, Int> =
    TimeSlot.ALL
        .mapNotNull { slot ->
            days[slot.day]?.let { stations ->
                val seconds = serviceHeadway(stations, slot.band.window)
                require(
                    seconds != null && seconds in TAGO_HEADWAY_RANGE,
                ) { "$label: missing or unsupported headway for $slot" }
                slot to seconds
            }
        }.toMap()
