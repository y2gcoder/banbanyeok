package app.banbanyeok.pipeline.lasttrain.model

import app.banbanyeok.schema.LastTrainTable
import kotlinx.serialization.json.JsonObject

/** What the manifest records about the table (`lastTrainAsOf`, `lastTrainModel`, `lastTrainPartialDays`). */
internal class LtManifestFacts(
    /** Oldest fetch date of the timetables used (Seoul date). */
    val asOf: String,
    /** Identifier of the rules used. */
    val model: String,
    /** Day types computed from some lines only; null when there is none. */
    val partialDays: List<String>?,
)

/** The last-train table with what the manifest records about it and the evidence of its gates. */
internal class LtArtifact(
    val table: LastTrainTable,
    val facts: LtManifestFacts,
    val report: JsonObject,
    /** The fixed inputs as computed, for the independent oracle (written to `build/last-train/problem.json`). */
    val oracleProblem: JsonObject,
    val passed: Boolean,
) {
    val asOf: String get() = facts.asOf
    val model: String get() = facts.model
    val partialDays: List<String>? get() = facts.partialDays
}
