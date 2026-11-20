package app.banbanyeok.pipeline

import app.banbanyeok.schema.CandidateList
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.schema.StationCode
import kotlinx.serialization.json.JsonObject
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.readText

/** Loop lines: rebuilt from train numbers only, never from rows alone. */
private val LOOP_LINES = setOf("2")

/** The last-train table with what the manifest records about it and the evidence of its gates. */
internal class LtArtifact(
    val table: LastTrainTable,
    /** Oldest fetch date of the timetables used (Seoul date). */
    val asOf: String,
    val report: JsonObject,
    val passed: Boolean,
    /** Day types computed from some lines only (manifest `lastTrainPartialDays`); null when there is none. */
    val partialDays: List<String>? = null,
)

private class LtDayOutcome(
    val result: LtDayResult,
    val json: JsonObject,
    val passed: Boolean,
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

private fun ltDayOutcome(
    base: LtProblem,
    day: DayType,
    sources: LtSources,
    bound: LtArrivalBound,
): Pair<LtDayOutcome, Set<String>> {
    val rows = sources.rows(day)
    val numbered = numberedChecks(day, sources, rows)
    val confirmed = numbered.filterValues { it.identical }.keys
    val problem = base.copy(exactNumbered = base.exactNumbered + (day to confirmed))
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
    val withinMargin = (numbered.values + rebuilt.values).all { it.maxLaterSeconds <= problem.sourceMargin }
    val kinds = result.cells.groupingBy { it.kind }.eachCount()
    val outcome =
        LtDayOutcome(
            result,
            obj(
                "trains" to trains.size,
                "cells" to
                    JsonObject(
                        LastTrainKind.entries.associate { it.name.lowercase() to jsonValue(kinds[it.raw] ?: 0) },
                    ),
                "hiddenNumbers" to hidden.json,
                "confirmedNumberedLines" to confirmed.sorted(),
                "secondSource" to
                    obj(
                        "numberedLines" to checksJson(numbered),
                        "rebuiltFamilies" to checksJson(rebuilt),
                    ),
                "cellsChangedBySecondSource" to
                    if (second ==
                        null
                    ) {
                        0
                    } else {
                        result.cells.indices.count { result.cells[it] != first.result.cells[it] }
                    },
                "laterWithWiderAllowance" to variants.sumOf { it.later },
                "inconsistentCells" to variants.sumOf { it.inconsistent },
                "beyondLastArrival" to variants.sumOf { it.beyond },
            ),
            hidden.passed && withinMargin && variants.all { it.later == 0 && it.inconsistent == 0 && it.beyond == 0 },
        )
    return outcome to confirmed
}

/** Every family and day type marked exact in the config needs at least one passing official sample of its own. */
private fun unbackedExact(
    config: LtConfig,
    official: List<JsonObject>,
): List<String> =
    config.exact.flatMap { (day, families) ->
        families
            .filter { family ->
                official.none { it.text("family") == family && it.text("day") == day.id && it.text("passed") == "true" }
            }.map { "$it/${day.id}" }
    }

internal fun ltTable(
    problem: LtProblem,
    registryVersion: Int,
    results: Map<DayType, LtDayResult>,
): LastTrainTable {
    val cells = DayType.entries.flatMap { results.getValue(it).cells }
    return LastTrainTable(
        registryVersion,
        problem.homes.map { StationCode.parse(it).value }.toIntArray(),
        problem.meetings.map { StationCode.parse(it).value }.toIntArray(),
        cells.map { it.minute }.toIntArray(),
        cells.map { it.kind }.toIntArray(),
        cells.map { cell -> cell.bound?.let { StationCode.parse(it).value } ?: LastTrainTable.NONE }.toIntArray(),
    )
}

/** The fixed inputs as computed, for the independent oracle: `build/last-train/problem.json`. */
private fun writeOracleProblem(
    root: Path,
    problem: LtProblem,
    config: LtConfig,
) {
    val allowed =
        DayType.entries.associate { day ->
            day.id to
                obj(
                    "seoulLines" to config.seoulLines.getValue(day).sorted(),
                    "tagoGroups" to config.tagoGroups.getValue(day).sorted(),
                    "secondSource" to (config.tagoGroups.getValue(day) intersect config.secondSourceLines).sorted(),
                )
        }
    root
        .resolve("build/last-train")
        .createDirectories()
        .resolve("problem.json")
        .writeJson(JsonObject(ltProblemJson(problem) + ("allowed" to JsonObject(allowed))).toString())
}

/**
 * Computes the last-train table from the cached timetables (offline) and runs its gates. Also writes the fixed
 * inputs to `build/last-train/problem.json` for the independent oracle (prototype/last_train.py).
 */
internal fun buildLastTrains(
    root: Path,
    input: PipelineInput,
    net: Network,
    candidates: CandidateList,
): LtArtifact {
    val config = readLtConfig(root, input)
    val base = ltProblem(net, input, candidates.candidates, config)
    val sources =
        LtSources(base, config, input, readSeoulTimetables(root), net.origins, readOfficialTimetable(root))
    val bound = LtArrivalBound(net, base)
    val computed = DayType.entries.associateWith { ltDayOutcome(base, it, sources, bound) }
    val outcomes = computed.mapValues { it.value.first }
    // The fixed inputs as computed: which numbered lines the comparison confirmed is part of them.
    val problem = base.copy(exactNumbered = computed.mapValues { it.value.second })
    val ceilings =
        ltCeilingReport(
            ltCeilings(root.resolve("data/config/last-train-ceilings.csv").readText()),
            problem,
            net.origins,
            outcomes.mapValues { it.value.result },
        )
    val official =
        ltOfficialReport(
            ltOfficialSamples(root.resolve("data/config/last-train-official.csv").readText()),
            problem,
            net.origins,
            outcomes.mapValues { it.value.result },
        )
    val unbacked = unbackedExact(config, official)
    val passed =
        outcomes.values.all { it.passed } && official.all { it.text("passed") == "true" } && unbacked.isEmpty() &&
            ceilings.all { it.text("passed") == "true" }
    val asOf = ltAsOf(root)
    writeOracleProblem(root, problem, config)
    return LtArtifact(
        ltTable(problem, net.registry.registryVersion, outcomes.mapValues { it.value.result }),
        asOf,
        obj(
            "model" to LT_MODEL,
            "asOf" to asOf,
            "passed" to passed,
            "days" to JsonObject(outcomes.entries.associate { it.key.id to it.value.json }),
            "sourceMarginSeconds" to problem.sourceMargin,
            "official" to official,
            "ceilings" to ceilings,
            "exactWithoutPassingSample" to unbacked,
            "partialDays" to config.partialDays.map { it.id },
        ),
        passed,
        config.partialDays.map { it.id }.ifEmpty { null },
    )
}
