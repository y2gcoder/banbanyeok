package app.banbanyeok.pipeline.lasttrain

import app.banbanyeok.pipeline.Network
import app.banbanyeok.pipeline.lasttrain.compute.LtSources
import app.banbanyeok.pipeline.lasttrain.compute.ltFamilyDirect
import app.banbanyeok.pipeline.lasttrain.compute.ltProblemFromNetwork
import app.banbanyeok.pipeline.lasttrain.compute.ltTable
import app.banbanyeok.pipeline.lasttrain.compute.ltWithProvenDirect
import app.banbanyeok.pipeline.lasttrain.gate.LT_OPERATOR_MAX_AGE_DAYS
import app.banbanyeok.pipeline.lasttrain.gate.LtArrivalBound
import app.banbanyeok.pipeline.lasttrain.gate.daysJson
import app.banbanyeok.pipeline.lasttrain.gate.ltCeilingReport
import app.banbanyeok.pipeline.lasttrain.gate.ltDayOutcome
import app.banbanyeok.pipeline.lasttrain.gate.ltExactSwitches
import app.banbanyeok.pipeline.lasttrain.gate.ltOfficialReport
import app.banbanyeok.pipeline.lasttrain.gate.provenRides
import app.banbanyeok.pipeline.lasttrain.gate.unbackedExact
import app.banbanyeok.pipeline.lasttrain.model.LastTrainInputs
import app.banbanyeok.pipeline.lasttrain.model.LtArtifact
import app.banbanyeok.pipeline.lasttrain.model.LtConfig
import app.banbanyeok.pipeline.lasttrain.model.LtManifestFacts
import app.banbanyeok.pipeline.lasttrain.model.LtProblem
import app.banbanyeok.pipeline.lasttrain.model.ltModel
import app.banbanyeok.pipeline.lasttrain.model.ltProblemToJson
import app.banbanyeok.pipeline.obj
import app.banbanyeok.pipeline.sources
import app.banbanyeok.pipeline.text
import app.banbanyeok.schema.DayType
import kotlinx.serialization.json.JsonObject

/**
 * Computes the last-train table from [inputs] and runs its gates: no file is read or written here (the caller
 * reads the inputs with `readLastTrainInputs` and writes the report and the oracle problem). [candidates] are the
 * meeting stations (od.bin candidate axis).
 */
internal fun compileLastTrains(
    inputs: LastTrainInputs,
    net: Network,
    candidates: List<String>,
): LtArtifact {
    val config = inputs.config
    val base = ltProblemFromNetwork(net, inputs.pipeline, candidates, config)
    val sources = LtSources(base, config, inputs.pipeline, inputs.seoul, net.origins, inputs.official)
    val bound = LtArrivalBound(net, base)
    val computed = DayType.entries.associateWith { ltDayOutcome(base, it, sources, bound) }
    val outcomes = computed.mapValues { it.value.first }
    // The fixed inputs as computed: which numbered lines the comparison confirmed is part of them.
    val lines = base.copy(exactNumbered = computed.mapValues { it.value.second })
    val samples = inputs.checks.samples
    // Each sample is compared with the last single train of its own family in the cell, numbered or rebuilt.
    val official =
        ltOfficialReport(samples, lines, net.origins) { day, cell, family ->
            val outcome = outcomes.getValue(day)
            ltFamilyDirect(outcome.result, outcome.rebuilt, family, cell)
        }
    // An exact family-day whose samples fail, or whose operator pages are not of the TAGO cache's time, is switched
    // off (its cells fall back to the numbered sources) instead of stopping the build. Other samples must pass.
    val switches = ltExactSwitches(config, samples, official, inputs.checks)
    val off = switches.filterNot { it.on }.map { it.family to it.day }.toSet()
    val problem =
        if (lines.rebuild) lines else lines.copy(proven = provenRides(samples, official, config, net.origins, off))
    val results =
        outcomes.mapValues { (day, outcome) ->
            if (problem.rebuild) outcome.result else ltWithProvenDirect(problem, day, outcome.result, outcome.rebuilt)
        }
    val ceilings = ltCeilingReport(inputs.checks.ceilings, problem, net.origins, results)
    val unbacked = unbackedExact(config, samples)
    val binding =
        samples.zip(official).filter { (sample, _) -> sample.family !in config.exact.getValue(sample.day) }
    val passed =
        outcomes.values.all { it.passed } && binding.all { (_, report) -> report.text("passed") == "true" } &&
            unbacked.isEmpty() && ceilings.all { it.text("passed") == "true" }
    return LtArtifact(
        ltTable(problem, net.registry.registryVersion, results),
        LtManifestFacts(
            inputs.asOf,
            ltModel(problem.rebuild),
            config.partialDays.map { it.id }.ifEmpty { null },
        ),
        obj(
            "model" to ltModel(problem.rebuild),
            "asOf" to inputs.asOf,
            "passed" to passed,
            "rebuild" to problem.rebuild,
            "days" to daysJson(problem, outcomes, results),
            "sourceMarginSeconds" to problem.sourceMargin,
            "official" to official,
            "ceilings" to ceilings,
            "exactWithoutSample" to unbacked,
            "exactSwitches" to switches.map { it.json },
            "operatorReceipts" to operatorReceiptsJson(inputs),
            "partialDays" to config.partialDays.map { it.id },
        ),
        oracleProblemJson(problem, config),
        passed,
    )
}

/** The fixed inputs as computed, for the independent oracle: the problem file plus which lines each day type allows. */
private fun oracleProblemJson(
    problem: LtProblem,
    config: LtConfig,
): JsonObject {
    val allowed =
        DayType.entries.associate { day ->
            day.id to
                obj(
                    "seoulLines" to config.seoulLines.getValue(day).sorted(),
                    "tagoGroups" to config.tagoGroups.getValue(day).sorted(),
                    "secondSource" to (config.tagoGroups.getValue(day) intersect config.secondSourceLines).sorted(),
                )
        }
    return JsonObject(ltProblemToJson(problem) + ("allowed" to JsonObject(allowed)))
}

/** The dates the exact families were switched on or off by: their receipts and the TAGO cache's fetch date. */
private fun operatorReceiptsJson(inputs: LastTrainInputs): JsonObject =
    obj(
        "tagoFetchedOn" to inputs.checks.tagoFetchedOn,
        "maxDaysApart" to LT_OPERATOR_MAX_AGE_DAYS,
        "families" to
            JsonObject(
                inputs.checks.receipts.toSortedMap().mapValues { (_, receipt) ->
                    obj(
                        "receipt" to receipt.id,
                        "fetchedOn" to receipt.fetchedOn,
                        "latestTimetableChange" to receipt.latestChange,
                    )
                },
            ),
    )
