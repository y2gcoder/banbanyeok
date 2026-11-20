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
)

private class LtDayOutcome(
    val result: LtDayResult,
    val json: JsonObject,
    val passed: Boolean,
)

private fun ltDayOutcome(
    problem: LtProblem,
    day: DayType,
    rows: LtDayRows,
    bound: LtArrivalBound,
): LtDayOutcome {
    val trains = ltTrains(problem, rows)
    val result = ltDay(problem, day, trains)
    val later = ltLaterCells(result, ltDay(problem, day, trains, LtAllowance.WIDER))
    val hidden = ltHiddenNumbers(problem.families, rows.numbered, LOOP_LINES)
    val inconsistent = ltInconsistentCells(result)
    val beyond = bound.violations(result, trains)
    val kinds = result.cells.groupingBy { it.kind }.eachCount()
    return LtDayOutcome(
        result,
        obj(
            "trains" to trains.size,
            "cells" to
                JsonObject(
                    LastTrainKind.entries.associate { it.name.lowercase() to jsonValue(kinds[it.raw] ?: 0) },
                ),
            "hiddenNumbers" to hidden.json,
            "laterWithWiderAllowance" to later,
            "inconsistentCells" to inconsistent,
            "beyondLastArrival" to beyond,
        ),
        hidden.passed && later == 0 && inconsistent == 0 && beyond == 0,
    )
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
    val problem = ltProblem(net, input, candidates.candidates, config)
    val sources = LtSources(problem, config, input, readSeoulTimetables(root), net.origins)
    val bound = LtArrivalBound(net, problem)
    val outcomes = DayType.entries.associateWith { ltDayOutcome(problem, it, sources.rows(it), bound) }
    val official =
        ltOfficialReport(
            ltOfficialSamples(root.resolve("data/config/last-train-official.csv").readText()),
            problem,
            net.origins,
            outcomes.mapValues { it.value.result },
        )
    val unbacked = unbackedExact(config, official)
    val passed =
        outcomes.values.all { it.passed } && official.all { it.text("passed") == "true" } && unbacked.isEmpty()
    val asOf = ltAsOf(root)
    root
        .resolve("build/last-train")
        .createDirectories()
        .resolve("problem.json")
        .writeJson(
            JsonObject(
                ltProblemJson(problem) +
                    (
                        "allowed" to
                            JsonObject(
                                DayType.entries.associate { day ->
                                    day.id to
                                        obj(
                                            "seoulLines" to config.seoulLines.getValue(day).sorted(),
                                            "tagoGroups" to config.tagoGroups.getValue(day).sorted(),
                                        )
                                },
                            )
                    ),
            ).toString(),
        )
    return LtArtifact(
        ltTable(problem, net.registry.registryVersion, outcomes.mapValues { it.value.result }),
        asOf,
        obj(
            "model" to LT_MODEL,
            "asOf" to asOf,
            "passed" to passed,
            "days" to JsonObject(outcomes.entries.associate { it.key.id to it.value.json }),
            "official" to official,
            "exactWithoutPassingSample" to unbacked,
        ),
        passed,
    )
}
