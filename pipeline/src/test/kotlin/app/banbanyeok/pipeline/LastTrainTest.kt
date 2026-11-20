package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainCell
import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.schema.LtBinCodec
import app.banbanyeok.schema.StationCode
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private fun resource(name: String): String =
    requireNotNull(LastTrainTest::class.java.getResource("/last-train/$name")) { "missing $name" }.readText()

/** The toy network of prototype/last_train.py; its expected cells are written by that independent oracle. */
private val toy: JsonObject = parseObject(resource("toy.json"))
private val problem = ltProblem(toy)

private fun day(
    day: DayType,
    allowance: LtAllowance = LtAllowance.DEFAULT,
) = ltDay(problem, day, ltTrains(problem, ltRows(toy, day)), allowance)

private fun at(
    hour: Int,
    minute: Int,
    second: Int = 0,
) = hour * 3600 + minute * 60 + second

class LastTrainTest :
    DescribeSpec({
        describe("last trains on the toy network") {
            it("matchesTheIndependentOracleCellForCell") {
                val expected = parseObject(resource("toy.expected.json"))
                DayType.entries.forEach { type ->
                    val cells = day(type).cells
                    val got =
                        problem.homes.flatMapIndexed { h, home ->
                            problem.meetings.mapIndexedNotNull { m, meeting ->
                                val cell = cells[h * problem.meetings.size + m]
                                if (cell.kind == 0) null else listOf(home, meeting, cell.kind, cell.minute, cell.bound)
                            }
                        }
                    val want =
                        expected.getValue(type.id).jsonArray.map { row ->
                            val cell = row.jsonArray
                            listOf(
                                cell[0].jsonPrimitive.content,
                                cell[1].jsonPrimitive.content,
                                cell[2].jsonPrimitive.int,
                                cell[3].jsonPrimitive.int,
                                if (cell[4] is JsonNull) null else cell[4].jsonPrimitive.content,
                            )
                        }
                    assertEquals(want, got, type.id)
                }
            }

            it("treatsARowWithoutAnArrivalAsATrainPassingThrough") {
                val trains = ltTrains(problem, ltRows(toy, DayType.WEEKDAY))
                val express =
                    trains.single { train ->
                        train.stops.any { it.code == "x01" && it.departure == at(23, 30) }
                    }
                assertEquals(listOf("x01", "x02", "t00", "x04", "x05", "x06"), express.stops.map { it.code })
                assertEquals(listOf("x01", "t00"), express.stops.filter { it.boards }.map { it.code })
                assertEquals(listOf("t00", "x06"), express.stops.filter { it.alights }.map { it.code })
            }

            it("letsRidersBoardWhereATrainStartsItsRunButNotAHeadThatIsOnlyPassing") {
                val trains = ltTrains(problem, ltRows(toy, DayType.WEEKDAY))
                val starting =
                    trains.single { train ->
                        train.stops.first().let {
                            it.code == "t00" &&
                                it.departure == at(24, 10)
                        }
                    }
                assertTrue(
                    starting.stops.first().boards,
                    "no train to the same terminal is near at the previous station",
                )
                val passing =
                    trains.single { train ->
                        train.stops.first().let {
                            it.code == "t00" &&
                                it.departure == at(23, 54, 30)
                        }
                    }
                assertFalse(
                    passing.stops.first().boards,
                    "a train to the same terminal left the previous station just before",
                )
                assertEquals(listOf("x04", "x05"), passing.stops.filter { it.boards }.map { it.code })
            }

            it("joinsAThroughTrainAcrossTheNumberedAndUnnumberedSections") {
                val trains = ltTrains(problem, ltRows(toy, DayType.WEEKDAY))
                val through =
                    trains.single { train ->
                        train.stops.any { it.code == "n01" && it.departure == at(23, 10) }
                    }
                assertEquals(listOf("n01", "n02", "t00", "n03", "n04", "n05"), through.stops.map { it.code })
                assertEquals("n05", through.bound)
            }

            it("neverLinksTowardsATerminalThatIsNotOnTheLineGraph") {
                val trains = ltTrains(problem, ltRows(toy, DayType.WEEKDAY))
                assertTrue(trains.none { train -> train.stops.any { it.code == "n05" && it.departure == at(23, 0) } })
            }

            it("neverGetsLaterWhenChangingTrainsIsAllowedMoreTime") {
                DayType.entries.forEach { type ->
                    val base = day(type)
                    assertEquals(0, ltLaterCells(base, day(type, LtAllowance.WIDER)), type.id)
                    assertEquals(0, ltInconsistentCells(base), type.id)
                }
                // The wider allowance does change something: the 23:50 connection at t00 no longer holds.
                val width = problem.meetings.size
                val cell = problem.homes.indexOf("x06") * width + problem.meetings.indexOf("n01")
                assertEquals(at(23, 50), day(DayType.WEEKDAY).latest[cell])
                assertTrue(day(DayType.WEEKDAY, LtAllowance.WIDER).latest[cell] < at(23, 50))
            }

            it("rebuildsNumberedTrainsWithoutTheirNumbersWithNoLateOrPhantomPair") {
                val check = ltHiddenNumbers(problem.families, ltRows(toy, DayType.WEEKDAY).numbered, emptySet())
                assertTrue(check.passed)
                assertEquals(check.pairs, check.same)
                assertTrue(check.pairs > 0)
            }

            it("encodesTheCellsIntoATableTheSchemaAccepts") {
                val codes = (problem.homes + problem.meetings).distinct().sorted()
                val alias =
                    codes.withIndex().associate { (index, code) ->
                        code to
                            StationCode.ofValue(index + 1).toString()
                    }
                val renamed =
                    LtProblem(
                        problem.homes.map(alias::getValue),
                        problem.meetings.map(alias::getValue),
                        problem.families,
                        problem.stations,
                        problem.hops,
                        problem.walks,
                        problem.exact,
                    )
                val results =
                    DayType.entries.associateWith { type ->
                        val result = day(type)
                        LtDayResult(
                            result.cells.map { it.copy(bound = it.bound?.let(alias::getValue)) },
                            result.latest,
                            result.direct,
                        )
                    }
                val table = LtBinCodec.decode(LtBinCodec.encode(ltTable(renamed, 7, results)))
                val home = problem.homes.indexOf("x02")
                val meeting = problem.meetings.indexOf("x01")
                assertEquals(
                    LastTrainCell(LastTrainKind.DIRECT, 23 * 60 + 45, StationCode.parse(alias.getValue("x04"))),
                    table.cell(DayType.WEEKDAY, home, meeting),
                )
                assertEquals(LastTrainKind.MARGIN_DIRECT, table.cell(DayType.HOLIDAY, home, meeting).kind)
                assertEquals(LastTrainCell.UNKNOWN, table.cell(DayType.SATURDAY, home, meeting))
            }
        }

        describe("last-train inputs") {
            it("readsServiceDaySecondsAndRejectsPlaceholders") {
                assertEquals(at(24, 3), ltSeconds("00:03:00"))
                assertEquals(at(23, 59, 30), ltSeconds("235930"))
                assertEquals(at(26, 59, 59), ltSeconds("02:59:59"))
                assertEquals(-1, ltSeconds("0"))
                assertEquals(-1, ltSeconds("      "))
                assertEquals(-1, ltSeconds(null))
                assertEquals(-1, ltSeconds("27:00:00"))
            }

            it("showsMarginKindsFlooredToTenMinutes") {
                assertEquals(23 * 60 + 40, ltMarginShown(23 * 60 + 45))
                assertEquals(24 * 60, ltMarginShown(24 * 60 + 9))
                assertEquals(23 * 60 + 50, ltMarginShown(23 * 60 + 50))
            }

            it("allowsAtLeastTenMinutesAndTwiceTheWalkPlusFive") {
                assertEquals(600, LtAllowance.DEFAULT.seconds(0))
                assertEquals(600, LtAllowance.DEFAULT.seconds(150))
                assertEquals(742, LtAllowance.DEFAULT.seconds(221))
                assertEquals(1320, LtAllowance.DEFAULT.seconds(510))
            }

            it("rejectsAConfigThatNamesUnknownLinesOrAnExactFamilyWithoutASource") {
                fun config(
                    saturday: String = "[]",
                    exact: String = "{}",
                ) = parseObject(
                    """{"days":{"weekday":{"seoulLines":["1"],"tagoGroups":["X"]},
                        "saturday":{"seoulLines":["1"],"tagoGroups":$saturday},
                        "holiday":{"seoulLines":["1"],"tagoGroups":["X"]}},"exact":$exact}""",
                )
                val ok =
                    LtConfig(
                        config(
                            exact =
                                """{"X":{"days":["weekday"],""" +
                                    """"source":"https://example.test/t","checkedAt":"2026-11-20"}}""",
                        ),
                        setOf("X"),
                    )
                assertEquals(setOf("X"), ok.exact.getValue(DayType.WEEKDAY))
                assertEquals(emptySet(), ok.exact.getValue(DayType.HOLIDAY))
                assertEquals(emptySet(), ok.tagoGroups.getValue(DayType.SATURDAY))
                assertFailsWith<IllegalArgumentException> { LtConfig(config(saturday = """["Y"]"""), setOf("X")) }
                assertFailsWith<IllegalArgumentException> {
                    LtConfig(
                        config(exact = """{"X":{"days":["weekday"],"source":"none","checkedAt":"2026-11-20"}}"""),
                        setOf("X"),
                    )
                }
            }

            it("readsOfficialSamplesInServiceDayNotation") {
                val samples =
                    ltOfficialSamples(
                        "meeting,home,day,time,bound,family,url,checkedAt\n" +
                            "강남,광교,weekday,24:03,광교,신분당,https://example.test/sb004,2026-11-20\n",
                    )
                assertEquals(24 * 60 + 3, samples.single().minute)
                assertEquals(DayType.WEEKDAY, samples.single().day)
                assertFailsWith<IllegalArgumentException> {
                    ltOfficialSamples("h\n강남,광교,weekday,00:03,광교,신분당,https://example.test/x,2026-11-20\n")
                }
            }
        }
    })
