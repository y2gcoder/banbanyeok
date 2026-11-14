package app.banbanyeok.pipeline

import app.banbanyeok.schema.Sha256
import org.w3c.dom.Element
import java.io.ByteArrayInputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.Charset
import java.nio.file.Path
import java.time.Duration
import java.time.Instant
import java.util.zip.ZipInputStream
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.io.path.createDirectories
import kotlin.io.path.name
import kotlin.io.path.readBytes
import kotlin.io.path.readText
import kotlin.io.path.writeBytes
import kotlin.io.path.writeText

internal fun quote(value: String): String =
    "\"" +
        value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\r", "\\r")
            .replace("\n", "\\n")
            .replace("\t", "\\t") + "\""

internal fun strings(values: Collection<String>): String = values.joinToString(",", "[", "]", transform = ::quote)

internal fun duration(value: String): Int {
    require(Regex("[0-9]{2}:[0-5][0-9]").matches(value)) { "Invalid mm:ss: $value" }
    return value.substringBefore(':').toInt() * 60 + value.substringAfter(':').toInt()
}

internal fun csv(text: String): List<List<String>> {
    val rows = mutableListOf<List<String>>()
    var row = mutableListOf<String>()
    val cell = StringBuilder()
    var quoted = false
    var i = 0
    val input = text.removePrefix("\uFEFF")
    while (i < input.length) {
        val c = input[i++]
        when {
            c == '"' && quoted && i < input.length && input[i] == '"' -> {
                cell.append('"')
                i++
            }
            c == '"' -> quoted = !quoted
            c == ',' && !quoted -> {
                row.add(cell.toString().trim())
                cell.setLength(0)
            }
            c == '\n' && !quoted -> {
                row.add(cell.toString().trim())
                cell.setLength(0)
                if (row.any { it.isNotEmpty() }) rows.add(row)
                row = mutableListOf()
            }
            c != '\r' -> cell.append(c)
        }
    }
    require(!quoted) { "Unterminated CSV quote" }
    if (cell.isNotEmpty() || row.isNotEmpty()) {
        row.add(cell.toString().trim())
        rows.add(row)
    }
    return rows
}

private fun xml(bytes: ByteArray): Element {
    val factory = DocumentBuilderFactory.newInstance()
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "")
    factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "")
    return factory.newDocumentBuilder().parse(ByteArrayInputStream(bytes)).documentElement
}

private fun Element.elements(name: String): List<Element> {
    val nodes = getElementsByTagName(name)
    return (0 until nodes.length).map { nodes.item(it) as Element }
}

internal fun xlsx(bytes: ByteArray): List<List<String>> {
    val entries = mutableMapOf<String, ByteArray>()
    ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
        while (true) {
            val entry = zip.nextEntry ?: break
            if (entry.name in setOf("xl/sharedStrings.xml", "xl/worksheets/sheet1.xml")) {
                entries[entry.name] = zip.readNBytes(5_000_001)
                require(entries.getValue(entry.name).size <= 5_000_000) { "XLSX entry too large" }
            }
        }
    }
    val shared = xml(entries.getValue("xl/sharedStrings.xml")).elements("si").map { it.textContent }
    return xml(entries.getValue("xl/worksheets/sheet1.xml")).elements("row").map { row ->
        val cells = MutableList(15) { "" }
        row.elements("c").forEach { c ->
            val index = c.getAttribute("r").takeWhile { it.isLetter() }.fold(0) { n, letter -> n * 26 + letter.code - 64 } - 1
            if (index in cells.indices) {
                val value =
                    c
                        .elements("v")
                        .firstOrNull()
                        ?.textContent
                        .orEmpty()
                cells[index] = if (c.getAttribute("t") == "s") shared[value.toInt()] else value
            }
        }
        cells
    }
}

internal data class Source(
    val id: String,
    val file: String,
    val url: String,
    val form: String?,
    val license: String,
)

internal val sources =
    listOf(
        Source("S1", "kric.xlsx", "https://data.kric.go.kr/rips/dataset/download.file?type=filedata&id=32&operation=1", null, "이용허락범위 제한 없음 (data.go.kr/15013205)"),
        Source("S3", "runtime.csv", "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?useCache=false", "infId=OA-12034&seq=9&infSeq=1", "공공누리 제1유형 (OA-12034)"),
        Source("S4", "transfer.csv", "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?useCache=false", "infId=OA-13290&seq=8&infSeq=1", "공공누리 제1유형 (OA-13290)"),
    )

internal fun csvBytes(bytes: ByteArray): List<List<String>> {
    val utf = Charsets.UTF_8.newDecoder()
    val text =
        try {
            utf.decode(java.nio.ByteBuffer.wrap(bytes)).toString()
        } catch (_: java.nio.charset.CharacterCodingException) {
            bytes.toString(Charset.forName("MS949"))
        }
    return csv(text)
}

