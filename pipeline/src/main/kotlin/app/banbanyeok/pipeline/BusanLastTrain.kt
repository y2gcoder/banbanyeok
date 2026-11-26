package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainCell
import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.schema.StationCode
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.Locale

/*
 * Busan direct last trains (#180, ADR-0010). A check cell is (day type, line, meeting station, home station). Its time
 * comes only from a source we may compute with: B1's numbered trains for 1~4호선, TAGO's rows for 동해선. The operators'
 * tables (H1, K2) are only compared with, by `pipeline/busan/last_train.py checks`, which commits the source's value and
 * a verdict per cell. A cell is shown when its verdict is `agree`, this build computes the same value and its table's
 * evidence is current. Nothing here reads or changes the capital table.
 */

internal data class BusanLtKey(
    val day: DayType,
    val line: String,
    val meeting: String,
    val home: String,
)

/** A committed check: the source's value ("" when it has none) and the verdict against the operator's table. */
internal data class BusanLtCheck(
    val time: String,
    val destination: String,
    val verdict: String,
)

/** A line: the operator table that checks it, and the calculation source's day for each day type it is shown on. */
internal data class BusanLtLine(
    val table: String,
    val days: Map<DayType, String>,
)

/** An operator table a person reviewed (the file's SHA-256 and the day they saw it was the newest). */
internal data class BusanLtTable(
    val id: String,
    /** The receipt id of the calculation source its lines are computed from (B1 or S6-busan). */
    val source: String,
    val lines: List<String>,
    val sha256: String,
    val effectiveFrom: String,
    val reviewedOn: String,
)

internal data class BusanLtConfig(
    val checks: String,
    val tables: Map<String, BusanLtTable>,
    val lines: Map<String, BusanLtLine>,
)

/** The committed evidence: the config, the checks, the receipts, the checks file's digest and the TAGO fetch day. */
internal data class BusanLtEvidence(
    val config: BusanLtConfig,
    val checks: Map<BusanLtKey, BusanLtCheck>,
    val receipts: Map<String, JsonObject>,
    val checksSha256: String,
    val tagoFetchedOn: String,
)

/** The calculation side: the directs of each (line, day type), each line's stations in order, and the cells' axes. */
internal class BusanLtNetwork(
    val directs: (String, DayType) -> BusanLtDirects,
    val stations: (String) -> List<String>,
    /** Busan candidates. */
    val meetings: Set<String>,
    /** Busan OD origins. */
    val homes: Set<String>,
)

/** The Busan block: cells by (day type, home, meeting), and the report of every switch and verdict. */
internal class BusanLastTrains(
    val cells: Map<Triple<DayType, String, String>, LastTrainCell>,
    val report: JsonObject,
)

internal const val BUSAN_LT_CONFIG = "data/config/busan-last-train.json"
internal const val BUSAN_TAGO_RECEIPT = "S6-busan"
private const val B1_RECEIPT = "B1"
private val VERDICTS = setOf("agree", "differs", "origin", "missing", "ambiguous")

/** Same limit as the capital operator tables (`LT_OPERATOR_MAX_AGE_DAYS`): two sources agree only if read together. */
private const val OPERATOR_MAX_DAYS = 14
private val SHOWN_RANGE = 1200..1619

/** The later minute on screen wins (margin times are floored to ten minutes there), then the direct one. */
private val SHOWN_LATEST =
    compareBy<LastTrainCell>(
        { cell -> requireNotNull(cell.minute).let { if (cell.kind == LastTrainKind.DIRECT) it else it - it % 10 } },
        { it.kind == LastTrainKind.DIRECT },
    )

