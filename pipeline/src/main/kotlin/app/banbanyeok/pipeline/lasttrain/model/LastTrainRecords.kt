package app.banbanyeok.pipeline.lasttrain.model

import app.banbanyeok.schema.DayType

/** One stop of one train in the operator's file. Times are service-day seconds, -1 when the file has none. */
internal data class OfficialRow(
    val line: String,
    val station: String,
    val day: DayType,
    /** Unique within a day: line, direction, train code, first and last station. */
    val train: String,
    val arrival: Int,
    val departure: Int,
    val terminal: String,
)

/** One row of data/config/last-train-official.csv: a last direct train read from the operator's own timetable. */
internal data class LtOfficialSample(
    val meeting: String,
    val home: String,
    val day: DayType,
    /** Minute of the service day as the operator publishes it. */
    val minute: Int,
    val bound: String,
    val family: String,
    val url: String,
    val checkedAt: String,
)

/** One row of data/config/last-train-ceilings.csv: a cell that must never show a time later than the operator's. */
internal data class LtCeiling(
    val meeting: String,
    val home: String,
    val day: DayType,
    val notAfter: Int,
    val url: String,
    val checkedAt: String,
)

/** The operator's own published timetable as checks on the table: samples that must match and ceilings it must not pass. */
internal class LtOperatorChecks(
    val samples: List<LtOfficialSample>,
    val ceilings: List<LtCeiling>,
)
