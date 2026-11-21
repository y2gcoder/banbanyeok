package app.banbanyeok.pipeline.lasttrain.input

import app.banbanyeok.pipeline.PipelineInput
import app.banbanyeok.pipeline.csv
import app.banbanyeok.pipeline.lasttrain.model.LT_OPERATOR_LOCK
import app.banbanyeok.pipeline.lasttrain.model.LastTrainInputs
import app.banbanyeok.pipeline.lasttrain.model.LtBaselineFile
import app.banbanyeok.pipeline.lasttrain.model.LtCeiling
import app.banbanyeok.pipeline.lasttrain.model.LtConfig
import app.banbanyeok.pipeline.lasttrain.model.LtNoticeSeen
import app.banbanyeok.pipeline.lasttrain.model.LtOfficialSample
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorChecks
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorEvidence
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorReceipt
import app.banbanyeok.pipeline.lasttrain.model.ltSampleDigest
import app.banbanyeok.pipeline.parseObject
import app.banbanyeok.pipeline.readSeoulTimetables
import app.banbanyeok.pipeline.text
import app.banbanyeok.schema.DayType
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
import java.time.Instant
import java.time.ZoneId
import kotlin.io.path.exists
import kotlin.io.path.isRegularFile
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readBytes
import kotlin.io.path.readText

private val SEOUL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

internal fun readLtConfig(
    root: Path,
    input: PipelineInput,
): LtConfig =
    LtConfig(
        parseObject(root.resolve("data/config/last-train.json").readText()),
        input.tago
            ?.lines
            ?.groups
            ?.values
            .orEmpty()
            .toSet(),
    )

private fun receipts(root: Path) =
    kotlinx.serialization.json.Json
        .parseToJsonElement(root.resolve("data/config/source-manifest.json").readText())
        .jsonArray
        .map { it.jsonObject }

private fun seoulDate(instant: String): String =
    Instant
        .parse(instant)
        .atZone(SEOUL_ZONE)
        .toLocalDate()
        .toString()

/**
 * A field of a receipt the last-train table cannot do without. Missing, it **stops the build** with the receipt and
 * the field named: the fetch dates are what the table is dated by (120 days) and what switches exact families off.
 */
private fun required(
    receipt: kotlinx.serialization.json.JsonObject,
    key: String,
): String {
    val id = receipt["id"]?.toString()?.trim('"')
    val value = receipt[key]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
    require(!value.isNullOrBlank()) {
        "receipt $id in source-manifest.json has no $key; last trains cannot be dated, so nothing is published"
    }
    return value
}

/** The older of the two timetable caches' fetch dates (Seoul date): the day the last-train table is "as of". */
internal fun ltAsOf(root: Path): String =
    receipts(root)
        .filter { it.text("id") in setOf("S5", "S6", OFFICIAL_ID) }
        .also { require(it.size == 3) { "S5, S6 and $OFFICIAL_ID receipts are required for last trains" } }
        .map { required(it, "fetched_at") }
        .minBy(Instant::parse)
        .let(::seoulDate)

/** A text field of a receipt, null when it is missing or not a string. */
private fun field(
    receipt: kotlinx.serialization.json.JsonObject,
    key: String,
): String? = (receipt[key] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content

/**
 * The receipt of each exact family's operator timetable (`exact.<family>.receipt` in last-train.json), and the Seoul
 * date the TAGO cache (S6) was fetched. An operator receipt that is missing or lacks a date is not an error here: it
 * switches the family off (its evidence is checked in full by the gate). No S6 date stops the build.
 */
internal fun ltOperatorReceipts(
    root: Path,
    config: LtConfig,
): Pair<Map<String, LtOperatorReceipt>, String> {
    val all = receipts(root).associateBy { it.text("id") }
    val families =
        config.exactReceipts
            .mapNotNull { (family, id) ->
                val receipt = all[id] ?: return@mapNotNull null
                val fetched = field(receipt, "fetched_at")?.let { runCatching { seoulDate(it) }.getOrNull() }
                val change = field(receipt, "latest_timetable_change")
                if (fetched == null || change == null) return@mapNotNull null
                val newest =
                    (receipt["notices"] as? kotlinx.serialization.json.JsonArray)
                        ?.mapNotNull { it as? kotlinx.serialization.json.JsonObject }
                        ?.singleOrNull { it["newest"]?.toString() == "true" }
                        ?.let { notice ->
                            val no = field(notice, "viewNo")
                            val title = field(notice, "title")
                            val sha = field(notice, "sha256")
                            if (no == null || title == null || sha == null) null else LtNoticeSeen(no, title, sha)
                        }
                family to LtOperatorReceipt(id, fetched, change, newest)
            }.toMap()
    val tago = requireNotNull(all["S6"]) { "S6 (TAGO) receipt is required for last trains" }
    return families to seoulDate(required(tago, "fetched_at"))
}

/**
 * The operator evidence of each exact family, read as it is for the gate to check: its receipt, its baseline (and
 * the baseline file's SHA-256), its rows in the samples file, and the raw files when the raw folder is there.
 */
internal fun ltOperatorEvidence(
    root: Path,
    config: LtConfig,
): Map<String, LtOperatorEvidence> {
    val all = receipts(root).associateBy { it.text("id") }
    val samples = root.resolve("data/config/last-train-official.csv").readText()
    return config.exactReceipts.mapValues { (family, id) ->
        val path = config.exactBaselines.getValue(family)
        val file = root.resolve(path)
        val bytes = file.takeIf { it.exists() }?.readBytes()
        val shinbundang = id == SHINBUNDANG_ID
        val rawDir = root.resolve(SHINBUNDANG_DIR).takeIf { shinbundang && it.exists() }
        LtOperatorEvidence(
            all[id],
            LtBaselineFile(
                path,
                bytes?.let { runCatching { parseObject(String(it)) }.getOrNull() },
                bytes?.let(app.banbanyeok.schema.Sha256::hex),
            ),
            ltSampleDigest(samples, family),
            if (shinbundang) SHINBUNDANG_STATIONS.map { "$SHINBUNDANG_DIR/${it.first}.html" } else emptyList(),
            rawDir?.let { dir ->
                dir.listDirectoryEntries().filter { it.isRegularFile() }.associate { entry ->
                    "$SHINBUNDANG_DIR/${entry.name}" to
                        app.banbanyeok.schema.Sha256
                            .hex(entry.readBytes())
                }
            },
        )
    }
}

/**
 * A digest of every file the operator evidence is read from (the committed ones and the raw folder): a build
 * compares it before and after it computes, so that a sample or baseline run in between cannot go unnoticed.
 */
internal fun ltOperatorInputsDigest(root: Path): String {
    val committed =
        listOf("data/config/source-manifest.json", "data/config/last-train-official.csv", SHINBUNDANG_BASELINE)
            .map { root.resolve(it) }
    val raw =
        root
            .resolve(
                SHINBUNDANG_DIR,
            ).takeIf { it.exists() }
            ?.listDirectoryEntries()
            ?.sortedBy { it.name }
            .orEmpty()
    return app.banbanyeok.schema.Sha256.hex(
        (committed + raw)
            .joinToString("") { file ->
                "${file.name} ${if (file.exists()) {
                    app.banbanyeok.schema.Sha256
                        .hex(file.readBytes())
                } else {
                    "-"
                }}\n"
            }.toByteArray(),
    )
}

