package app.banbanyeok.pipeline.lasttrain.input

import app.banbanyeok.pipeline.PipelineInput
import app.banbanyeok.pipeline.csv
import app.banbanyeok.pipeline.lasttrain.model.LastTrainInputs
import app.banbanyeok.pipeline.lasttrain.model.LtCeiling
import app.banbanyeok.pipeline.lasttrain.model.LtConfig
import app.banbanyeok.pipeline.lasttrain.model.LtOfficialSample
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorChecks
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorReceipt
import app.banbanyeok.pipeline.parseObject
import app.banbanyeok.pipeline.readSeoulTimetables
import app.banbanyeok.pipeline.text
import app.banbanyeok.schema.DayType
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
import java.time.Instant
import java.time.ZoneId
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

/** The older of the two timetable caches' fetch dates (Seoul date): the day the last-train table is "as of". */
internal fun ltAsOf(root: Path): String =
    receipts(root)
        .filter { it.text("id") in setOf("S5", "S6", OFFICIAL_ID) }
        .also { require(it.size == 3) { "S5, S6 and $OFFICIAL_ID receipts are required for last trains" } }
        .minBy { Instant.parse(it.text("fetched_at")) }
        .let { seoulDate(it.text("fetched_at")) }

/**
 * The receipt of each exact family's operator timetable (`exact.<family>.receipt` in last-train.json), and the Seoul
 * date the TAGO cache (S6) was fetched. A missing receipt is not an error here: it switches the family off.
 */
internal fun ltOperatorReceipts(
    root: Path,
    config: LtConfig,
): Pair<Map<String, LtOperatorReceipt>, String?> {
    val all = receipts(root).associateBy { it.text("id") }
    val families =
        config.exactReceipts
            .mapNotNull { (family, id) ->
                all[id]?.let { receipt ->
                    family to
                        LtOperatorReceipt(
                            id,
                            seoulDate(receipt.text("fetched_at")),
                            receipt.text("latest_timetable_change"),
                        )
                }
            }.toMap()
    return families to all["S6"]?.let { seoulDate(it.text("fetched_at")) }
}

/** Reads the configuration, both timetable caches, the operator's samples and ceilings, and the "as of" date. */
internal fun readLastTrainInputs(
    root: Path,
    input: PipelineInput,
): LastTrainInputs {
    val config = readLtConfig(root, input)
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
        ),
        ltAsOf(root),
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
