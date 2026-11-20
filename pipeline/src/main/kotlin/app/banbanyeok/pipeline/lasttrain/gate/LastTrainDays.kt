package app.banbanyeok.pipeline.lasttrain.gate

import app.banbanyeok.pipeline.jsonValue
import app.banbanyeok.pipeline.lasttrain.compute.LtSources
import app.banbanyeok.pipeline.lasttrain.compute.ltDay
import app.banbanyeok.pipeline.lasttrain.compute.ltEarlier
import app.banbanyeok.pipeline.lasttrain.compute.ltNumberedTrains
import app.banbanyeok.pipeline.lasttrain.compute.ltProvenTrains
import app.banbanyeok.pipeline.lasttrain.compute.ltRebuiltDirect
import app.banbanyeok.pipeline.lasttrain.compute.ltSecondTrains
import app.banbanyeok.pipeline.lasttrain.compute.ltTrains
import app.banbanyeok.pipeline.lasttrain.model.LtAllowance
import app.banbanyeok.pipeline.lasttrain.model.LtConfig
import app.banbanyeok.pipeline.lasttrain.model.LtDayResult
import app.banbanyeok.pipeline.lasttrain.model.LtDayRows
import app.banbanyeok.pipeline.lasttrain.model.LtDirect
import app.banbanyeok.pipeline.lasttrain.model.LtOfficialSample
import app.banbanyeok.pipeline.lasttrain.model.LtProblem
import app.banbanyeok.pipeline.lasttrain.model.LtProven
import app.banbanyeok.pipeline.lasttrain.model.LtTrain
import app.banbanyeok.pipeline.obj
import app.banbanyeok.pipeline.sources
import app.banbanyeok.pipeline.stationNamed
import app.banbanyeok.pipeline.text
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.schema.Station
import kotlinx.serialization.json.JsonObject

/** Loop lines: rebuilt from train numbers only, never from rows alone. */
private val LOOP_LINES = setOf("2")

internal class LtDayOutcome(
    val result: LtDayResult,
    val json: JsonObject,
    val passed: Boolean,
    /** Stations of the first numbered source that day (Seoul Metro's own sections), for the coverage counts. */
    val numberedStations: Set<String>,
    /** With rebuilding off: the last single rebuilt train of every cell, for the cell-by-cell comparison. */
    val rebuilt: List<LtDirect?> = emptyList(),
)

/** One source choice of a night with the gates that look at its own trains. */
private class LtVariant(
    val result: LtDayResult,
    val later: Int,
    val inconsistent: Int,
    val beyond: Int,
)

private fun ltVariant(
    problem: LtProblem,
    trains: List<LtTrain>,
    bound: LtArrivalBound,
): LtVariant {
    val result = ltDay(problem, trains)
    return LtVariant(
        result,
        ltLaterCells(result, ltDay(problem, trains, LtAllowance.WIDER)),
        ltInconsistentCells(result),
        bound.violations(result, trains),
    )
}

/**
 * Numbered Seoul Metro lines against the operator's train-coded file, pair by pair. A line whose every last direct
 * train is the same in both that day type is a confirmed line: its direct trains are published to the minute.
 */
private fun numberedChecks(
    day: DayType,
    sources: LtSources,
    rows: LtDayRows,
): Map<String, LtCrossCheck> =
    sources.comparedLines(day).associateWith { line ->
        ltCrossCheck(
            ltNumberedTrains(rows.numbered.filter { it.group == line }),
            ltNumberedTrains(sources.secondSource(day, line)),
        )
    }

private fun checksJson(checks: Map<String, LtCrossCheck>) = JsonObject(checks.toSortedMap().mapValues { it.value.json })

/** Gate counts of one day type in the report. Cell counts are added once the table is final. */
private fun gatesJson(
    trains: Int,
    hidden: LtHiddenCheck,
    confirmed: Set<String>,
    checks: Pair<Map<String, LtCrossCheck>, Map<String, LtCrossCheck>>,
    variants: List<LtVariant>,
) = mapOf(
    "trains" to jsonValue(trains),
    "hiddenNumbers" to hidden.json,
    "confirmedNumberedLines" to jsonValue(confirmed.sorted()),
    "secondSource" to obj("numberedLines" to checksJson(checks.first), "rebuiltFamilies" to checksJson(checks.second)),
    "laterWithWiderAllowance" to jsonValue(variants.sumOf { it.later }),
    "inconsistentCells" to jsonValue(variants.sumOf { it.inconsistent }),
    "beyondLastArrival" to jsonValue(variants.sumOf { it.beyond }),
)

private fun List<LtVariant>.clean() = all { it.later == 0 && it.inconsistent == 0 && it.beyond == 0 }

/**
 * One day type with rebuilding **off** (the default): every time comes from trains whose identity the source proves
 * (train numbers). Rebuilt trains are computed only to be compared with the operator's table cell by cell.
 */
private fun provenOutcome(
    problem: LtProblem,
    day: DayType,
    rows: LtDayRows,
    checks: Map<String, LtCrossCheck>,
    bound: LtArrivalBound,
): LtDayOutcome {
    val trains = ltProvenTrains(problem, day, rows)
    val variant = ltVariant(problem, trains, bound)
    val hidden = ltHiddenNumbers(problem.families, rows.numbered, LOOP_LINES)
    val confirmed = problem.exactNumbered[day].orEmpty()
    return LtDayOutcome(
        variant.result,
        JsonObject(gatesJson(trains.size, hidden, confirmed, checks to emptyMap(), listOf(variant))),
        hidden.passed && checks.values.all { it.maxLaterSeconds <= problem.sourceMargin } && listOf(variant).clean(),
        rows.numbered.map { it.code }.toSet(),
        ltRebuiltDirect(problem, day, rows),
    )
}

