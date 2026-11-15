package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Clock
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.moveTo
import kotlin.io.path.readText
import kotlin.io.path.writeText

internal const val SEOUL_STATIONS = "SearchInfoBySubwayNameService"
internal const val SEOUL_PAGE_ROWS = 1000
private const val SEOUL_BASE = "http://openapi.seoul.go.kr:8088"
private const val SEOUL_SOURCE = "https://data.seoul.go.kr/dataList/OA-101/A/1/datasetView.do"

/** 서울 열린데이터광장의 일별 호출 한도(ERROR-337) 또는 실행당 상한. 캐시는 받은 쪽을 모두 가진다. */
internal class SeoulQuotaExceeded : IllegalStateException("Seoul Open API traffic limit reached; rerun to resume")

internal fun seoulCache(root: Path): Path = root.resolve("data/raw/seoul")

/**
 * 디스크 캐시가 있는 서울 열린데이터광장 클라이언트(S2 역 목록, S5 역별 시간표). 키는 URL 경로에 들어가므로 HTTP 계층은
 * [JdkPipelineHttp](예외 메시지·원인 제거)를 쓰고, 오류 메시지에 응답 본문을 넣지 않는다. 쪽마다 검증한 뒤 `.partial`에 썼다가
 * 원자적으로 옮기고, 오류 응답은 캐시하지 않는다. 그래서 같은 명령을 다시 실행하면 이어받는다(TAGO와 같은 방식).
 */
