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
    require(code in setOf("INFO-000", "INFO-200")) { "Seoul API schema/status failure" }
    if (code == "INFO-200") return TimetablePage(0, emptyList())
    requireNotNull(body) { "Seoul API missing service" }
    return TimetablePage(body.text("list_total_count").toInt(), body.getValue("row").jsonArray.map { it.jsonObject })
}

/** Intervals never cross stations, directions or branch patterns. Duplicate train rows count once. */
internal fun stationHeadways(rows: List<JsonObject>): List<JsonObject> =
    rows
        .filter { it.text("WEEK_TAG") == "1" && it.text("EXPRESS_YN") == "G" }
        .groupBy { listOf(it.text("LINE_NUM"), it.text("STATION_CD"), it.text("INOUT_TAG"), it.text("BRANCH_LINE")) }
        .mapNotNull { (key, trains) ->
            val times =
                trains
                    .distinctBy { it.text("TRAIN_NO") to it.text("LEFTTIME") }
                    .map { serviceSeconds(it.text("LEFTTIME")) }
                    .filter { it in 36000..57600 }
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

internal fun updatedHeadways(
    original: JsonObject,
    rows: List<JsonObject>,
    fetchedAt: String,
): JsonObject {
    val observations = stationHeadways(rows)
    val directions =
        observations.groupBy { it.text("line") to it.text("direction") }.map { (key, values) ->
            obj(
                "line" to key.first,
                "direction" to key.second,
                "seconds" to values.map { it.text("seconds").toInt() }.sorted().let { it[it.size / 2] },
                "stationPatternCount" to values.size,
            )
        }
    val lines =
        original.getValue("lines").jsonObject.mapValues { (line, fallback) ->
            val measured = directions.filter { it.text("line") == line }
            if (measured.size < 2) {
                fallback
            } else {
                val seconds = measured.map { it.text("seconds").toInt() }.average().roundToInt()
                require(seconds in 60..1800) { "Observed line headway outside supported range" }
                obj("seconds" to seconds, "estimated" to false)
            }
        }
    return JsonObject(
        original +
            mapOf(
                "lines" to JsonObject(lines),
                "directions" to jsonValue(directions),
                "observations" to jsonValue(observations),
                "fetched_at" to jsonValue(fetchedAt),
                "source_url" to
                    jsonValue(
                        "https://data.seoul.go.kr/dataList/OA-101/A/1/datasetView.do",
                    ),
                "period" to jsonValue("weekday 10:00:00–16:00:00 inclusive; timetable revision date not supplied"),
                "basis" to
                    jsonValue(
                        "Mean adjacent departure gaps per station/direction/branch; median station-pattern mean " +
                            "per line/direction; mean of directions for boarding wait. " +
                            "Regular trains only; <2 departures or missing direction keeps fallback; " +
                            "actual arrival times may differ.",
                    ),
                "estimated" to
                    jsonValue(
                        lines.values.any { it.jsonObject["estimated"]?.jsonPrimitive?.content != "false" },
                    ),
            ),
    )
}