internal fun checkSource(
    source: Source,
    bytes: ByteArray,
    contentType: String,
): List<List<String>> {
    require(!contentType.lowercase().contains("html")) { "${source.id}: HTML response" }
    require(contentType.lowercase().let { it.contains("octet-stream") || it.contains("excel") || it.contains("spreadsheet") || it.contains("csv") || it.contains("text/plain") || it.contains("download") }) { "${source.id}: unexpected Content-Type $contentType" }
    val rows = if (source.id == "S1") xlsx(bytes) else csvBytes(bytes)
    val expected =
        when (source.id) {
            "S1" -> listOf("역번호", "역사명", "노선번호", "노선명")
            "S3" -> listOf("연번", "호선", "역명", "소요시간")
            else -> listOf("연번", "호선", "환승역명", "환승노선", "환승거리", "환승소요시간")
        }
    require(rows.size > 100 && rows.first().take(expected.size) == expected) { "${source.id}: schema/row count mismatch" }
    require(rows.drop(1).all { it.size == rows.first().size }) { "${source.id}: malformed row width" }
    if (source.id != "S1") rows.drop(1).forEach { duration(it[if (source.id == "S3") 3 else 5]) }
    return rows
}

internal fun fetch(root: Path) {
    val raw = root.resolve("data/raw").createDirectories()
    val client =
        HttpClient
            .newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .connectTimeout(Duration.ofSeconds(30))
            .build()
    val manifests =
        sources.map { source ->
            val request = HttpRequest.newBuilder(URI(source.url)).timeout(Duration.ofSeconds(90))
            if (source.form != null) request.header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(source.form)) else request.GET()
            val response = client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray())
            require(response.statusCode() == 200) { "${source.id}: HTTP ${response.statusCode()}" }
            val bytes = response.body()
            val type = response.headers().firstValue("Content-Type").orElse("")
            val rows = checkSource(source, bytes, type)
            raw.resolve(source.file).writeBytes(bytes)
            if (source.id == "S1") {
                val dates =
                    rows.drop(1).map { row ->
                        val normalized = normalizedSourceDate(row[14])
                        """{"sourceId":${quote("${row[11]}:${row[2]}:${row[0]}")},"rawDate":${quote(row[14])},"effective_date":${normalized?.let(::quote) ?: "null"},"dateQuarantined":${normalized == null}}"""
                    }
                root.resolve("data/config/source-dates.json").writeText(dates.joinToString(",\n", "[\n", "\n]\n"))
            }
            """{"id":${quote(source.id)},"file":${quote("data/raw/${source.file}")},"source_url":${quote(source.url)},"request_body":${source.form?.let(::quote) ?: "null"},"fetched_at":${quote(Instant.now().toString())},"sha256":${quote(Sha256.hex(bytes))},"bytes":${bytes.size},"content_type":${quote(type)},"rows":${rows.size - 1},"license":${quote(source.license)},"effective_date":${quote(
                when (source.id) {
                    "S1" -> "mixed row dates; see source-dates.json"
                    "S3" -> "2024-08-10"
                    else -> "2025-03-31"
                },
            )},"estimated":false}"""
        }
    root.resolve("data/config/source-manifest.json").writeText(manifests.joinToString(",\n", "[\n", "\n]\n"))
    println("Fetched and validated S1/S3/S4")
}

/** Build is offline except public spotchecks; raw bytes must match the successful fetch receipt. */
internal fun verifyRaw(root: Path) {
    val manifest = root.resolve("data/config/source-manifest.json").readText()
    sources.forEach { source ->
        val receipt = manifest.lineSequence().single { it.contains("\"id\":" + quote(source.id)) }
        val bytes = root.resolve("data/raw/${source.file}").readBytes()
        require(receipt.contains("\"sha256\":" + quote(Sha256.hex(bytes)))) { "${source.id}: raw SHA-256 mismatch; fetch again" }
        val type = Regex("\"content_type\":\"([^\"]+)\"").find(receipt)?.groupValues?.get(1) ?: error("Missing Content-Type receipt")
        checkSource(source, bytes, type)
    }
}

internal fun normalizedSourceDate(value: String): String? =
    try {
        val text = value.trim()
        when {
            Regex("[0-9]{8}").matches(text) ->
                java.time.LocalDate
                    .parse(text, java.time.format.DateTimeFormatter.BASIC_ISO_DATE)
                    .toString()
            Regex("[0-9]{5}").matches(text) ->
                java.time.LocalDate
                    .of(1899, 12, 30)
                    .plusDays(text.toLong())
                    .toString()
            else ->
                java.time.LocalDate
                    .parse(text)
                    .toString()
        }
    } catch (_: java.time.DateTimeException) {
        null
    }
