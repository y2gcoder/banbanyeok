package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.roundToInt

internal const val TIMETABLE_SERVICE = "SearchSTNTimeTableByIDService"

internal fun serviceSeconds(value: String): Int {
    require(Regex("[0-2][0-9]:[0-5][0-9]:[0-5][0-9]").matches(value)) { "Invalid service time" }
    val (hour, minute, second) = value.split(':').map(String::toInt)
    return (if (hour < 3) hour + 24 else hour) * 3600 + minute * 60 + second
}

internal data class TimetablePage(
    val total: Int,
    val rows: List<JsonObject>,
)

internal fun timetablePage(
    text: String,
    service: String = TIMETABLE_SERVICE,
): TimetablePage {
    val envelope = parseObject(text)
    val body = envelope[service]?.jsonObject
    val result = body?.get("RESULT")?.jsonObject ?: envelope["RESULT"]?.jsonObject
    val code = result?.text("CODE")
    // ERROR-337: 일별 트래픽 제한. 이어받기를 위해 별도 예외로 멈춘다. 코드는 형식이 맞을 때만 메시지에 넣는다(본문은 넣지 않는다).
    if (code == "ERROR-337") throw SeoulQuotaExceeded()
    require(code in setOf("INFO-000", "INFO-200")) {
        "Seoul API schema/status failure (${code?.takeIf { Regex("[A-Z]{4,5}-[0-9]{3}").matches(it) } ?: "no code"})"
    }
    if (code == "INFO-200") return TimetablePage(0, emptyList())
    requireNotNull(body) { "Seoul API missing service" }
    return TimetablePage(body.text("list_total_count").toInt(), body.getValue("row").jsonArray.map { it.jsonObject })
}

/**
 * Mean departure gap per station/direction/branch inside [window] (service-day seconds, both ends inclusive) for
 * the S5 day type [weekTag]. Intervals never cross stations, directions or branch patterns. Duplicate train rows
 * count once. Express trains are excluded (ordinary-train model).
 */
internal fun stationHeadways(
    rows: List<JsonObject>,
    weekTag: String = DayType.WEEKDAY.seoulWeekTag,
    window: IntRange = Band.DAY.window,
): List<JsonObject> =
    rows
        .filter { it.text("WEEK_TAG") == weekTag && it.text("EXPRESS_YN") == "G" }
        .groupBy { listOf(it.text("LINE_NUM"), it.text("STATION_CD"), it.text("INOUT_TAG"), it.text("BRANCH_LINE")) }
        .mapNotNull { (key, trains) ->
            val times =
                trains
                    .distinctBy { it.text("TRAIN_NO") to it.text("LEFTTIME") }
                    .mapNotNull { train -> train.text("LEFTTIME").takeIf { it.isNotBlank() }?.let(::serviceSeconds) }
                    .filter { it in window }
                    .distinct()
                    .sorted()
            val gaps = times.zipWithNext { a, b -> b - a }
            if (gaps.isEmpty()) {
                null
            } else {
                obj(
                    "line" to key[0].filter(Char::isDigit).toInt().toString(),
                    "station" to key[1],
                    "direction" to key[2],
                    "branch" to key[3],
                    "seconds" to gaps.average().roundToInt(),
                    "intervalCount" to gaps.size,
                    "departures" to times.size,
                )
            }
        }

/** Per line/direction median of station-pattern means (upper median), as in P2b. */
private fun directionHeadways(observations: List<JsonObject>): List<JsonObject> =
    observations.groupBy { it.text("line") to it.text("direction") }.map { (key, values) ->
        obj(
            "line" to key.first,
            "direction" to key.second,
            "seconds" to values.map { it.text("seconds").toInt() }.sorted().let { it[it.size / 2] },
            "stationPatternCount" to values.size,
        )
    }

