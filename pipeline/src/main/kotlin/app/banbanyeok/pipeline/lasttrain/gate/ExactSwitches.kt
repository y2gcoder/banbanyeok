package app.banbanyeok.pipeline.lasttrain.gate

import app.banbanyeok.pipeline.jsonValue
import app.banbanyeok.pipeline.lasttrain.model.LtConfig
import app.banbanyeok.pipeline.lasttrain.model.LtOfficialSample
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorChecks
import app.banbanyeok.pipeline.obj
import app.banbanyeok.pipeline.text
import app.banbanyeok.schema.DayType
import kotlinx.serialization.json.JsonObject
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Most days the operator's pages may lie from the TAGO cache (S6) they are compared with. Two sources that agree
 * prove the same timetable only when they were read at about the same time: the operator changed its timetable
 * twice in six weeks in 2026 (09-28, 11-06).
 */
internal const val LT_OPERATOR_MAX_AGE_DAYS = 14

/**
 * Whether one exact family gives confirmed direct cells on one day type, and why not. The family is switched off,
 * and its cells fall back to what the numbered sources give (a margin time or "unknown"), when
 *
 * - one of its samples that day fails: a sample that no longer matches means the timetable changed, so the other
 *   samples of that day cannot be trusted either;
 * - the operator's latest timetable change took effect after the TAGO cache was fetched: both sources may then
 *   agree on the old timetable;
 * - the operator's pages and the TAGO cache were fetched more than [LT_OPERATOR_MAX_AGE_DAYS] days apart;
 * - its samples were not read on the day its receipt says the pages were fetched, or there is no receipt.
 *
 * Nothing else is affected: the table is still published.
 */
internal class LtExactSwitch(
    val family: String,
    val day: DayType,
    val samples: Int,
    val failed: Int,
    val reasons: List<String>,
) {
    val on: Boolean get() = reasons.isEmpty()

    val json: JsonObject
        get() =
            obj(
                "family" to family,
                "day" to day.id,
                "on" to on,
                "samples" to samples,
                "failed" to failed,
                "reasons" to jsonValue(reasons),
            )
}

/** Reasons that switch [family] off on every day type: the dates of its receipt against the TAGO cache. */
private fun receiptReasons(
    family: String,
    samples: List<LtOfficialSample>,
    config: LtConfig,
    checks: LtOperatorChecks,
): List<String> {
    val id = config.exactReceipts[family]
    val receipt = checks.receipts[family]
    val tago = checks.tagoFetchedOn?.let(LocalDate::parse)
    if (receipt == null || receipt.id != id) return listOf("no receipt $id for the operator's timetable")
    if (tago == null) return listOf("the TAGO cache (S6) has no fetch date")
    val fetched = LocalDate.parse(receipt.fetchedOn)
    val change = LocalDate.parse(receipt.latestChange)
    val apart = kotlin.math.abs(ChronoUnit.DAYS.between(fetched, tago))
    val stale = samples.count { it.checkedAt != receipt.fetchedOn }
    return listOfNotNull(
        "the operator changed its timetable on $change, after TAGO was fetched on $tago".takeIf { change > tago },
        (
            "the operator's pages ($fetched) and TAGO ($tago) were fetched $apart days apart, " +
                "more than $LT_OPERATOR_MAX_AGE_DAYS"
        ).takeIf { apart > LT_OPERATOR_MAX_AGE_DAYS },
        "$stale samples were not read on ${receipt.fetchedOn}, the day receipt $id fetched the pages"
            .takeIf { stale > 0 },
    )
}

/**
 * The switch of every exact family and day type ([official] is the report of [samples], in the same order). A
 * family-day with no sample at all is not here: that is a mistake in the config ([unbackedExact]).
 */
internal fun ltExactSwitches(
    config: LtConfig,
    samples: List<LtOfficialSample>,
    official: List<JsonObject>,
    checks: LtOperatorChecks,
): List<LtExactSwitch> {
    val reports = samples.zip(official)
    return config.exact.flatMap { (day, families) ->
        families.sorted().mapNotNull { family ->
            val own = reports.filter { (sample, _) -> sample.family == family && sample.day == day }
            if (own.isEmpty()) return@mapNotNull null
            val failed = own.count { (_, report) -> report.text("passed") != "true" }
            val all = samples.filter { it.family == family }
            LtExactSwitch(
                family,
                day,
                own.size,
                failed,
                listOfNotNull("$failed of ${own.size} samples failed".takeIf { failed > 0 }) +
                    receiptReasons(family, all, config, checks),
            )
        }
    }
}
