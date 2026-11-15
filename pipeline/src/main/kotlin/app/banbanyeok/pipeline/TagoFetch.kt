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
 * Resumable cache fill: station list (2 calls), then U/D timetables of every configured day type for every scoped
 * station (`dailyTypes` in tago-scope.json: 01 weekday, 02 Saturday, 03 Sunday/holiday).
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
        writeTagoReceipt(root)
        println("TAGO cache complete: ${jobs.size} timetables; calls this run ${api.calls}; S6 receipt updated")
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

private val tagoOffline =
    PipelineHttp { _, _ -> error("TAGO cache incomplete; run tago-fetch with TAGO_SERVICE_KEY") }

/** Scoped cache files in a fixed order; their combined digest is the S6 receipt. */
private fun tagoFiles(
    root: Path,
    ids: List<String>,
    days: List<String>,
): List<Path> {
    val cache = tagoCache(root)
    val stations =
        cache
            .resolve("stations")
            .toFile()
            .listFiles()
            .orEmpty()
            .map { it.toPath() }
    val list = stations.filter { it.fileName.toString().startsWith("all-p") }.sorted()
    val schedules =
        ids.flatMap { id ->
            days.flatMap { day ->
                listOf("u", "d").flatMap { direction ->
                    cache
                        .resolve("schedule")
                        .toFile()
                        .listFiles { file -> file.name.startsWith("${id.lowercase()}-$day-$direction-p") }
                        .orEmpty()
                        .map { it.toPath() }
                        .sorted()
                }
            }
        }
    return list + schedules
}

internal fun tagoDigest(
    root: Path,
    files: List<Path>,
): String =
    app.banbanyeok.schema.Sha256.hex(
        files
            .joinToString("") { file ->
                "${root.relativize(file)}\t${app.banbanyeok.schema.Sha256.hex(file.toFile().readBytes())}\n"
            }.toByteArray(),
    )

/** Writes/keeps the S6 receipt in source-manifest.json; fetched_at changes only when the cache content does. */
internal fun writeTagoReceipt(
    root: Path,
    clock: java.time.Clock = java.time.Clock.systemUTC(),
) {
    val scope = parseObject(root.resolve("data/config/tago-scope.json").readText())
    val api = TagoApi(null, tagoOffline, tagoCache(root))
    val ids = tagoScope(scope, api.stations(null)).map { it.text("subwayStationId") }
    val files = tagoFiles(root, ids, tagoDailyTypes(scope))
    val digest = tagoDigest(root, files)
    val path = root.resolve("data/config/source-manifest.json")
    val receipts =
        kotlinx.serialization.json.Json
            .parseToJsonElement(path.readText())
            .jsonArray
            .map { it.jsonObject }
    val old = receipts.firstOrNull { it.text("id") == "S6" }
    if (old?.text("sha256") == digest) return
    val receipt =
        obj(
            "id" to "S6",
            "file" to "data/raw/tago",
            "source_url" to "$TAGO_BASE ($TAGO_STATIONS, $TAGO_SCHEDULE)",
            "request_body" to null,
            "fetched_at" to clock.instant().toString(),
            "sha256" to digest,
            "bytes" to files.sumOf { it.toFile().length() },
            "content_type" to "application/json",
            "rows" to files.size,
            "license" to "이용허락범위 제한 없음 (data.go.kr/15098554)",
            "effective_date" to
                "timetable revision date not supplied; dailyTypeCode ${tagoDailyTypes(scope).joinToString("/")} " +
                "(01 weekday, 02 Saturday, 03 Sunday/holiday)",
            "estimated" to false,
        )
    path.writeJson(jsonValue(receipts.filter { it.text("id") != "S6" } + receipt).toString())
}

/** Offline read of the cached TAGO inputs; verifies the S6 receipt digest like verifyRaw does for S1/S3/S4. */
internal fun readTago(root: Path): TagoInput {
    val lines = MetroLines(parseObject(root.resolve("data/config/metro-lines.json").readText()))
    val scope = parseObject(root.resolve("data/config/tago-scope.json").readText())
    val api = TagoApi(null, tagoOffline, tagoCache(root))
    val list = api.stations(null)
    val scoped = tagoScope(scope, list).map { it.text("subwayStationId") }
    require(lines.stationIds.all { it in scoped }) { "metro-lines.json uses a TAGO station outside tago-scope.json" }
    val receipt =
        kotlinx.serialization.json.Json
            .parseToJsonElement(root.resolve("data/config/source-manifest.json").readText())
            .jsonArray
            .map { it.jsonObject }
            .firstOrNull { it.text("id") == "S6" }
    requireNotNull(receipt) { "S6 (TAGO) receipt missing; run tago-fetch" }
    val files = tagoFiles(root, scoped, tagoDailyTypes(scope))
    require(receipt.text("sha256") == tagoDigest(root, files)) { "S6: TAGO cache digest mismatch; run tago-fetch" }
    val days = tagoDailyTypes(scope)
    val timetables =
        DayType.entries.filter { it.tagoDailyType in days }.associateWith { day ->
            scoped.associateWith { id ->
                listOf("U", "D").associateWith { direction ->
                    api.schedule(id, day.tagoDailyType, direction).map(::tagoTrain)
                }
            }
        }
    return TagoInput(
        lines,
        list.associate { it.text("subwayStationId") to (it.text("subwayStationName") to it.text("subwayRouteName")) },
        timetables.getValue(DayType.WEEKDAY),
        timetables,
    )
}