/** Mean of the two direction values per line; a line needs both directions measured. */
private fun lineHeadways(
    directions: List<JsonObject>,
    lines: Set<String>,
): Map<String, Int?> =
    lines.associateWith { line ->
        val measured = directions.filter { it.text("line") == line }
        if (measured.size < 2) {
            null
        } else {
            measured.map { it.text("seconds").toInt() }.average().roundToInt().also {
                require(it in SEOUL_HEADWAY_RANGE) { "Observed line headway outside supported range" }
            }
        }
    }

internal val SEOUL_HEADWAY_RANGE = 60..1800

/**
 * headways.json for every time slot from S5 rows grouped by day type. `lines` stays the default slot (weekday
 * daytime) so existing readers keep their meaning; `slots` holds all slots, default included. A line without both
 * directions in a slot keeps its previous value for that slot (estimated=true) and marks the file estimated.
 */
internal fun slotHeadways(
    original: JsonObject,
    rows: Map<DayType, List<JsonObject>>,
    fetchedAt: String,
): JsonObject {
    val previousLines = original.getValue("lines").jsonObject
    val previousSlots = original["slots"]?.jsonObject
    val slots =
        TimeSlot.ALL.associate { slot ->
            val observations = stationHeadways(rows[slot.day].orEmpty(), slot.day.seoulWeekTag, slot.band.window)
            val directions = directionHeadways(observations)
            val measured = lineHeadways(directions, previousLines.keys)
            val fallback =
                previousSlots
                    ?.get(slot.id)
                    ?.jsonObject
                    ?.getValue("lines")
                    ?.jsonObject ?: previousLines
            val lines =
                measured.mapValues { (line, seconds) ->
                    if (seconds == null) {
                        fallback.getValue(line).jsonObject.let { JsonObject(it + ("estimated" to jsonValue(true))) }
                    } else {
                        obj("seconds" to seconds, "estimated" to false)
                    }
                }
            slot.id to
                obj(
                    "window" to windowText(slot.band.window),
                    "lines" to JsonObject(lines.toSortedMap()),
                    "directions" to directions.sortedWith(compareBy({ it.text("line") }, { it.text("direction") })),
                )
        }
    val defaultLines = slots.getValue(TimeSlot.DEFAULT.id).getValue("lines")
    val estimated =
        slots.values.any { slot ->
            slot
                .getValue(
                    "lines",
                ).jsonObject.values
                .any { it.jsonObject["estimated"]?.jsonPrimitive?.content != "false" }
        }
    return JsonObject(
        original - setOf("observations", "directions", "period", "service_day") +
            mapOf(
                "lines" to defaultLines,
                "slots" to JsonObject(slots),
                "fetched_at" to jsonValue(fetchedAt),
                "source_url" to jsonValue("https://data.seoul.go.kr/dataList/OA-101/A/1/datasetView.do"),
                "basis" to
                    jsonValue(
                        "Per time slot (day type = S5 WEEK_TAG 1/2/3, band = departure window in " +
                            "slots[].window): mean adjacent departure gaps per station/direction/branch; median " +
                            "station-pattern mean per line/direction; mean of directions for boarding wait. Regular " +
                            "trains only. `lines` is the default slot weekday-day. Timetable revision date not " +
                            "supplied; actual arrival times may differ.",
                    ),
                "estimated" to jsonValue(estimated),
            ),
    )
}

/** Line headway seconds per slot from headways.json; a file without `slots` (before T2) has only the default. */
internal fun slotLineHeadways(headways: JsonObject): Map<TimeSlot, Map<String, Int>> {
    fun seconds(lines: JsonObject) =
        lines.mapValues {
            it.value.jsonObject
                .getValue("seconds")
                .jsonPrimitive.content
                .toInt()
        }
    val slots =
        headways["slots"]?.jsonObject
            ?: return mapOf(TimeSlot.DEFAULT to seconds(headways.getValue("lines").jsonObject))
    return TimeSlot.ALL.associateWith {
        seconds(
            slots
                .getValue(it.id)
                .jsonObject
                .getValue("lines")
                .jsonObject,
        )
    }
}
