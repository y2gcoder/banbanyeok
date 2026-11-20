package app.banbanyeok.pipeline.lasttrain.input

import app.banbanyeok.pipeline.JdkPipelineHttp
import app.banbanyeok.pipeline.PipelineHttp
import app.banbanyeok.pipeline.csv
import app.banbanyeok.pipeline.csvBytes
import app.banbanyeok.pipeline.fetch
import app.banbanyeok.pipeline.jsonValue
import app.banbanyeok.pipeline.lasttrain.model.OfficialRow
import app.banbanyeok.pipeline.lasttrain.model.ltSeconds
import app.banbanyeok.pipeline.obj
import app.banbanyeok.pipeline.text
import app.banbanyeok.pipeline.writeJson
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.Sha256
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
import java.time.Clock
import kotlin.io.path.createDirectories
import kotlin.io.path.readBytes
import kotlin.io.path.readText
import kotlin.io.path.writeBytes

// S7: the operator's own timetable file with train codes (Seoul Metro, lines 1–9, all three day types). It is the
// second source of the last-train table: lines 1–8 must agree with S5 pair for pair, and line 9 is computed from
// both TAGO and this file with the earlier answer kept. No key is needed to download it.

internal const val OFFICIAL_ID = "S7"
internal const val OFFICIAL_FILE = "seoulmetro-timetable.csv"
internal const val OFFICIAL_URL =
    "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000007671122&fileDetailSn=1"

/** Reference date in the file's title on data.go.kr when it was last fetched; update it with the file. */
private const val OFFICIAL_REFERENCE = "2026-09-01 (서울교통공사_서울 도시철도 열차운행시각표_20260901, 수정일 2026-09-14)"
private val OFFICIAL_HEADER =
    listOf("고유번호", "호선", "역사코드", "역사명", "주중주말", "방향", "급행여부", "열차코드", "열차도착시간", "열차출발시간", "출발역", "도착역")
private const val OFFICIAL_NO_TIME = "00:00:00"

/** Seconds a row's arrival may lie after its departure before the file is refused (one row in the file: 35 s). */
private const val OFFICIAL_ROW_SLIP = 300
private val OFFICIAL_DAYS = mapOf("DAY" to DayType.WEEKDAY, "SAT" to DayType.SATURDAY, "END" to DayType.HOLIDAY)

/**
 * A time of the file in service-day seconds. **`00:00:00` is the file's mark for "no value"**, not midnight: the
 * arrival of a station an express only passes, the arrival of a first stop. Midnight itself is written `24:00:00`.
 * Read as midnight, a passed station would become a stop the train "arrives" at hours later.
 */
internal fun officialSeconds(text: String): Int = if (text.trim() == OFFICIAL_NO_TIME) -1 else ltSeconds(text)

/** One data row of the file (the fields of [OFFICIAL_HEADER]). */
internal fun officialRow(row: List<String>): OfficialRow {
    require(row.size == OFFICIAL_HEADER.size) { "$OFFICIAL_ID: malformed row width" }
    val arrival = officialSeconds(row[8])
    val departure = officialSeconds(row[9])
    // A row that arrives long after it leaves is not a stop of one train: the file's marks are not what we think
    // (a "no value" mark read as midnight looks exactly like this). Slips of under a minute do occur in the file.
    require(arrival < 0 || departure < 0 || arrival - departure <= OFFICIAL_ROW_SLIP) {
        "$OFFICIAL_ID: row ${row[0]} arrives after it leaves (${row[8]} > ${row[9]})"
    }
    return OfficialRow(
        row[1],
        row[3],
        requireNotNull(OFFICIAL_DAYS[row[4]]) { "$OFFICIAL_ID: unknown day type ${row[4]}" },
        listOf(row[1], row[4], row[5], row[7], row[10], row[11]).joinToString("|"),
        arrival,
        departure,
        row[11],
    )
}

internal fun officialRows(bytes: ByteArray): List<OfficialRow> {
    val rows = csvBytes(bytes)
    require(rows.size > 100_000 && rows.first() == OFFICIAL_HEADER) { "$OFFICIAL_ID: schema/row count mismatch" }
    return rows.drop(1).map(::officialRow)
}

private fun receipts(root: Path) =
    kotlinx.serialization.json.Json
        .parseToJsonElement(root.resolve("data/config/source-manifest.json").readText())
        .jsonArray
        .map { it.jsonObject }

/** `official-fetch`: downloads the file (no key), checks its shape and writes the S7 receipt. */
internal fun officialFetch(
    root: Path,
    http: PipelineHttp = JdkPipelineHttp(),
    clock: Clock = Clock.systemUTC(),
) {
    val response = http.request(OFFICIAL_URL, null)
    require(!response.contentType.lowercase().contains("html")) { "$OFFICIAL_ID: HTML response" }
    val rows = officialRows(response.bytes)
    root
        .resolve("data/raw")
        .createDirectories()
        .resolve(OFFICIAL_FILE)
        .writeBytes(response.bytes)
    val receipt =
        obj(
            "id" to OFFICIAL_ID,
            "file" to "data/raw/$OFFICIAL_FILE",
            "source_url" to OFFICIAL_URL,
            "request_body" to null,
            "fetched_at" to clock.instant().toString(),
            "sha256" to Sha256.hex(response.bytes),
            "bytes" to response.bytes.size,
            "content_type" to response.contentType,
            "rows" to rows.size,
            "license" to "이용허락범위 제한 없음 (서울교통공사, data.go.kr/15098251)",
            "effective_date" to OFFICIAL_REFERENCE,
            "estimated" to false,
        )
    root
        .resolve("data/config/source-manifest.json")
        .writeJson(jsonValue(receipts(root).filter { it.text("id") != OFFICIAL_ID } + receipt).toString())
    println("Fetched and validated $OFFICIAL_ID: ${rows.size} rows")
}

/** Offline read of the cached file; fails when it is not the file the S7 receipt describes. */
internal fun readOfficialTimetable(root: Path): List<OfficialRow> {
    val receipt =
        requireNotNull(receipts(root).firstOrNull { it.text("id") == OFFICIAL_ID }) {
            "$OFFICIAL_ID (operator timetable file) receipt missing; run official-fetch"
        }
    val bytes = root.resolve("data/raw/$OFFICIAL_FILE").readBytes()
    require(receipt.text("sha256") == Sha256.hex(bytes)) { "$OFFICIAL_ID: raw SHA-256 mismatch; run official-fetch" }
    return officialRows(bytes)
}
