package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.compute.ltNight
import app.banbanyeok.pipeline.lasttrain.compute.ltNumberedTrains
import app.banbanyeok.pipeline.lasttrain.compute.ltTable
import app.banbanyeok.pipeline.lasttrain.gate.ltCrossCheck
import app.banbanyeok.pipeline.lasttrain.gate.ltHiddenNumbers
import app.banbanyeok.pipeline.lasttrain.gate.ltInconsistentCells
import app.banbanyeok.pipeline.lasttrain.gate.ltLaterCells
import app.banbanyeok.pipeline.lasttrain.model.LtAllowance
import app.banbanyeok.pipeline.lasttrain.model.LtProblem
import app.banbanyeok.pipeline.lasttrain.model.ltProblemFromJson
import app.banbanyeok.pipeline.lasttrain.model.ltProblemToJson
import app.banbanyeok.pipeline.lasttrain.model.ltRows
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LtBinCodec
import app.banbanyeok.schema.Sha256
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private fun fixture(name: String): String =
    requireNotNull(LastTrainRealCoreTest::class.java.getResource("/last-train/$name")) { "missing $name" }.readText()

/**
 * An excerpt of the real timetables (#92): line 4 across the Seoul Metro / Korail boundary, and the lines 2 and 7
 * around Sadang and Isu. Written by prototype/gen_real_fixture.py; the expected cells by the independent oracle
 * (prototype/last_train.py), which CI runs against the same files (prototype/test_last_train.py).
 */
class LastTrainRealCoreTest :
    DescribeSpec({
        val data = parseObject(fixture("real-core.json"))
        val on = ltProblemFromJson(data)
        val off = on.copy(rebuild = false)

        fun cells(
            problem: LtProblem,
            type: DayType,
        ) = ltNight(problem, type, ltRows(data, type)).cells

        fun listed(
            problem: LtProblem,
            type: DayType,
        ) = problem.homes.flatMapIndexed { h, home ->
            problem.meetings.mapIndexedNotNull { m, meeting ->
                val cell = cells(problem, type)[h * problem.meetings.size + m]
                if (cell.kind == 0) null else listOf(home, meeting, cell.kind, cell.minute, cell.bound)
            }
        }

        fun expected(
            file: String,
            type: DayType,
        ) = parseObject(fixture(file)).getValue(type.id).jsonArray.map { row ->
            val cell = row.jsonArray
            listOf(
                cell[0].jsonPrimitive.content,
                cell[1].jsonPrimitive.content,
                cell[2].jsonPrimitive.int,
                cell[3].jsonPrimitive.int,
                if (cell[4] is JsonNull) null else cell[4].jsonPrimitive.content,
            )
        }

        describe("the real-timetable excerpt") {
            it("matchesTheIndependentOracleCellForCellWithRebuildingOn") {
                // python3 -B prototype/last_train.py expect pipeline/src/test/resources/last-train/real-core.json
                DayType.entries.forEach { type ->
                    assertEquals(expected("real-core.expected.json", type), listed(on, type), type.id)
                }
            }

            it("matchesTheIndependentOracleCellForCellWithRebuildingOff") {
                // python3 -B prototype/last_train.py expect-off pipeline/src/test/resources/last-train/real-core.json
                DayType.entries.forEach { type ->
                    assertEquals(expected("real-core.off.expected.json", type), listed(off, type), type.id)
                }
            }

            it("hasEverySourceKindAndEveryKindOfCellOnTheWeekday") {
                val rows = ltRows(data, DayType.WEEKDAY)
                assertTrue(rows.unnumbered.isNotEmpty() && rows.numbered.isNotEmpty() && rows.second.isNotEmpty())
                assertEquals(setOf(1, 2, 3), listed(off, DayType.WEEKDAY).map { it[2] }.toSet())
                assertTrue(listed(on, DayType.WEEKDAY) != listed(off, DayType.WEEKDAY), "rebuilding changes some cells")
            }

            it("encodesTheSameBytesAsBefore") {
                val tableOn = ltTable(on, 1, DayType.entries.associateWith { ltNight(on, it, ltRows(data, it)) })
                val tableOff = ltTable(off, 1, DayType.entries.associateWith { ltNight(off, it, ltRows(data, it)) })
                assertEquals(
                    listOf(
                        "f9c4cd29c9ea0fc8bd1109dc21239e30c69cd99dc881e5c8c75ba00a775e5e46",
                        "3969a55a59bd52bc1b8be95324ff826a518f5af1d6709f5225323c11ce77a610",
                    ),
                    listOf(tableOn, tableOff).map { Sha256.hex(LtBinCodec.encode(it)) },
                )
            }

            it("writesTheProblemFileTheOracleReadsAndReadsItBack") {
                val json = ltProblemToJson(on)
                assertEquals(json, ltProblemToJson(ltProblemFromJson(json)))
                assertEquals(on.homes, ltProblemFromJson(json).homes)
                assertEquals(on.meetings, ltProblemFromJson(json).meetings)
                assertEquals(
                    setOf("homes", "meetings", "families", "stations", "hops", "sourceMargin", "walks", "stationWalks"),
                    json.keys.take(8).toSet(),
                )
                assertEquals(
                    "38e43bc34c1d26e7fa5b88c6be8fa359996bba42094ea0bbffef248c51fc7ff6",
                    Sha256.hex(json.toString().toByteArray()),
                )
            }

            it("givesTheGateCountsOfTheReportForEveryDayType") {
                val gates =
                    DayType.entries.associate { type ->
                        val rows = ltRows(data, type)
                        val problem = off
                        val result = ltNight(problem, type, rows)
                        val wider = ltNight(problem, type, rows, LtAllowance.WIDER)
                        val line4 = rows.numbered.filter { it.group == "4" }
                        val second = rows.second.filter { it.group == "4" }
                        type.id to
                            obj(
                                "hidden" to ltHiddenNumbers(problem.families, rows.numbered, setOf("2")).json,
                                "later" to ltLaterCells(result, wider),
                                "inconsistent" to ltInconsistentCells(result),
                                "cross" to
                                    if (second.isEmpty()) {
                                        JsonNull
                                    } else {
                                        ltCrossCheck(ltNumberedTrains(line4), ltNumberedTrains(second)).json
                                    },
                            )
                    }
                // Counts of the gates of the report, as the code before the #92 package split computed them.
                assertEquals(parseObject(fixture("real-core.gates.json")), JsonObject(gates))
            }
        }
    })