internal class SeoulApi(
    private val key: String?,
    private val http: PipelineHttp,
    private val cache: Path,
    private val budget: Int = Int.MAX_VALUE,
) {
    var calls = 0
        private set

    fun stations(): List<JsonObject> = pages(SEOUL_STATIONS, "", "stations")

    /** [weekTag] 1 평일, 2 토요일, 3 휴일. [direction] 1 상행·내선, 2 하행·외선. */
    fun timetable(
        stationCode: String,
        weekTag: String,
        direction: String,
    ): List<JsonObject> {
        require(Regex("[0-9A-Z]{3,6}").matches(stationCode)) { "Unexpected Seoul station code" }
        require(weekTag in setOf("1", "2", "3") && direction in setOf("1", "2"))
        return pages(
            TIMETABLE_SERVICE,
            "$stationCode/$weekTag/$direction/",
            timetableName(stationCode, weekTag, direction),
        )
    }

    fun cached(
        stationCode: String,
        weekTag: String,
        direction: String,
    ): Boolean = cache.resolve("${timetableName(stationCode, weekTag, direction)}-p1.json").exists()

    private fun timetableName(
        stationCode: String,
        weekTag: String,
        direction: String,
    ) = "timetable/${stationCode.lowercase()}-$weekTag-$direction"

    private fun pages(
        service: String,
        parameters: String,
        name: String,
    ): List<JsonObject> {
        val rows = mutableListOf<JsonObject>()
        var start = 1
        do {
            val file = cache.resolve("$name-p$start.json")
            val text = if (file.exists()) file.readText() else download(file, service, parameters, start)
            val page = timetablePage(text, service)
            rows.addAll(page.rows)
            require(page.rows.isNotEmpty() || page.total == 0) { "Seoul API truncated page" }
            start += page.rows.size
        } while (rows.size < page.total)
        return rows
    }

    private fun download(
        file: Path,
        service: String,
        parameters: String,
        start: Int,
    ): String {
        val secret =
            requireNotNull(key?.takeIf { it.isNotBlank() }) { "SEOUL_OPENAPI_KEY is required to fill the cache" }
        if (calls >= budget) throw SeoulQuotaExceeded()
        calls++
        val url = "$SEOUL_BASE/$secret/json/$service/$start/${start + SEOUL_PAGE_ROWS - 1}/$parameters"
        val text = http.request(url, null).bytes.toString(Charsets.UTF_8)
        timetablePage(text, service) // 캐시 전에 검증한다. 오류는 캐시하지 않는다.
        file.parent.createDirectories()
        val partial = file.resolveSibling(file.fileName.toString() + ".partial")
        partial.writeText(text)
        partial.moveTo(file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        return text
    }
}

/** S3 범위(서울교통공사 1~8호선)의 (노선 번호, 정규 역명). S5 수집 범위를 정한다. TAGO 캐시는 읽지 않는다. */
private fun seoulScope(root: Path): Set<Pair<String, String>> {
    verifyRaw(root)
    val rules = NetworkRules(parseObject(root.resolve("data/config/network-rules.json").readText()))
    val runtime = csvBytes(root.resolve("data/raw/runtime.csv").toFile().readBytes()).drop(1)
    return runtime.map { it[1] to rules.canonical(it[2]) }.toSet()
}

private fun scopedStationCodes(
    api: SeoulApi,
    root: Path,
    names: Set<Pair<String, String>> = seoulScope(root),
): List<String> {
    val rules = NetworkRules(parseObject(root.resolve("data/config/network-rules.json").readText()))
    val codes =
        api
            .stations()
            .filter {
                val line =
                    it
                        .text("LINE_NUM")
                        .filter(Char::isDigit)
                        .toIntOrNull()
                        ?.toString()
                (line to rules.canonical(it.text("STATION_NM"))) in names
            }.map { it.text("STATION_CD") }
            .distinct()
            .sorted()
    require(codes.isNotEmpty()) { "No matching Seoul station codes" }
    return codes
}

/**
 * S5 캐시 채우기: S2 역 목록 → S3 범위 역마다 요일 유형 3개(평일·토·휴일) × 방향 2개. 받은 쪽은 다시 받지 않는다.
 * 한도·상한에 닿으면 종료코드 2, 끝나면 S5 영수증(source-manifest.json)을 쓰고 0.
 */
internal fun seoulFetch(
    root: Path,
    key: String? = System.getenv("SEOUL_OPENAPI_KEY"),
    http: PipelineHttp = JdkPipelineHttp(),
    budget: Int = 9_000,
    /** (line number, canonical name) to fetch; tests inject it instead of reading S3. */
    scope: () -> Set<Pair<String, String>> = { seoulScope(root) },
): Int {
    require(!key.isNullOrBlank()) { "SEOUL_OPENAPI_KEY is required for seoul-fetch; build/all read the cache" }
    val api = SeoulApi(key, http, seoulCache(root), budget)
    return try {
        val codes = scopedStationCodes(api, root, scope())
        val jobs =
            codes.flatMap { code ->
                DayType.entries.flatMap { day -> listOf("1", "2").map { Triple(code, day.seoulWeekTag, it) } }
            }
        val pending = jobs.count { (code, week, direction) -> !api.cached(code, week, direction) }
        println("Seoul S5 scope: ${codes.size} station codes, ${jobs.size} timetables, $pending not cached yet")
        var done = jobs.size - pending
        jobs.forEach { (code, week, direction) ->
            val wasCached = api.cached(code, week, direction)
            api.timetable(code, week, direction)
            if (!wasCached && ++done % 100 == 0) println("cached $done/${jobs.size} (calls ${api.calls})")
        }
        writeSeoulReceipt(root, codes)
        println("Seoul S5 cache complete: ${jobs.size} timetables; calls this run ${api.calls}; S5 receipt updated")
        0
    } catch (_: SeoulQuotaExceeded) {
        println("Seoul API limit reached after ${api.calls} calls. Rerun the same command to resume.")
        2
    }
}

private val seoulOffline =
    PipelineHttp { _, _ -> error("Seoul S5 cache incomplete; run seoul-fetch with SEOUL_OPENAPI_KEY") }

private fun seoulFiles(
    root: Path,
    codes: List<String>,
): List<Path> {
    val cache = seoulCache(root)

    fun listed(
        dir: Path,
        prefix: String,
    ) = dir
        .toFile()
        .listFiles { file -> file.name.startsWith(prefix) && file.name.endsWith(".json") }
        .orEmpty()
        .map { it.toPath() }
        .sorted()
    val timetables =
        codes.flatMap { code ->
            DayType.entries.flatMap { day ->
                listOf(
                    "1",
                    "2",
                ).flatMap { listed(cache.resolve("timetable"), "${code.lowercase()}-${day.seoulWeekTag}-$it-p") }
            }
        }
    return listed(cache, "stations-p") + timetables
}

private fun writeSeoulReceipt(
    root: Path,
    codes: List<String>,
    clock: Clock = Clock.systemUTC(),
) {
    val files = seoulFiles(root, codes)
    val digest = tagoDigest(root, files)
    val path = root.resolve("data/config/source-manifest.json")
    val receipts =
        kotlinx.serialization.json.Json
            .parseToJsonElement(path.readText())
            .jsonArray
            .map { it.jsonObject }
    if (receipts.firstOrNull { it.text("id") == "S5" }?.text("sha256") == digest) return
    val receipt =
        obj(
            "id" to "S5",
            "file" to "data/raw/seoul",
            "source_url" to "$SEOUL_SOURCE ($SEOUL_STATIONS, $TIMETABLE_SERVICE)",
            "request_body" to null,
            "fetched_at" to clock.instant().toString(),
            "sha256" to digest,
            "bytes" to files.sumOf { it.toFile().length() },
            "content_type" to "application/json",
            "rows" to files.size,
            "license" to "공공누리 제1유형 (서울교통공사, 서울 열린데이터광장 OA-101)",
            "effective_date" to
                "timetable revision date not supplied; WEEK_TAG 1 weekday, 2 Saturday, 3 Sunday/holiday",
            "estimated" to false,
        )
    path.writeJson(jsonValue(receipts.filter { it.text("id") != "S5" } + receipt).toString())
}

/** 캐시에서 S5 시간표 행을 읽는다(오프라인). 영수증 다이제스트가 다르면 실패한다. 요일 유형 → 행. */
internal fun readSeoulTimetables(root: Path): Map<DayType, List<JsonObject>> {
    val api = SeoulApi(null, seoulOffline, seoulCache(root))
    val codes = scopedStationCodes(api, root)
    val receipt =
        kotlinx.serialization.json.Json
            .parseToJsonElement(root.resolve("data/config/source-manifest.json").readText())
            .jsonArray
            .map { it.jsonObject }
            .firstOrNull { it.text("id") == "S5" }
    requireNotNull(receipt) { "S5 (Seoul timetable) receipt missing; run seoul-fetch" }
    require(receipt.text("sha256") == tagoDigest(root, seoulFiles(root, codes))) {
        "S5: Seoul timetable cache digest mismatch; run seoul-fetch"
    }
    return DayType.entries.associateWith { day ->
        codes.flatMap { code -> listOf("1", "2").flatMap { api.timetable(code, day.seoulWeekTag, it) } }
    }
}

/** `headways`: S5 캐시(오프라인)에서 구분별 서울교통공사 배차를 다시 계산해 headways.json에 쓴다. */
internal fun refreshHeadways(
    root: Path,
    clock: Clock = Clock.systemUTC(),
) {
    val rows = readSeoulTimetables(root)
    val config = root.resolve("data/config/headways.json")
    val receipt =
        kotlinx.serialization.json.Json
            .parseToJsonElement(root.resolve("data/config/source-manifest.json").readText())
            .jsonArray
            .map { it.jsonObject }
            .first { it.text("id") == "S5" }
    val updated = slotHeadways(parseObject(config.readText()), rows, receipt.text("fetched_at"))
    if (updated.toString() == parseObject(config.readText()).toString()) {
        println("Headways unchanged")
        return
    }
    config.writeJson(updated.toString())
    println("Updated slot headways from ${rows.values.sumOf { it.size }} S5 rows (${clock.instant()})")
}
