package app.banbanyeok.pipeline.lasttrain

import app.banbanyeok.pipeline.Network
import app.banbanyeok.pipeline.lasttrain.compute.LtSources
import app.banbanyeok.pipeline.lasttrain.compute.ltComparable
import app.banbanyeok.pipeline.lasttrain.compute.ltProblemFromNetwork
import app.banbanyeok.pipeline.lasttrain.compute.ltTable
import app.banbanyeok.pipeline.lasttrain.compute.ltWithProvenDirect
import app.banbanyeok.pipeline.lasttrain.gate.LtArrivalBound
import app.banbanyeok.pipeline.lasttrain.gate.daysJson
import app.banbanyeok.pipeline.lasttrain.gate.ltCeilingReport
import app.banbanyeok.pipeline.lasttrain.gate.ltDayOutcome
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
    // The operator's samples are compared with the last single train of each cell, numbered or rebuilt.
    val official =
        ltOfficialReport(
            samples,
            lines,
            net.origins,
            outcomes.mapValues { ltComparable(it.value.result, it.value.rebuilt) },
        )
    val problem =
        if (lines.rebuild) lines else lines.copy(proven = provenRides(samples, official, config, net.origins))
    val results =
        outcomes.mapValues { (day, outcome) ->
            if (problem.rebuild) outcome.result else ltWithProvenDirect(problem, day, outcome.result, outcome.rebuilt)
        }
    val ceilings = ltCeilingReport(inputs.checks.ceilings, problem, net.origins, results)
    val unbacked = unbackedExact(config, official)
    val passed =
        outcomes.values.all { it.passed } && official.all { it.text("passed") == "true" } && unbacked.isEmpty() &&
            ceilings.all { it.text("passed") == "true" }
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
            "exactWithoutPassingSample" to unbacked,
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
