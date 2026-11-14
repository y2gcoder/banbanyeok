package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
import java.time.Clock
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.writeText

internal class SeoulApi(
    private val key: String,
    private val http: PipelineHttp,
    private val raw: Path,
) {
    fun pages(
        service: String,
        parameters: String,
        cacheName: String,
    ): List<JsonObject> {
        val rows = mutableListOf<JsonObject>()
        var start = 1
        do {
            val file = raw.resolve("$cacheName-$start.json")
            val text =
                if (file.exists()) {
                    file.readText()
                } else {
                    val url = "http://openapi.seoul.go.kr:8088/$key/json/$service/$start/${start + 999}/$parameters"
                    val downloaded = http.request(url, null).bytes.toString(Charsets.UTF_8)
                    timetablePage(downloaded, service)
                    file.writeText(downloaded)
                    downloaded
                }
            val page = timetablePage(text, service)
            rows.addAll(page.rows)
            require(page.rows.isNotEmpty() || page.total == 0) { "Seoul API truncated page" }
            start += page.rows.size
        } while (rows.size < page.total)
        return rows
    }
}

internal fun refreshHeadways(
    root: Path,
    key: String? = System.getenv("SEOUL_OPENAPI_KEY"),
    http: PipelineHttp = JdkPipelineHttp(),
    clock: Clock = Clock.systemUTC(),
) {
    require(!key.isNullOrBlank()) {
        "SEOUL_OPENAPI_KEY is required for headways/refresh; build/all use configured estimates"
    }
    // Date-scoped cache contains raw responses only; delete this directory to force same-day refresh.
    val raw = root.resolve("data/raw/timetable-${clock.instant().toString().take(10)}").createDirectories()
    val api = SeoulApi(key, http, raw)
    val input = readInput(root)
    val names = input.runtime.map { it[1] to input.rules.canonical(it[2]) }.toSet()
    val stations =
        api
            .pages("SearchInfoBySubwayNameService", "", "stations")
            .filter {
                val line =
                    it
                        .text("LINE_NUM")
                        .filter(Char::isDigit)
                        .toIntOrNull()
                        ?.toString()
                (line to input.rules.canonical(it.text("STATION_NM"))) in names
            }.distinctBy { it.text("STATION_CD") }
    require(stations.isNotEmpty()) { "No matching Seoul station codes" }
    val rows =
        stations.flatMap { station ->
            listOf("1", "2").flatMap { direction ->
                api.pages(
                    TIMETABLE_SERVICE,
                    "${station.text("STATION_CD")}/1/$direction/",
                    "${station.text("STATION_CD")}-1-$direction",
                )
            }
        }
    val config = root.resolve("data/config/headways.json")
    val updated = updatedHeadways(parseObject(config.readText()), rows, clock.instant().toString())
    require(updated.getValue("observations").toString() != "[]") { "No offpeak timetable observations" }
    config.writeText(updated.toString())
    println("Updated timetable headways from ${stations.size} stations / ${rows.size} rows; raw responses in data/raw")
}