/** Whether a sample or baseline run holds the operator files' lock. */
internal fun ltOperatorRunInProgress(root: Path): Boolean = root.resolve(LT_OPERATOR_LOCK).exists()

/**
 * The newest notice a person reviewed for each exact family, from its baseline file (`exact.<family>.baseline`). A
 * missing file is not an error here: it switches the family off.
 */
internal fun ltReviewedNotices(
    root: Path,
    config: LtConfig,
): Map<String, LtNoticeSeen> =
    config.exactBaselines
        .mapNotNull { (family, path) ->
            root.resolve(path).takeIf { it.exists() }?.let { file ->
                val notice =
                    runCatching { parseObject(file.readText())["latestNotice"]?.jsonObject }.getOrNull()
                        ?: return@mapNotNull null
                val (no, title, sha) = listOf("viewNo", "title", "sha256").map { field(notice, it) }
                if (no == null || title == null || sha == null) return@mapNotNull null
                family to LtNoticeSeen(no, title, sha)
            }
        }.toMap()

/** Reads the configuration, both timetable caches, the operator's samples and ceilings, and the "as of" date. */
internal fun readLastTrainInputs(
    root: Path,
    input: PipelineInput,
): LastTrainInputs {
    val config = readLtConfig(root, input)
    val asOf = ltAsOf(root)
    val (operators, tago) = ltOperatorReceipts(root, config)
    return LastTrainInputs(
        config,
        input,
        readSeoulTimetables(root),
        readOfficialTimetable(root),
        LtOperatorChecks(
            ltOfficialSamples(root.resolve("data/config/last-train-official.csv").readText()),
            ltCeilings(root.resolve("data/config/last-train-ceilings.csv").readText()),
            operators,
            tago,
            ltReviewedNotices(root, config),
            ltOperatorEvidence(root, config),
        ),
        asOf,
    )
}

internal fun ltOfficialSamples(text: String): List<LtOfficialSample> =
    csv(text).drop(1).filter { it.any(String::isNotBlank) }.map { row ->
        require(row.size == 8) { "last-train-official.csv: meeting,home,day,time,bound,family,url,checkedAt" }
        val (hour, minute) = row[3].split(':').map(String::toInt)
        require(hour in 20..26 && minute in 0..59) { "last-train-official.csv: time ${row[3]} must be 20:00–26:59" }
        LtOfficialSample(
            row[0],
            row[1],
            requireNotNull(DayType.entries.firstOrNull { it.id == row[2] }) { "Unknown day type ${row[2]}" },
            hour * 60 + minute,
            row[4],
            row[5],
            row[6].also { require(it.startsWith("https://")) { "last-train-official.csv: source URL required" } },
            row[7],
        )
    }

internal fun ltCeilings(text: String): List<LtCeiling> =
    csv(text).drop(1).filter { it.any(String::isNotBlank) }.map { row ->
        require(row.size == 7) { "last-train-ceilings.csv: meeting,home,day,notAfter,url,checkedAt,note" }
        val (hour, minute) = row[3].split(':').map(String::toInt)
        LtCeiling(
            row[0],
            row[1],
            requireNotNull(DayType.entries.firstOrNull { it.id == row[2] }) { "Unknown day type ${row[2]}" },
            hour * 60 + minute,
            row[4].also { require(it.startsWith("https://")) { "last-train-ceilings.csv: source URL required" } },
            row[5],
        )
    }
