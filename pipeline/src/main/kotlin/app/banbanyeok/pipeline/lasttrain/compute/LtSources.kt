package app.banbanyeok.pipeline.lasttrain.compute

import app.banbanyeok.pipeline.PipelineInput
import app.banbanyeok.pipeline.lasttrain.model.LT_DAY_END
import app.banbanyeok.pipeline.lasttrain.model.LtConfig
import app.banbanyeok.pipeline.lasttrain.model.LtDayRows
import app.banbanyeok.pipeline.lasttrain.model.LtNumberedStop
import app.banbanyeok.pipeline.lasttrain.model.LtProblem
import app.banbanyeok.pipeline.lasttrain.model.LtRow
import app.banbanyeok.pipeline.lasttrain.model.OfficialRow
import app.banbanyeok.pipeline.lasttrain.model.SEOUL_LINES
import app.banbanyeok.pipeline.lasttrain.model.ltSeconds
import app.banbanyeok.pipeline.sources
import app.banbanyeok.pipeline.text
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.Station
import kotlinx.serialization.json.JsonObject

/** Timetable rows of every day type, cut down to the lines the config allows on that day type. */
internal class LtSources(
    private val problem: LtProblem,
    private val config: LtConfig,
    private val input: PipelineInput,
    /** S5 rows per day type ([readSeoulTimetables]). */
    private val seoul: Map<DayType, List<JsonObject>>,
    /** Stations of the travel network (active, on the home axis). */
    private val stations: List<Station>,
    /** Rows of the operator's train-coded file ([readOfficialTimetable]). */
    official: List<OfficialRow> = emptyList(),
) {
    private val official = official.filter { it.line in config.secondSourceLines }.groupBy { it.day to it.line }
    private val officialCodes = mutableMapOf<Pair<String, String>, String?>()

    private val records =
        input.records.filter { it.operator == "서울교통공사" && it.line in SEOUL_LINES.map { n -> "${n}호선" } }
    private val codes = mutableMapOf<Pair<String, String>, String>()
    private val terminals = mutableMapOf<Pair<String, String>, String?>()

    fun rows(day: DayType): LtDayRows {
        val tago =
            input.tago
                ?.raw
                ?.get(day)
                .orEmpty()
        val groups = config.tagoGroups.getValue(day)
        val unnumbered =
            problem.stations
                .filterValues { it.group in groups }
                .keys
                .associateWith { id ->
                    tago[id].orEmpty().values.flatten().map {
                        LtRow(day(it.arrival), day(it.departure), it.end.orEmpty())
                    }
                }
        val lines = config.seoulLines.getValue(day)
        return LtDayRows(
            unnumbered,
            seoul[day].orEmpty().mapNotNull { numbered(it, lines) },
            (groups intersect config.secondSourceLines).sorted().flatMap { secondSource(day, it) },
        )
    }

    /** One line of the operator's file as numbered stops; rows of stations off the line's graph are left out. */
    fun secondSource(
        day: DayType,
        line: String,
    ): List<LtNumberedStop> =
        official[day to line].orEmpty().mapNotNull { row ->
            val code = officialCodes.getOrPut(line to row.station) { terminal(line, row.station) }
            code?.let {
                LtNumberedStop(
                    line,
                    row.train,
                    it,
                    row.arrival,
                    row.departure,
                    terminals.getOrPut(
                        line to row.terminal,
                    ) {
                        terminal(line, row.terminal)
                    },
                )
            }
        }

    /** Seoul Metro lines that both S5 and the operator's file cover on [day]. */
    fun comparedLines(day: DayType): List<String> =
        (config.seoulLines.getValue(day) intersect config.secondSourceLines).sorted()

    private fun day(seconds: Int?): Int = seconds?.takeIf { it < LT_DAY_END } ?: -1

    private fun numbered(
        row: JsonObject,
        lines: Set<String>,
    ): LtNumberedStop? {
        val line =
            row
                .text("LINE_NUM")
                .filter(Char::isDigit)
                .toInt()
                .toString()
        if (line !in lines) return null

        // "00:00:00" is the source's "no value" (first stop has no arrival, last stop no departure).
        fun time(key: String) = row.text(key).takeIf { it != "00:00:00" }.let(::ltSeconds)
        return LtNumberedStop(
            line,
            listOf(
                "LINE_NUM",
                "INOUT_TAG",
                "TRAIN_NO",
                "ORIGINSTATION",
                "DESTSTATION",
            ).joinToString("|") { row.text(it) },
            codes.getOrPut(line to row.text("STATION_NM")) { code(line, row.text("STATION_NM")) },
            time("ARRIVETIME"),
            time("LEFTTIME"),
            terminals.getOrPut(line to row.text("SUBWAYENAME")) { terminal(line, row.text("SUBWAYENAME")) },
        )
    }

    /** Physical station of a Seoul Metro station name on a line (same rule as the travel graph's S3 mapping). */
    private fun code(
        line: String,
        name: String,
    ): String {
        val rules = input.rules
        val lookup = rules.sourceLine(line, name)
        val match = records.filter { it.line == "${lookup}호선" && it.name == rules.canonical(name) }.distinctBy { it.id }
        require(match.size == 1) { "S5 station mapping ambiguous/missing: $line $name (${match.size})" }
        return stations.single { match.single().id in it.sources.values }.code
    }

    /** A terminal name placed on its line family's graph; through trains end outside the Seoul Metro section. */
    private fun terminal(
        line: String,
        name: String,
    ): String? {
        val plain = name.substringBefore('(').trim()
        val canonical = input.rules.canonical(name)
        return stations
            .filter { it.name == name || it.name == canonical || it.name.substringBefore('(').trim() == plain }
            .map { it.code }
            .firstOrNull { problem.families.contains(line, it) }
    }
}
