package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.compileLastTrains
import app.banbanyeok.pipeline.lasttrain.input.readLastTrainInputs
import app.banbanyeok.pipeline.lasttrain.output.writeLastTrainReport
import app.banbanyeok.pipeline.lasttrain.output.writeOracleProblem
import app.banbanyeok.schema.DataSet

/**
 * The last-train table (lt.bin): read the timetables, compute, run the gates, write the report. The computation
 * itself is `lasttrain.compileLastTrains`, which touches no file.
 */
internal object LastTrainStage : ArtifactStage {
    override val name = "last-train"

    override fun build(
        context: StageContext,
        parts: ReleaseParts,
    ) {
        val started = System.nanoTime()
        val lastTrains =
            compileLastTrains(
                readLastTrainInputs(context.root, context.input),
                context.net,
                parts.candidates.candidates,
            )
        writeOracleProblem(context.root, lastTrains)
        writeLastTrainReport(context.root, lastTrains)
        println(
            "Last trains as of ${lastTrains.asOf}: computed and gated in " +
                "${(System.nanoTime() - started) / 1_000_000} ms; gates ${if (lastTrains.passed) "passed" else "FAILED"}",
        )
        require(lastTrains.passed) {
            "Last-train gate failed; no artifacts written. See data/config/last-train-report.json"
        }
        parts.lastTrains = lastTrains
    }

    override fun validate(
        context: StageContext,
        dataset: DataSet,
    ) {
        val lastTrains =
            compileLastTrains(
                readLastTrainInputs(context.root, context.input),
                context.net,
                dataset.candidates.candidates,
            )
        require(lastTrains.passed) { "Last-train gate failed" }
        require(lastTrains.table == loadDevLastTrains(context.root.resolve("data/artifacts/dev"), dataset)) {
            "Artifact last-train table differs from the current timetables; rebuild required"
        }
        require(
            lastTrains.asOf == dataset.manifest.lastTrainAsOf,
        ) { "Artifact last-train date differs; rebuild required" }
        require(lastTrains.partialDays == dataset.manifest.lastTrainPartialDays) {
            "Artifact last-train partial day types differ; rebuild required"
        }
    }
}
