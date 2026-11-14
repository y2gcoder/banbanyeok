package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path
import kotlin.io.path.readText

internal fun tagoCache(root: Path): Path = root.resolve("data/raw/tago")

/** Metropolitan TAGO station ids selected by route prefix (config), in list order. */
internal fun tagoScope(
    scope: JsonObject,
    stations: List<JsonObject>,
): List<JsonObject> {
    val prefixes = scope.getValue("routePrefixes").jsonObject.keys
    val extra = scope.getValue("extraStations").jsonObject.keys
    val excluded = scope.getValue("excludedStations").jsonObject.keys
    val selected =
        stations.filter { station ->
            val id = station.text("subwayStationId")
            (prefixes.any { id.startsWith(it) } || id in extra) && id !in excluded
        }
    val ids = selected.map { it.text("subwayStationId") }
    require(ids.size == ids.distinct().size) { "Duplicate TAGO station ids in scope" }
    require(extra.all { it in ids }) { "Configured TAGO junction station missing from station list" }
    return selected
}

internal fun tagoDailyTypes(scope: JsonObject): List<String> =
    scope.getValue("dailyTypes").jsonArray.map { it.jsonPrimitive.content }

/**
 * Resumable cache fill: station list (2 calls), then weekday U/D timetables for every scoped station.
 * Completed pages are never re-requested; quota exhaustion stops with exit status 2 so the next day resumes.
 */
internal fun tagoFetch(
    root: Path,
    key: String? = System.getenv("TAGO_SERVICE_KEY"),
    http: PipelineHttp = JdkPipelineHttp(),
    budget: Int = 9_000,
): Int {
    val api = TagoApi(key, http, tagoCache(root), budget)
    val scope = parseObject(root.resolve("data/config/tago-scope.json").readText())
    val stations = tagoScope(scope, api.stations(null))
    val jobs =
        stations.flatMap { station ->
            tagoDailyTypes(scope).flatMap { day ->
                listOf("U", "D").map { Triple(station.text("subwayStationId"), day, it) }
            }
        }
    val pending = jobs.count { (id, day, direction) -> !api.cached(id, day, direction) }
    println("TAGO scope: ${stations.size} stations, ${jobs.size} timetables, $pending not cached yet")
    var done = jobs.size - pending
    return try {
        jobs.forEach { (id, day, direction) ->
            val wasCached = api.cached(id, day, direction)
            api.schedule(id, day, direction)
            if (!wasCached && ++done % 100 == 0) println("cached $done/${jobs.size} (calls ${api.calls})")
        }
        println("TAGO cache complete: ${jobs.size} timetables; calls this run ${api.calls}")
        0
    } catch (_: TagoQuotaExceeded) {
        println("TAGO quota/budget reached after ${api.calls} calls; cached $done/${jobs.size}. Rerun to resume.")
        2
    }
}

/** Small schema/coverage probe (at most 60 calls). Only fills the cache; prints no response bodies. */
internal fun tagoProbe(
    root: Path,
    key: String? = System.getenv("TAGO_SERVICE_KEY"),
    http: PipelineHttp = JdkPipelineHttp(),
) {
    val api = TagoApi(key, http, tagoCache(root), budget = 60)
    val all = runCatching { api.stations(null) }
    println("keyword-less list: ${all.map { "${it.size} items" }.getOrElse { "failed (${it.message})" }}")
    val names = setOf("서울", "판교", "대곡")
    val sample =
        names.flatMap { api.stations(it) }.filter {
            it.text("subwayStationName").substringBefore('(').removeSuffix("역") in names
        }
    sample
        .map { it.text("subwayRouteName") }
        .distinct()
        .sorted()
        .forEach { println("route: $it") }
    sample.forEach { station ->
        listOf("U", "D").forEach { direction ->
            val rows = api.schedule(station.text("subwayStationId"), "01", direction)
            println("${station.text("subwayStationId")} 01 $direction: ${rows.size} rows")
        }
    }
    println("TAGO calls this run: ${api.calls}; raw pages cached under data/raw/tago")
}
