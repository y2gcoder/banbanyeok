package app.banbanyeok.pipeline.lasttrain.output

import app.banbanyeok.pipeline.lasttrain.model.LtArtifact
import app.banbanyeok.pipeline.writeJson
import java.nio.file.Path
import kotlin.io.path.createDirectories

/** The report of the gates, the file the `build` command writes beside the artifacts and a human reads. */
internal fun writeLastTrainReport(
    root: Path,
    artifact: LtArtifact,
) {
    root.resolve("data/config/last-train-report.json").writeJson(artifact.report.toString())
}

/** The fixed inputs as computed, for the independent oracle (prototype/last_train.py compare): `build/last-train/problem.json`. */
internal fun writeOracleProblem(
    root: Path,
    artifact: LtArtifact,
) {
    root
        .resolve("build/last-train")
        .createDirectories()
        .resolve("problem.json")
        .writeJson(artifact.oracleProblem.toString())
}
