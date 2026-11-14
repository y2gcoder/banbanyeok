package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.net.URLEncoder
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.moveTo
import kotlin.io.path.readText
import kotlin.io.path.writeText

internal const val TAGO_BASE = "https://apis.data.go.kr/1613000/SubwayInfo"
internal const val TAGO_STATIONS = "GetKwrdFndSubwaySttnList"
internal const val TAGO_SCHEDULE = "GetSubwaySttnAcctoSchdulList"
internal const val TAGO_PAGE_ROWS = 1000

/** Quota exhaustion is resumable: the cache keeps every completed page. */
internal class TagoQuotaExceeded : IllegalStateException("TAGO daily quota exhausted; rerun tomorrow to resume")

internal data class TagoPage(
    val total: Int,
    val items: List<JsonObject>,
)

/** Parses the data.go.kr JSON envelope. Never echoes the body: gateway errors can repeat request parameters. */
internal fun tagoPage(text: String): TagoPage {
    if (text.contains("LIMITED_NUMBER_OF_SERVICE_REQUESTS")) throw TagoQuotaExceeded()
    val envelope =
        try {
            parseObject(text)
        } catch (_: IllegalArgumentException) {
            error("TAGO response is not JSON (gateway error; body withheld)")
        }
    val response = envelope["response"]?.jsonObject ?: error("TAGO response envelope missing")
    val code = response["header"]?.jsonObject?.get("resultCode")?.let { (it as? JsonPrimitive)?.content }
    if (code == "22") throw TagoQuotaExceeded()
    require(code == "00") { "TAGO resultCode $code" }
    val body = response.getValue("body").jsonObject
    val total = body.text("totalCount").toInt()
    // An empty result is `"items": ""`; a single item may be an object instead of an array.
    val items =
        when (val item = (body["items"] as? JsonObject)?.get("item")) {
            null -> emptyList()
            is JsonArray -> item.map { it.jsonObject }
            is JsonObject -> listOf(item)
            else -> error("TAGO items malformed")
        }
    return TagoPage(total, items)
}

/** data.go.kr issues both a URL-encoded and a decoded key; accept either without double encoding. */
internal fun tagoKeyParameter(key: String): String = if ('%' in key) key else URLEncoder.encode(key, Charsets.UTF_8)

/**
 * Disk-cached TAGO client. Cache paths use lowercase fixed directory names (no operation-name casing)
 * and hex-encoded keyword names, so case-insensitive and Unicode-normalizing file systems agree.
 */
internal class TagoApi(
    private val key: String?,
    private val http: PipelineHttp,
    private val cache: Path,
    private val budget: Int = Int.MAX_VALUE,
) {
    var calls = 0
        private set

    fun stations(keyword: String?): List<JsonObject> {
        val name = keyword?.let { "kw-" + it.toByteArray().joinToString("") { b -> "%02x".format(b) } } ?: "all"
        val parameters = keyword?.let { "&subwayStationName=" + URLEncoder.encode(it, Charsets.UTF_8) }.orEmpty()
        return pages(cache.resolve("stations"), name, TAGO_STATIONS, parameters)
    }

    fun schedule(
        stationId: String,
        day: String,
        direction: String,
    ): List<JsonObject> {
        require(Regex("[A-Z0-9-]{4,20}").matches(stationId)) { "Unexpected TAGO station id" }
        require(day in setOf("01", "02", "03") && direction in setOf("U", "D"))
        return pages(
            cache.resolve("schedule"),
            "${stationId.lowercase()}-$day-${direction.lowercase()}",
            TAGO_SCHEDULE,
            "&subwayStationId=$stationId&dailyTypeCode=$day&upDownTypeCode=$direction",
        )
    }

    fun cached(
        stationId: String,
        day: String,
        direction: String,
    ): Boolean = cache.resolve("schedule/${stationId.lowercase()}-$day-${direction.lowercase()}-p1.json").exists()

    private fun pages(
        dir: Path,
        name: String,
        operation: String,
        parameters: String,
    ): List<JsonObject> {
        dir.createDirectories()
        val items = mutableListOf<JsonObject>()
        var page = 1
        do {
            val file = dir.resolve("$name-p$page.json")
            val text = if (file.exists()) file.readText() else download(file, operation, parameters, page)
            val parsed = tagoPage(text)
            items.addAll(parsed.items)
            require(parsed.items.isNotEmpty() || items.size >= parsed.total) { "TAGO truncated page" }
            page++
        } while (items.size < parsed.total)
        return items
    }

    private fun download(
        file: Path,
        operation: String,
        parameters: String,
        page: Int,
    ): String {
        val secret =
            requireNotNull(key?.takeIf { it.isNotBlank() }) { "TAGO_SERVICE_KEY is required to fill the cache" }
        if (calls >= budget) throw TagoQuotaExceeded()
        calls++
        val url =
            "$TAGO_BASE/$operation?serviceKey=${tagoKeyParameter(secret)}&_type=json" +
                "&numOfRows=$TAGO_PAGE_ROWS&pageNo=$page$parameters"
        val text = http.request(url, null).bytes.toString(Charsets.UTF_8)
        tagoPage(text) // validate before caching; errors are never cached
        val partial = file.resolveSibling(file.fileName.toString() + ".partial")
        partial.writeText(text)
        partial.moveTo(file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        return text
    }
}