/**
 * One day type with rebuilding **on**: rebuilt trains give times too. Where the operator's file also covers a rebuilt
 * family the table is computed from both and the earlier answer kept.
 */
private fun rebuiltOutcome(
    problem: LtProblem,
    day: DayType,
    rows: LtDayRows,
    checks: Map<String, LtCrossCheck>,
    bound: LtArrivalBound,
): LtDayOutcome {
    val trains = ltTrains(problem, day, rows)
    val first = ltVariant(problem, trains, bound)
    val second = ltSecondTrains(problem, day, rows)?.let { ltVariant(problem, it, bound) }
    val variants = listOfNotNull(first, second)
    val result = if (second == null) first.result else ltEarlier(first.result, second.result)
    val hidden = ltHiddenNumbers(problem.families, rows.numbered, LOOP_LINES)
    // Rebuilt (unnumbered) families that the operator's file also covers: computed from both, compared here.
    val rebuilt =
        rows.second.groupBy { it.group }.mapValues { (family, stops) ->
            ltCrossCheck(trains.filter { it.group == family }, ltNumberedTrains(stops))
        }
    // No source may be later than the operator's file by more than the margin it is boarded early by.
    val withinMargin = (checks.values + rebuilt.values).all { it.maxLaterSeconds <= problem.sourceMargin }
    val changed = if (second == null) 0 else result.cells.indices.count { result.cells[it] != first.result.cells[it] }
    val confirmed = problem.exactNumbered[day].orEmpty()
    return LtDayOutcome(
        result,
        JsonObject(
            gatesJson(trains.size, hidden, confirmed, checks to rebuilt, variants) +
                ("cellsChangedBySecondSource" to jsonValue(changed)),
        ),
        hidden.passed && withinMargin && variants.clean(),
        rows.numbered.map { it.code }.toSet(),
    )
}

internal fun ltDayOutcome(
    base: LtProblem,
    day: DayType,
    sources: LtSources,
    bound: LtArrivalBound,
): Pair<LtDayOutcome, Set<String>> {
    val rows = sources.rows(day)
    val numbered = numberedChecks(day, sources, rows)
    val confirmed = numbered.filterValues { it.identical }.keys
    val problem = base.copy(exactNumbered = base.exactNumbered + (day to confirmed))
    val outcome =
        if (problem.rebuild) {
            rebuiltOutcome(problem, day, rows, numbered, bound)
        } else {
            provenOutcome(problem, day, rows, numbered, bound)
        }
    return outcome to confirmed
}

/**
 * The direct cells the operator's timetable confirms one by one: the samples that passed, of the unnumbered families
 * marked exact that day. Only these cells get a time from a rebuilt train while rebuilding is off.
 */
internal fun provenRides(
    samples: List<LtOfficialSample>,
    official: List<JsonObject>,
    config: LtConfig,
    origins: List<app.banbanyeok.schema.Station>,
): Map<DayType, List<LtProven>> =
    samples
        .zip(official)
        .filter { (sample, report) ->
            report.text("passed") == "true" &&
                sample.family in config.exact.getValue(sample.day)
        }.groupBy({ it.first.day }) { (sample, _) ->
            LtProven(
                stationNamed(origins, sample.home).code,
                stationNamed(origins, sample.meeting).code,
                sample.minute,
                stationNamed(origins, sample.bound).code,
                sample.family,
            )
        }

/** Cells with and without a time, split by whether both ends are stations of the first numbered source. */
private fun coverageJson(
    problem: LtProblem,
    result: LtDayResult,
    numberedStations: Set<String>,
): JsonObject {
    val width = problem.meetings.size
    val counts = mutableMapOf<Pair<Boolean, Int>, Int>()
    result.cells.forEachIndexed { index, cell ->
        val home = problem.homes[index / width]
        val meeting = problem.meetings[index % width]
        if (home !=
            meeting
        ) {
            counts.merge((home in numberedStations && meeting in numberedStations) to cell.kind, 1, Int::plus)
        }
    }

    fun scope(inside: Boolean) =
        JsonObject(LastTrainKind.entries.associate { it.name.lowercase() to jsonValue(counts[inside to it.raw] ?: 0) })
    return obj("bothOnNumberedLines" to scope(true), "other" to scope(false))
}

private fun cellsJson(result: LtDayResult): JsonObject {
    val kinds = result.cells.groupingBy { it.kind }.eachCount()
    return JsonObject(LastTrainKind.entries.associate { it.name.lowercase() to jsonValue(kinds[it.raw] ?: 0) })
}

/** Every family and day type marked exact in the config needs at least one passing official sample of its own. */
internal fun unbackedExact(
    config: LtConfig,
    official: List<JsonObject>,
): List<String> =
    config.exact.flatMap { (day, families) ->
        families
            .filter { family ->
                official.none { it.text("family") == family && it.text("day") == day.id && it.text("passed") == "true" }
            }.map { "$it/${day.id}" }
    }

/** The report of every day type: its gates, and the cell counts of the final table. */
internal fun daysJson(
    problem: LtProblem,
    outcomes: Map<DayType, LtDayOutcome>,
    results: Map<DayType, LtDayResult>,
): JsonObject {
    val numberedStations = outcomes.values.flatMap { it.numberedStations }.toSet()
    return JsonObject(
        outcomes.entries.associate { (day, outcome) ->
            val result = results.getValue(day)
            day.id to
                JsonObject(
                    outcome.json +
                        mapOf(
                            "cells" to cellsJson(result),
                            "coverage" to coverageJson(problem, result, numberedStations),
                            "provenDirectCells" to jsonValue(problem.proven[day].orEmpty().size),
                        ),
                )
        },
    )
}
