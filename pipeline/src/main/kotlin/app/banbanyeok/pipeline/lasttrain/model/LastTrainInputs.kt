package app.banbanyeok.pipeline.lasttrain.model

import app.banbanyeok.pipeline.PipelineInput
import app.banbanyeok.schema.DayType
import kotlinx.serialization.json.JsonObject

/**
 * Everything the last-train computation reads, already read: the configuration, the timetables of both sources,
 * the operator's samples and ceilings, and the date the timetables are as of. The computation takes these and
 * touches no file ([readLastTrainInputs] in the input package is the one place that reads them).
 */
internal class LastTrainInputs(
    val config: LtConfig,
    /** The travel network's inputs: station records, naming rules and the TAGO rows (no train numbers). */
    val pipeline: PipelineInput,
    /** S5 rows per day type (Seoul Metro, train numbers). */
    val seoul: Map<DayType, List<JsonObject>>,
    /** Rows of the operator's train-coded file (S7). */
    val official: List<OfficialRow>,
    val checks: LtOperatorChecks,
    /** Oldest fetch date of the timetables used (Seoul date). */
    val asOf: String,
)
