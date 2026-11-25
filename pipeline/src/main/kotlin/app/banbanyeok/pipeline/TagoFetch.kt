package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.time.Clock
import kotlin.io.path.deleteIfExists
import kotlin.io.path.moveTo
import kotlin.io.path.readText
import kotlin.io.path.writeText

private fun tagoConfig(root: Path): JsonObject = parseObject(root.resolve("data/config/tago-scope.json").readText())

/** TAGO stations selected by the region’s route prefixes and exceptions, in list order. */
private fun tagoScope(
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

private fun tagoDailyTypes(scope: JsonObject): List<String> =
    scope.getValue("dailyTypes").jsonArray.map { it.jsonPrimitive.content }

/**
 * Resumable cache fill: station list (2 calls), then U/D timetables of every configured day type for every scoped
 * station (`dailyTypes` in tago-scope.json: 01 weekday, 02 Saturday, 03 Sunday/holiday).
 * Completed pages are never re-requested; quota exhaustion stops with exit status 2 so the next day resumes.
 */
internal fun tagoFetch(
    root: Path,
    region: TagoRegion = TagoRegion.CAPITAL,
    api: TagoApi = TagoApi(System.getenv("TAGO_SERVICE_KEY"), JdkPipelineHttp(), region.cache(root), budget = 9_000),
    clock: Clock = Clock.systemUTC(),
): Int {
    val config = tagoConfig(root)
    val days = tagoDailyTypes(config)
    val scope = region.scope(config)
    return try {
        val ids = tagoScope(scope, api.stations(null)).map { it.text("subwayStationId") }
        require(
            scope
                .getValue("routePrefixes")
                .jsonObject.keys
                .all { prefix -> ids.any { it.startsWith(prefix) } },
        ) {
            "${region.receiptId}: configured TAGO route missing from station list"
        }
        collectTagoSchedules(api, ids, days)
        writeTagoReceipt(root, region, ids, days, clock)
        println("TAGO calls this run: ${api.calls}; ${region.receiptId} receipt verified")
        0
    } catch (_: TagoQuotaExceeded) {
        println("TAGO quota/budget reached after ${api.calls} calls. Rerun to resume from the cache.")
        2
    }
}

private fun collectTagoSchedules(
    api: TagoApi,
    ids: List<String>,
    days: List<String>,
) {
    val jobs = ids.flatMap { id -> days.flatMap { day -> listOf("U", "D").map { Triple(id, day, it) } } }
    val pending = jobs.count { (id, day, direction) -> !api.cached(id, day, direction) }
    println("TAGO scope: ${ids.size} stations, ${jobs.size} timetables, $pending not cached yet")
    var done = jobs.size - pending
    jobs.forEach { (id, day, direction) ->
        val wasCached = api.cached(id, day, direction)
        api.schedule(id, day, direction)
        if (!wasCached && ++done % 100 == 0) println("cached $done/${jobs.size} (calls ${api.calls})")
    }
}

/** Small schema/coverage probe (at most 60 calls). Only fills the cache; prints no response bodies. */
internal fun tagoProbe(
    root: Path,
    key: String? = System.getenv("TAGO_SERVICE_KEY"),
    http: PipelineHttp = JdkPipelineHttp(),
) {
    val api = TagoApi(key, http, TagoRegion.CAPITAL.cache(root), budget = 60)
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

/** Scoped cache files in a fixed order; their combined digest identifies the regional TAGO receipt. */
private fun tagoFiles(
    cache: Path,
    ids: List<String>,
    days: List<String>,
): List<Path> {
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

/** The regional fetch date changes only when the region's own cache content changes. */
private fun writeTagoReceipt(
    root: Path,
    region: TagoRegion,
    ids: List<String>,
    days: List<String>,
    clock: Clock,
) {
    val files = tagoFiles(region.cache(root), ids, days)
    val digest = tagoDigest(root, files)
    val path = root.resolve("data/config/source-manifest.json")
    val receipt =
        obj(
            "id" to region.receiptId,
            "file" to region.cachePath,
            "source_url" to "$TAGO_BASE ($TAGO_STATIONS, $TAGO_SCHEDULE)",
            "request_body" to null,
            "fetched_at" to clock.instant().toString(),
            "sha256" to digest,
            "bytes" to files.sumOf { it.toFile().length() },
            "content_type" to "application/json",
            "rows" to files.size,
            "license" to "이용허락범위 제한 없음 (data.go.kr/15098554)",
            "effective_date" to
                "timetable revision date not supplied; dailyTypeCode ${days.joinToString("/")} " +
                "(01 weekday, 02 Saturday, 03 Sunday/holiday)",
            "estimated" to false,
        )
    val lock = root.resolve("data/raw/.tago-receipts.lock")
    FileChannel.open(lock, StandardOpenOption.CREATE, StandardOpenOption.WRITE).use { channel ->
        channel.lock().use { _ ->
            val receipts = Json.parseToJsonElement(path.readText()).jsonArray.map { it.jsonObject }
            val old = receipts.singleOrNull { it.text("id") == region.receiptId }
            if (old?.text("sha256") != digest) {
                replaceTagoManifest(path, receipts.filter { it.text("id") != region.receiptId } + receipt)
            }
        }
    }
}

private fun replaceTagoManifest(
    path: Path,
    receipts: List<JsonObject>,
) {
    val staged = Files.createTempFile(path.parent, ".tago-receipts-", ".json")
    try {
        staged.writeText(jsonText(jsonValue(receipts)))
        staged.moveTo(path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } finally {
        staged.deleteIfExists()
    }
}

/** Offline read of the cached TAGO inputs; verifies the S6 receipt digest like verifyRaw does for S1/S3/S4. */
internal fun readTago(root: Path): TagoInput {
    val lines = MetroLines(parseObject(root.resolve("data/config/metro-lines.json").readText()))
    val config = tagoConfig(root)
    val region = TagoRegion.CAPITAL
    val cache = region.cache(root)
    val api = TagoApi(null, tagoOffline, cache)
    val list = api.stations(null)
    val scoped = tagoScope(region.scope(config), list).map { it.text("subwayStationId") }
    require(lines.stationIds.all { it in scoped }) { "metro-lines.json uses a TAGO station outside tago-scope.json" }
    val receipt =
        Json
            .parseToJsonElement(root.resolve("data/config/source-manifest.json").readText())
            .jsonArray
            .map { it.jsonObject }
            .firstOrNull { it.text("id") == region.receiptId }
    requireNotNull(receipt) { "S6 (TAGO) receipt missing; run tago-fetch" }
    val days = tagoDailyTypes(config)
    val files = tagoFiles(cache, scoped, days)
    require(receipt.text("sha256") == tagoDigest(root, files)) { "S6: TAGO cache digest mismatch; run tago-fetch" }
    val raw =
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
        raw.getValue(DayType.WEEKDAY),
        weekendFallback(raw),
        raw,
    )
}

/**
 * TAGO leaves Saturday (02) empty for almost every operator (2026-11 cache: only 우이신설 has its own Saturday rows):
 * they run the Sunday/holiday timetable on Saturdays. A station whose Saturday rows are empty in both directions
 * therefore uses its 03 rows, and one whose 03 rows are empty uses 02. A station empty on both days stays empty
 * (the service headway is a median over stations, so it is just not counted).
 */
internal fun weekendFallback(raw: Map<DayType, TagoTimetable>): Map<DayType, TagoTimetable> {
    fun empty(station: Map<String, List<TagoTrain>>?) = station == null || station.values.all { it.isEmpty() }
    val saturday = raw[DayType.SATURDAY] ?: return raw
    val holiday = raw[DayType.HOLIDAY] ?: return raw

    fun filled(
        own: TagoTimetable,
        other: TagoTimetable,
    ): TagoTimetable =
        own.mapValues { (id, rows) ->
            if (empty(rows) &&
                !empty(other[id])
            ) {
                other.getValue(id)
            } else {
                rows
            }
        }
    return raw + mapOf(DayType.SATURDAY to filled(saturday, holiday), DayType.HOLIDAY to filled(holiday, saturday))
}