internal fun parseBusanLtConfig(config: JsonObject): BusanLtConfig {
    val tables =
        config.getValue("operatorTables").jsonObject.mapValues { (id, value) ->
            val rule = value.jsonObject
            val source = rule.text("source")
            require(source == B1_RECEIPT || source == BUSAN_TAGO_RECEIPT) { "Busan last train: $id has source $source" }
            BusanLtTable(
                id,
                source,
                rule.getValue("lines").jsonArray.map { it.jsonPrimitive.content },
                rule.text("sha256"),
                rule.text("effectiveFrom"),
                rule.text("reviewedOn"),
            )
        }
    val lines =
        config.getValue("lines").jsonObject.mapValues { (id, value) ->
            val rule = value.jsonObject
            val table = rule.text("check")
            require(id in tables.getValue(table).lines) { "Busan last train: $id is not a line of $table" }
            val days =
                rule.getValue("days").jsonObject.entries.associate { (day, sources) ->
                    DayType.entries.single { it.id == day } to sources.jsonObject.text("source")
                }
            BusanLtLine(table, days)
        }
    return BusanLtConfig(config.text("checks"), tables, lines)
}

internal fun readBusanLtChecks(text: String): Map<BusanLtKey, BusanLtCheck> {
    val rows = csv(text)
    require(rows.first() == listOf("day", "line", "meeting", "home", "time", "destination", "check")) {
        "busan-last-train-checks.csv header is invalid"
    }
    val checks =
        rows.drop(1).map { row ->
            require(row.size == 7 && row[6] in VERDICTS) { "busan-last-train-checks.csv: bad row $row" }
            BusanLtKey(DayType.entries.single { it.id == row[0] }, row[1], row[2], row[3]) to
                BusanLtCheck(row[4], row[5], row[6])
        }
    return checks.toMap().also { require(it.size == checks.size) { "busan-last-train-checks.csv repeats a cell" } }
}

private fun clock(seconds: Int) =
    String.format(
        Locale.ROOT,
        "%02d:%02d:%02d",
        seconds / 3600,
        seconds / 60 % 60,
        seconds % 60,
    )

/** Why [table]'s lines give no cell, by its receipt and dates against [asOf], the release's last-train date. */
internal fun busanLtTableReasons(
    table: BusanLtTable,
    evidence: BusanLtEvidence,
    asOf: String,
): List<String> {
    val receipt = evidence.receipts[table.id] ?: return listOf("no receipt ${table.id}; run last_train.py checks")
    val against =
        receipt["checked_against"]
            ?.jsonObject
            ?.get(table.source)
            ?.jsonPrimitive
            ?.content
    val reviewed = LocalDate.parse(table.reviewedOn)
    val effective = LocalDate.parse(table.effectiveFrom)
    val tago = LocalDate.parse(evidence.tagoFetchedOn).takeIf { table.source == BUSAN_TAGO_RECEIPT }
    return listOfNotNull(
        "receipt ${table.id} is of another file".takeIf { receipt.text("sha256") != table.sha256 },
        "the checks file changed after receipt ${table.id}".takeIf {
            receipt.text("checks_sha256") !=
                evidence.checksSha256
        },
        "${table.id} was not checked against the current ${table.source}".takeIf {
            against == null || against != evidence.receipts[table.source]?.text("sha256")
        },
        "${table.id} takes effect $effective, after it was reviewed on $reviewed".takeIf { effective > reviewed },
        "${table.id} was reviewed on $reviewed, before the last-train date $asOf".takeIf {
            reviewed <
                LocalDate.parse(asOf)
        },
        "${table.id} was reviewed on $reviewed and TAGO fetched on $tago, more than $OPERATOR_MAX_DAYS days apart"
            .takeIf { tago != null && kotlin.math.abs(ChronoUnit.DAYS.between(reviewed, tago)) > OPERATOR_MAX_DAYS },
        "${table.id} takes effect $effective, after TAGO was fetched on $tago".takeIf {
            tago != null && effective > tago
        },
    )
}

/**
 * The Busan block on [network]'s axes, dated [asOf] (the release's last-train date). With its table's switches on, the
 * computed value of every check cell must equal the committed one: both come from the receipted files, so a difference
 * is a bug in one of the two computations and stops the build.
 */
