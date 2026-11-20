package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.compute.ltNight
import app.banbanyeok.pipeline.lasttrain.input.officialRow
import app.banbanyeok.pipeline.lasttrain.input.officialSeconds
import app.banbanyeok.pipeline.lasttrain.model.LtCell
import app.banbanyeok.pipeline.lasttrain.model.LtDayRows
import app.banbanyeok.pipeline.lasttrain.model.LtNumberedStop
import app.banbanyeok.pipeline.lasttrain.model.ltProblemFromJson
import app.banbanyeok.pipeline.lasttrain.model.ltSeconds
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainKind
import io.kotest.core.spec.style.DescribeSpec
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

private fun at(
    hour: Int,
    minute: Int,
    second: Int = 0,
) = hour * 3600 + minute * 60 + second

/** How the operator's train-coded file (S7) is read: its "no value" mark, and what a passed station must not become. */
class LastTrainOfficialTest :
    DescribeSpec({
        describe("the operator's train-coded file (PR #81 fourth review)") {
            // Line 1 weekday express K1949, 청량리 → 천안, as the file has it. It only passes 독산 and 직산: the file
            // writes their arrival as "00:00:00", its mark for "no value". Midnight itself is written "24:00:00".
            val file =
                listOf(
                    "11560,1,0158,청량리,DAY,DOWN,1,K1949,,19:15:00,청량리,천안",
                    "47953,1,1714,독산,DAY,DOWN,1,K1949,00:00:00,20:01:30,청량리,천안",
                    "47261,1,1713,수원,DAY,DOWN,1,K1949,20:27:00,20:27:30,청량리,천안",
                    "54408,1,1725,성환,DAY,DOWN,1,K1949,21:03:30,21:04:00,청량리,천안",
                    "54833,1,1726,직산,DAY,DOWN,1,K1949,00:00:00,21:07:30,청량리,천안",
                    "55396,1,1727,두정,DAY,DOWN,1,K1949,21:11:00,21:11:30,청량리,천안",
                    "55892,1,1728,천안,DAY,DOWN,1,K1949,21:15:30,,청량리,천안",
                ).map { it.split(',') }
            val names = file.map { it[3] }
            val line =
                ltProblemFromJson(
                    parseObject(
                        """{"homes":${names.sorted().map { "\"$it\"" }},"meetings":["수원","직산"],"stations":{},""" +
                            """"families":{"1":${names.zipWithNext().map { (a, b) -> "[\"$a\",\"$b\"]" }}},""" +
                            """"hops":[],"walks":[],"stationWalks":{},"exact":{}}""",
                    ),
                )

            fun cells(stops: List<LtNumberedStop>): Map<Pair<String, String>, LtCell> {
                val result = ltNight(line, DayType.WEEKDAY, LtDayRows(emptyMap(), emptyList(), stops))
                return line.homes
                    .flatMapIndexed { h, home ->
                        line.meetings.mapIndexed { m, meeting ->
                            (home to meeting) to
                                result.cells[h * line.meetings.size + m]
                        }
                    }.filter { it.second.kind != 0 }
                    .toMap()
            }

            it("readsTheZeroMarkAsNoValueAndKeepsMidnight") {
                assertEquals(-1, officialSeconds("00:00:00"))
                assertEquals(-1, officialSeconds(""))
                assertEquals(at(24, 0), officialSeconds("24:00:00"))
                assertEquals(at(24, 5, 30), officialSeconds("00:05:30"))
                assertEquals(at(21, 7, 30), officialSeconds("21:07:30"))
                val passed = officialRow(file[4])
                assertEquals("직산", passed.station)
                assertEquals(-1, passed.arrival)
                assertEquals(at(21, 7, 30), passed.departure)
            }

            it("letsNobodyOnOrOffWhereTheExpressOnlyPasses") {
                val stops =
                    file
                        .map(
                            ::officialRow,
                        ).map { LtNumberedStop("1", it.train, it.station, it.arrival, it.departure, "천안") }
                val found = cells(stops)
                // 수원 20:27:30 less the source margin. Riders get off at 성환, 두정 and 천안, where it stops.
                assertEquals(setOf("성환" to "수원", "두정" to "수원", "천안" to "수원"), found.keys)
                assertEquals(setOf(LtCell(LastTrainKind.MARGIN_DIRECT.raw, 20 * 60 + 24, "천안")), found.values.toSet())
                // Nobody boards at 직산 either (it is a meeting station here).
                assertTrue(found.keys.none { it.second == "직산" })
                // Read as midnight (before the fix) 직산 became a stop reached at 24:00 and 수원 → 직산 came out at 20:24.
                val wrong =
                    stops.zip(file).map { (stop, row) ->
                        stop.copy(arrival = ltSeconds(row[8]), departure = ltSeconds(row[9]))
                    }
                assertEquals(LtCell(LastTrainKind.MARGIN_DIRECT.raw, 20 * 60 + 24, "천안"), cells(wrong)["직산" to "수원"])
            }

            it("refusesAFileWhoseRowsArriveLongAfterTheyLeave") {
                // What a "no value" mark read as a time looks like: the build stops instead of inventing stops.
                assertFailsWith<IllegalArgumentException> {
                    officialRow("1,1,1726,직산,DAY,DOWN,1,K1949,24:00:00,21:07:30,청량리,천안".split(','))
                }
                // The file does have one row whose arrival is 35 s after its departure: such a slip is let through.
                assertEquals(
                    at(24, 12, 35),
                    officialRow("407671,9,4122,신반포,DAY,DOWN,0,C9247,24:12:35,24:12:00,중앙보훈병원,개화".split(',')).arrival,
                )
            }
        }
    })
