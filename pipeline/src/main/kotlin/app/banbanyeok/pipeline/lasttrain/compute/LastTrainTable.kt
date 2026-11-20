package app.banbanyeok.pipeline.lasttrain.compute

import app.banbanyeok.pipeline.lasttrain.model.LtDayResult
import app.banbanyeok.pipeline.lasttrain.model.LtProblem
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.schema.StationCode

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