internal fun busanLastTrains(
    evidence: BusanLtEvidence,
    network: BusanLtNetwork,
    asOf: String,
): BusanLastTrains {
    val config = evidence.config
    val reasons = config.tables.mapValues { busanLtTableReasons(it.value, evidence, asOf) }
    val parts =
        config.lines.toSortedMap().flatMap { (line, rule) ->
            rule.days.map { (day, sourceDay) ->
                lineDay(
                    BusanLtKey(day, line, "", ""),
                    config.tables.getValue(rule.table),
                    reasons.getValue(rule.table),
                    evidence,
                    network,
                ).also { it.report["sourceDay"] = jsonValue(sourceDay) }
            }
        }
    require(evidence.checks.keys == parts.flatMap { it.keys }.toSet()) {
        "busan-last-train-checks.csv has cells the config does not; run last_train.py checks"
    }
    val cells =
        parts
            .flatMap { it.cells }
            .groupBy(
                { it.first },
                { it.second },
            ).mapValues { it.value.maxWith(SHOWN_LATEST) }
    return BusanLastTrains(
        cells,
        obj(
            "asOf" to asOf,
            "tables" to JsonObject(reasons.mapValues { (_, off) -> obj("on" to off.isEmpty(), "offReasons" to off) }),
            "lines" to parts.map { JsonObject(it.report) },
            "shownCells" to
                JsonObject(
                    DayType.entries.associate { day ->
                        day.id to jsonValue(cells.keys.count { it.first == day })
                    },
                ),
        ),
    )
}

private class BusanLtLineDay(
    val keys: List<BusanLtKey>,
    val cells: List<Pair<Triple<DayType, String, String>, LastTrainCell>>,
    val report: MutableMap<String, kotlinx.serialization.json.JsonElement>,
)

/** One (line, day type) of [at]: its check keys, its shown cells and its report line. */
private fun lineDay(
    at: BusanLtKey,
    table: BusanLtTable,
    off: List<String>,
    evidence: BusanLtEvidence,
    network: BusanLtNetwork,
): BusanLtLineDay {
    val stations = network.stations(at.line)
    val keys =
        stations.filter { it in network.meetings }.sorted().flatMap { meeting ->
            stations.filter { it != meeting }.sorted().map { at.copy(meeting = meeting, home = it) }
        }
    val checks = keys.associateWith { requireNotNull(evidence.checks[it]) { "busan-last-train-checks.csv lacks $it" } }
    val computed = if (off.isEmpty()) network.directs(at.line, at.day) else emptyMap()
    val cells =
        if (off.isEmpty()) {
            checks.mapNotNull { (key, check) ->
                shownCell(key, check, computed, table, network.homes)
            }
        } else {
            emptyList()
        }
    val verdicts =
        checks.values
            .groupingBy { it.verdict }
            .eachCount()
            .toSortedMap()
    val report =
        mutableMapOf(
            "line" to jsonValue(at.line),
            "day" to jsonValue(at.day.id),
            "checkedBy" to jsonValue(table.id),
            "verdicts" to JsonObject(verdicts.mapValues { jsonValue(it.value) }),
            "shownCells" to jsonValue(cells.size),
            "offReasons" to jsonValue(off),
        )
    return BusanLtLineDay(keys, cells, report)
}

/**
 * The lt cell of one check, or null. 1~4호선 give the arrival minute both sources agree on as a margin time (분류 3):
 * it is the planned lower bound, not the departure. 동해선 gives the departure minute both agree on to the second as
 * direct (분류 1).
 */
private fun shownCell(
    key: BusanLtKey,
    check: BusanLtCheck,
    computed: BusanLtDirects,
    table: BusanLtTable,
    homes: Set<String>,
): Pair<Triple<DayType, String, String>, LastTrainCell>? {
    val train = (computed[key.meeting to key.home] as? BusanLtDirect.Train)?.train
    require(check.time == train?.seconds?.let(::clock).orEmpty() && check.destination == train?.destination.orEmpty()) {
        "Busan last train $key: this build computed $train, the checks have ${check.time} ${check.destination}"
    }
    val agreed = train?.takeIf { check.verdict == "agree" && key.home in homes } ?: return null
    val minute = (agreed.seconds / 60).takeIf { it in SHOWN_RANGE } ?: return null
    val kind = if (table.source == BUSAN_TAGO_RECEIPT) LastTrainKind.DIRECT else LastTrainKind.MARGIN_DIRECT
    return Triple(key.day, key.home, key.meeting) to LastTrainCell(kind, minute, StationCode.parse(agreed.destination))
}
