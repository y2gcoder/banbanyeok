package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.compute.ltDay
import app.banbanyeok.pipeline.lasttrain.compute.ltEarlier
import app.banbanyeok.pipeline.lasttrain.compute.ltMarginShown
import app.banbanyeok.pipeline.lasttrain.compute.ltNight
import app.banbanyeok.pipeline.lasttrain.compute.ltNumberedTrains
import app.banbanyeok.pipeline.lasttrain.compute.ltProvenTrains
import app.banbanyeok.pipeline.lasttrain.compute.ltRebuiltDirect
import app.banbanyeok.pipeline.lasttrain.compute.ltShown
import app.banbanyeok.pipeline.lasttrain.compute.ltTable
import app.banbanyeok.pipeline.lasttrain.compute.ltTrains
import app.banbanyeok.pipeline.lasttrain.gate.ltCeilingReport
import app.banbanyeok.pipeline.lasttrain.gate.ltCrossCheck
import app.banbanyeok.pipeline.lasttrain.gate.ltHiddenNumbers
import app.banbanyeok.pipeline.lasttrain.gate.ltInconsistentCells
import app.banbanyeok.pipeline.lasttrain.gate.ltLaterCells
import app.banbanyeok.pipeline.lasttrain.gate.ltOfficialReport
import app.banbanyeok.pipeline.lasttrain.input.ltCeilings
import app.banbanyeok.pipeline.lasttrain.input.ltOfficialSamples
import app.banbanyeok.pipeline.lasttrain.model.LT_SOURCE_MARGIN
import app.banbanyeok.pipeline.lasttrain.model.LtAllowance
import app.banbanyeok.pipeline.lasttrain.model.LtCell
import app.banbanyeok.pipeline.lasttrain.model.LtConfig
import app.banbanyeok.pipeline.lasttrain.model.LtDayResult
import app.banbanyeok.pipeline.lasttrain.model.LtOfficialSample
import app.banbanyeok.pipeline.lasttrain.model.LtProblem
import app.banbanyeok.pipeline.lasttrain.model.LtProven
import app.banbanyeok.pipeline.lasttrain.model.LtTrain
import app.banbanyeok.pipeline.lasttrain.model.ltProblemFromJson
import app.banbanyeok.pipeline.lasttrain.model.ltRows
import app.banbanyeok.pipeline.lasttrain.model.ltSeconds
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
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private fun resource(name: String): String =
    requireNotNull(LastTrainTest::class.java.getResource("/last-train/$name")) { "missing $name" }.readText()

/** The toy network of prototype/last_train.py; its expected cells are written by that independent oracle. */
private val toy: JsonObject = parseObject(resource("toy.json"))
private val problem = ltProblemFromJson(toy)

private fun day(
    day: DayType,
    allowance: LtAllowance = LtAllowance.DEFAULT,
) = ltNight(problem, day, ltRows(toy, day), allowance)

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
                val trains = ltTrains(problem, DayType.WEEKDAY, ltRows(toy, DayType.WEEKDAY))
                val express =
                    trains.single { train ->
                        train.stops.any { it.code == "x01" && it.departure == at(23, 30) }
                    }
                assertEquals(listOf("x01", "x02", "t00", "x04", "x05", "x06"), express.stops.map { it.code })
                assertEquals(listOf("x01", "t00"), express.stops.filter { it.boards }.map { it.code })
                assertEquals(listOf("t00", "x06"), express.stops.filter { it.alights }.map { it.code })
            }

            it("letsRidersBoardWhereATrainStartsItsRunButNotAHeadThatIsOnlyPassing") {
                val trains = ltTrains(problem, DayType.WEEKDAY, ltRows(toy, DayType.WEEKDAY))
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
                val trains = ltTrains(problem, DayType.WEEKDAY, ltRows(toy, DayType.WEEKDAY))
                val through =
                    trains.single { train ->
                        train.stops.any { it.code == "n01" && it.departure == at(23, 10) }
                    }
                assertEquals(listOf("n01", "n02", "t00", "n03", "n04", "n05"), through.stops.map { it.code })
                assertEquals("n05", through.bound)
            }

            it("neverLinksTowardsATerminalThatIsNotOnTheLineGraph") {
                val trains = ltTrains(problem, DayType.WEEKDAY, ltRows(toy, DayType.WEEKDAY))
                assertTrue(trains.none { train -> train.stops.any { it.code == "n05" && it.departure == at(23, 0) } })
            }

            it("neverGetsLaterWhenChangingTrainsIsAllowedMoreTime") {
                DayType.entries.forEach { type ->
                    val base = day(type)
                    assertEquals(0, ltLaterCells(base, day(type, LtAllowance.WIDER)), type.id)
                    assertEquals(
                        0,
                        ltInconsistentCells(ltDay(problem, ltTrains(problem, type, ltRows(toy, type)))),
                        type.id,
                    )
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

        describe("an express overtaking a waiting local (PR #81 review)") {
            val data = parseObject(resource("overtake.json"))
            val overtake = ltProblemFromJson(data)
            val trains = ltTrains(overtake, DayType.WEEKDAY, ltRows(data, DayType.WEEKDAY))

            it("keepsTheTwoTrainsApart") {
                // No rebuilt train reaches a stop before it left the previous one.
                trains.forEach { train ->
                    train.stops.zipWithNext().forEach { (from, to) ->
                        assertTrue(to.key > from.departure, "${from.code}→${to.code} goes back in time")
                    }
                }
                // The express that leaves a at 23:10 only passes b and c: nobody gets off a train rebuilt from it.
                val express =
                    trains.single { train ->
                        train.stops.first().let {
                            it.code == "a" &&
                                it.departure == at(23, 10)
                        }
                    }
                assertTrue(express.stops.drop(1).none { it.alights })
                // The local (a 23:00, waits at b from 23:02 to 23:12) is followed to b. Its stop at c (23:14) could
                // also be the express that passed b at 23:11 (expected at c 23:12:30, 90 s off), so that link is
                // not made: the rule keeps a link only when no other row could claim it.
                val local =
                    trains.single { train ->
                        train.stops.first().let {
                            it.code == "a" &&
                                it.departure == at(23, 0)
                        }
                    }
                assertEquals(listOf("a", "b"), local.stops.map { it.code })
                assertEquals(listOf(-1, at(23, 2)), local.stops.map { it.arrival })
            }

            it("givesNoTimeRatherThanTheExpress") {
                // The truth is the local at 23:00; the first review's wrong answer was 23:10. With the link at b
                // not made there is no train from a that is known to stop at c: no time is shown.
                val cell = ltNight(overtake, DayType.WEEKDAY, ltRows(data, DayType.WEEKDAY)).cells.single()
                assertEquals(LtCell.UNKNOWN, cell)
            }

            it("matchesTheIndependentOracle") {
                // python3 -B prototype/last_train.py expect pipeline/src/test/resources/last-train/overtake.json
                val result = ltNight(overtake, DayType.WEEKDAY, ltRows(data, DayType.WEEKDAY))
                assertEquals(listOf(LtCell.UNKNOWN), result.cells)
            }
        }

        describe("a train that starts where an express passes (PR #81 second review)") {
            // All to d, 120 s between stations. Local: a 23:00, b 23:01:30–23:02, c 23:03:30–23:04. A second
            // local starts at b at 23:16 and stops at c 23:17:30–23:20. An express leaves a at 23:14 and passes b
            // (23:17:10) and c (23:19:20). The last train from a that stops at c is the 23:00 local.
            val text = resource("start-and-pass.json")

            fun night(json: String): Pair<List<LtTrain>, LtCell> {
                val data = parseObject(json)
                val problem = ltProblemFromJson(data)
                val rows = ltRows(data, DayType.WEEKDAY)
                return ltTrains(problem, DayType.WEEKDAY, rows) to
                    ltNight(problem, DayType.WEEKDAY, rows).cells.single()
            }

            fun List<LtTrain>.fromAAt(seconds: Int) =
                filter { train ->
                    train.stops.any {
                        it.code == "a" &&
                            it.departure == seconds
                    }
                }

            it("doesNotJoinTheExpressToTheTrainStartingAtTheNextStation") {
                val (trains, cell) = night(text)
                // At b two rows are within 90 s of where the 23:14 train is expected (23:16): the local starting
                // there (0 s off) and the express itself (70 s off). Neither is chosen: the 23:14 row is in no train.
                assertTrue(trains.fromAAt(at(23, 14)).isEmpty())
                assertEquals(
                    listOf("a", "b", "c", "d"),
                    trains
                        .fromAAt(at(23, 0))
                        .single()
                        .stops
                        .map { it.code },
                )
                // 23:00 less the three-minute source margin. The second review's wrong answer was 23:11 (shown 23:10).
                assertEquals(LtCell(LastTrainKind.MARGIN_DIRECT.raw, 22 * 60 + 57, "d"), cell)
                assertTrue(ltShown(cell) <= 23 * 60)
            }

            it("doesNotLinkIntoAStartingRowWhenTheExpressIsOnlyALittleFurtherOff") {
                // The express now passes b at 23:17:40, 100 s from the expected time: outside the tolerance, so the
                // starting local is the only candidate. A row without an arrival may be a start, and another row
                // to the same terminal is within five minutes: still not linked.
                val moved = text.replace("[-1, 83830, \"d\"]", "[-1, 83860, \"d\"]")
                assertTrue(moved != text)
                val (trains, cell) = night(moved)
                assertTrue(
                    trains.fromAAt(at(23, 14)).none { train ->
                        train.stops.any { it.code == "c" && it.alights }
                    },
                )
                assertEquals(LtCell(LastTrainKind.MARGIN_DIRECT.raw, 22 * 60 + 57, "d"), cell)
            }

            it("stillFollowsAPassingTrainThatNothingElseIsNear") {
                // Without the local that starts at b the express is one train again: a 23:14, passing b and c, d 23:20:50.
                val alone =
                    text
                        .replace("[-1, 83760, \"d\"], ", "")
                        .replace("[83850, 84000, \"d\"], ", "")
                        .replace("[84090, -1, \"d\"], ", "")
                val (trains, cell) = night(alone)
                assertEquals(
                    listOf("a", "b", "c", "d"),
                    trains
                        .fromAAt(at(23, 14))
                        .single()
                        .stops
                        .map { it.code },
                )
                // It does not stop at c, so the answer for c is unchanged.
                assertEquals(LtCell(LastTrainKind.MARGIN_DIRECT.raw, 22 * 60 + 57, "d"), cell)
            }
        }

        describe("rows that cannot prove which train they belong to (PR #81 third review)") {
            // The reviewer's three inputs: a lone candidate within the tolerance that is another train (lone-candidate),
            // the passing row pushed 301 s away so the starting local is the only row within five minutes (far-pass),
            // and trains ending at c with another starting there 15 s later (short-run). No rule on rows without train
            // numbers can tell these trains apart, so such rows give no time at all unless rebuilding is turned on.
            fun cells(
                name: String,
                rebuild: Boolean? = null,
            ): List<LtCell> {
                val data = parseObject(resource(name))
                val read = ltProblemFromJson(data)
                val used = if (rebuild == null) read else read.copy(rebuild = rebuild)
                return ltNight(used, DayType.WEEKDAY, ltRows(data, DayType.WEEKDAY)).cells
            }

            it("givesNoTimeForTheReviewersCounterexamples") {
                listOf("lone-candidate.json", "far-pass.json", "short-run.json").forEach { name ->
                    assertFalse(
                        ltProblemFromJson(parseObject(resource(name))).rebuild,
                        "$name: rebuilding is off unless a file asks",
                    )
                    assertTrue(cells(name).all { it == LtCell.UNKNOWN }, name)
                }
                // The two earlier counterexamples turn rebuilding on to test its rules; with it off they give no time.
                listOf("overtake.json", "start-and-pass.json").forEach { name ->
                    assertTrue(cells(name, rebuild = false).all { it == LtCell.UNKNOWN }, name)
                }
            }

            it("givesTheRealLastTrainWhenTheSameRowsCarryTrainNumbers") {
                // lone-candidate with its train numbers restored: a to b and a to c both leave last at 23:09.
                assertEquals(
                    List(2) {
                        LtCell(LastTrainKind.MARGIN_DIRECT.raw, 23 * 60 + 9, "d")
                    },
                    cells("lone-candidate-numbered.json"),
                )
            }

            it("wouldBeLateWithRebuildingOn") {
                // Why the switch is off: the express (a 23:14) is joined to the local's stop at b, the lone candidate
                // within 90 s, and both cells come out at 23:11 (shown 23:10), later than the real 23:09. The same
                // happens to the other two inputs (real last trains 23:00 and 23:09).
                listOf(
                    "lone-candidate.json" to 23 * 60 + 9,
                    "far-pass.json" to 23 * 60,
                    "short-run.json" to 23 * 60 + 9,
                ).forEach { (name, truth) ->
                    val late = cells(name, rebuild = true).filter { it.kind != 0 }
                    assertTrue(late.isNotEmpty() && late.all { ltShown(it) > truth }, name)
                }
            }
        }

        describe("with rebuilding off (the default)") {
            val off = problem.copy(rebuild = false)

            fun night(
                type: DayType,
                used: LtProblem = off,
            ) = ltNight(used, type, ltRows(toy, type))

            fun LtDayResult.cell(
                home: String,
                meeting: String,
            ) = cells[off.homes.indexOf(home) * off.meetings.size + off.meetings.indexOf(meeting)]

            it("matchesTheIndependentOracleCellForCell") {
                // python3 -B prototype/last_train.py expect-off pipeline/src/test/resources/last-train/toy.json
                val expected = parseObject(resource("toy.off.expected.json"))
                DayType.entries.forEach { type ->
                    val cells = night(type).cells
                    val got =
                        off.homes.flatMapIndexed { h, home ->
                            off.meetings.mapIndexedNotNull { m, meeting ->
                                val cell = cells[h * off.meetings.size + m]
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

            it("givesNoTimeFromRebuiltTrains") {
                val weekday = night(DayType.WEEKDAY)
                // Line X has no train numbers. With rebuilding on its 24:10 train from t00 reaches x04; with it off
                // the cell has no time, and neither has any route that needs line X.
                assertEquals(LastTrainKind.DIRECT.raw, day(DayType.WEEKDAY).cell("x04", "t00").kind)
                assertEquals(LtCell.UNKNOWN, weekday.cell("x04", "t00"))
                assertEquals(LtCell.UNKNOWN, weekday.cell("x06", "x01"))
                assertEquals(LtCell.UNKNOWN, weekday.cell("x01", "n01"))
                // The numbered section of line N is untouched.
                assertEquals(LtCell(LastTrainKind.DIRECT.raw, 23 * 60 + 50, "n03"), weekday.cell("n02", "n01"))
                // Its trains run on without numbers beyond n03: no time there either.
                assertEquals(LtCell.UNKNOWN, weekday.cell("n04", "n01"))
            }

            it("addsOnlyTheDirectCellsTheOperatorsTableConfirmsOneByOne") {
                val weekday = night(DayType.WEEKDAY)
                // x01 to x02: the operator's table says 23:45 for x04, and so does the rebuilt train.
                assertEquals(LtCell(LastTrainKind.DIRECT.raw, 23 * 60 + 45, "x04"), weekday.cell("x02", "x01"))
                // t00 to x04: the table entry says 24:11, the rebuilt train leaves at 24:10. Not added.
                assertEquals(LtCell.UNKNOWN, weekday.cell("x04", "t00"))
                // x01 to x06: the entry names another terminal. Not added.
                assertEquals(LtCell.UNKNOWN, weekday.cell("x06", "x01"))
                // Holiday: line X is not a confirmed family that day, so its entry adds nothing. The cell has a time
                // only because the second source has train numbers (22:59 less the source margin).
                assertEquals(
                    LtCell(LastTrainKind.MARGIN_DIRECT.raw, 22 * 60 + 56, "x06"),
                    night(DayType.HOLIDAY).cell("t00", "x01"),
                )
            }

            it("neverUsesAConfirmedCellAsALegOfATransfer") {
                val rows = ltRows(toy, DayType.WEEKDAY)
                val index = off.homes.indexOf("t00") * off.meetings.size + off.meetings.indexOf("x01")
                val train = requireNotNull(ltRebuiltDirect(off, DayType.WEEKDAY, rows)[index])
                val ride = LtProven("t00", "x01", train.departure / 60, train.bound, "X")
                val result = night(DayType.WEEKDAY, off.copy(proven = mapOf(DayType.WEEKDAY to listOf(ride))))
                assertEquals(
                    LtCell(LastTrainKind.DIRECT.raw, train.departure / 60, train.bound),
                    result.cell("t00", "x01"),
                )
                // With rebuilding on, x01 to n01 changes at t00 (23:10). The confirmed ride to t00 does not open that
                // route: its arrival at t00 is not in the operator's table.
                assertEquals(LastTrainKind.MARGIN_TRANSFER.raw, day(DayType.WEEKDAY).cell("n01", "x01").kind)
                assertEquals(LtCell.UNKNOWN, result.cell("n01", "x01"))
            }

            it("takesATrainNumberedSecondSourceAsProofOfItsOwnTrains") {
                // Holiday line X has a second, numbered source. Its 23:40 train to x02 is not in the unnumbered rows;
                // with rebuilding on it was not trusted (22:57), with it off the numbered source is the proof.
                assertEquals(22 * 60 + 57, day(DayType.HOLIDAY).cell("x02", "x01").minute)
                assertEquals(
                    LtCell(LastTrainKind.MARGIN_DIRECT.raw, 23 * 60 + 37, "x02"),
                    night(DayType.HOLIDAY).cell("x02", "x01"),
                )
                assertTrue(
                    ltProvenTrains(off, DayType.HOLIDAY, ltRows(toy, DayType.HOLIDAY)).all { train ->
                        train.group == "N" || train.stops.all { it.margin == LT_SOURCE_MARGIN && !it.verified }
                    },
                )
            }

            it("boardsASecondSourceRowWithoutMarginWhereAConfirmedLineHasTheSameStation") {
                val stops = ltRows(toy, DayType.WEEKDAY).numbered
                val settled = setOf("N" to "n01")
                val trains = ltNumberedTrains(stops, margin = LT_SOURCE_MARGIN, settled = settled)
                assertTrue(trains.flatMap { it.stops }.all { (it.margin == 0) == (it.code == "n01") && !it.verified })
            }
        }

        describe("the timetable source itself") {
            fun cell(
                type: DayType,
                home: String,
                meeting: String,
            ) = day(type).cells[problem.homes.indexOf(home) * problem.meetings.size + problem.meetings.indexOf(meeting)]

            it("asksRidersToBoardThreeMinutesBeforeATrainOfAnUncomparedSource") {
                // Holiday: line X is rebuilt from unnumbered rows and is not exact that day. Its 23:00 train is 22:57.
                assertEquals(
                    LtCell(LastTrainKind.MARGIN_DIRECT.raw, 22 * 60 + 57, "x06"),
                    cell(DayType.HOLIDAY, "t00", "x01"),
                )
                // Weekday: the same family passed the comparison with the operator's table, so the minute is exact.
                assertEquals(LtCell(LastTrainKind.DIRECT.raw, 23 * 60 + 45, "x04"), cell(DayType.WEEKDAY, "x02", "x01"))
                // Numbered trains (line N) are confirmed against the operator's file on weekdays only: the holiday
                // 23:50 train is boarded by 23:47.
                assertEquals(LtCell(LastTrainKind.DIRECT.raw, 23 * 60 + 50, "n03"), cell(DayType.WEEKDAY, "n02", "n01"))
                assertEquals(
                    LtCell(LastTrainKind.MARGIN_DIRECT.raw, 23 * 60 + 47, "n03"),
                    cell(DayType.HOLIDAY, "n02", "n01"),
                )
            }

            it("confirmsADirectRideOnlyWhenBothItsStopsComeFromAConfirmedLine") {
                val trains = ltTrains(problem, DayType.WEEKDAY, ltRows(toy, DayType.WEEKDAY))
                val through =
                    trains.single { train ->
                        train.stops.any { it.code == "n01" && it.departure == at(23, 10) }
                    }
                // n01–n03 carry train numbers and passed the comparison; n04 and n05 were rebuilt without numbers.
                assertEquals(listOf("n01", "n02", "t00", "n03"), through.stops.filter { it.verified }.map { it.code })
                // Boarding at n01 is exact (23:10), but leaving at n04 rests on a rebuilt row: a margin time.
                assertEquals(
                    LtCell(LastTrainKind.MARGIN_DIRECT.raw, 23 * 60 + 10, "n05"),
                    cell(DayType.WEEKDAY, "n04", "n01"),
                )
                // Without the comparison nothing on the line is confirmed, and every stop is boarded three minutes early.
                val unconfirmed = problem.copy(exactNumbered = emptyMap())
                val plain = ltDay(unconfirmed, ltTrains(unconfirmed, DayType.WEEKDAY, ltRows(toy, DayType.WEEKDAY)))
                val index = problem.homes.indexOf("n02") * problem.meetings.size + problem.meetings.indexOf("n01")
                assertEquals(LtCell(LastTrainKind.MARGIN_DIRECT.raw, 23 * 60 + 47, "n03"), plain.cells[index])
            }

            it("keepsTheEarlierAnswerWhenASecondSourceDisagrees") {
                // The second source runs the train to x01 ten minutes earlier (23:16 at t00): that answer is kept.
                assertEquals(
                    LtCell(LastTrainKind.MARGIN_DIRECT.raw, 23 * 60 + 16, "x01"),
                    cell(DayType.HOLIDAY, "x01", "t00"),
                )
                // It also lists a later train to x02 (23:40) that the first source does not have: not trusted.
                assertEquals(22 * 60 + 57, cell(DayType.HOLIDAY, "x02", "x01").minute)
            }

            it("givesNoTimeWhenEitherSourceFindsNoWay") {
                val rows = ltRows(toy, DayType.HOLIDAY)
                val first = ltDay(problem, ltTrains(problem, DayType.HOLIDAY, rows))
                val none =
                    LtDayResult(first.cells.map { LtCell.UNKNOWN }, IntArray(first.latest.size) { -1 }, first.direct)
                assertTrue(ltEarlier(first, none).cells.all { it.kind == 0 })
                assertTrue(ltEarlier(none, first).cells.all { it.kind == 0 })
            }

            it("comparesLastDirectTrainsOfOneFamilyBetweenTheTwoSources") {
                val rows = ltRows(toy, DayType.HOLIDAY)
                val ours = ltTrains(problem, DayType.HOLIDAY, rows).filter { it.group == "X" }
                val check = ltCrossCheck(ours, ltNumberedTrains(rows.second))
                // Ours leaves x01 at 23:00 where the second source says 22:59, and t00 for x01 at 23:26 where it says
                // 23:16: later by up to 600 s. (A real family this far apart fails the build: the source margin is 180 s.)
                assertTrue(check.later > 0)
                assertEquals(600, check.maxLaterSeconds)
                assertTrue(check.earlier > 0, "x01 to x02: the second source has a later train (23:40) than ours")
                assertFalse(check.identical)
            }

            it("confirmsALineOnlyWhenEveryPairIsTheSameInTheOperatorsFile") {
                val ours = ltNumberedTrains(ltRows(toy, DayType.WEEKDAY).numbered)
                assertTrue(ltCrossCheck(ours, ours).identical)
                // Nothing to compare with (no file, or the line is missing from it) confirms nothing.
                assertFalse(ltCrossCheck(ours, emptyList()).identical)
                assertFalse(ltCrossCheck(emptyList(), emptyList()).identical)
                // One train a minute earlier in the operator's file is enough to lose the confirmation.
                val shifted =
                    ours.map { train ->
                        LtTrain(train.group, train.end, train.stops.map { it.copy(departure = it.departure - 60) })
                    }
                val check = ltCrossCheck(ours, shifted)
                assertFalse(check.identical)
                assertEquals(60, check.maxLaterSeconds)
            }

            it("doesNotConfirmALineWhoseTrainsAreBoundElsewhereInTheOperatorsFile") {
                // The second review's hole: every departure the same second, every terminal different, and the
                // comparison still called the line identical. A confirmed direct train is shown with its destination.
                val ours = ltNumberedTrains(ltRows(toy, DayType.WEEKDAY).numbered)
                val elsewhere = ours.map { LtTrain(it.group, "x06", it.stops) }
                val check = ltCrossCheck(ours, elsewhere)
                assertTrue(check.pairs > 0)
                assertEquals(0, check.same)
                assertEquals(check.pairs, check.otherBound)
                assertEquals(0, check.later)
                assertEquals(0, check.onlyOurs)
                assertFalse(check.identical)
                // One train of several bound elsewhere is enough: only the pairs it is the last train of differ.
                val one =
                    ours.mapIndexed { index, train ->
                        if (index ==
                            ours.lastIndex
                        ) {
                            LtTrain(train.group, "x06", train.stops)
                        } else {
                            train
                        }
                    }
                val partly = ltCrossCheck(ours, one)
                assertTrue(partly.otherBound in 1 until partly.pairs)
                assertEquals(partly.pairs - partly.otherBound, partly.same)
                assertFalse(partly.identical)
                // Two trains leaving a pair at the same second are compared as a set of terminals.
                assertEquals(0, ltCrossCheck(ours + elsewhere, elsewhere + ours).otherBound)
                assertTrue(ltCrossCheck(ours + elsewhere, ours).otherBound > 0)
            }
        }

        describe("official samples and ceilings") {
            val origins =
                (problem.homes + problem.meetings).distinct().map { code ->
                    app.banbanyeok.schema.Station(
                        code,
                        code,
                        app.banbanyeok.schema.StationStatus.ACTIVE,
                        37.5,
                        127.0,
                        emptyList(),
                        emptyList(),
                        emptyMap(),
                        1,
                    )
                }
            val results = DayType.entries.associateWith { day(it) }

            fun sample(
                meeting: String,
                home: String,
                time: String,
                bound: String,
                family: String,
            ) = ltOfficialSamples(
                "meeting,home,day,time,bound,family,url,checkedAt\n" +
                    "$meeting,$home,weekday,$time,$bound,$family,https://example.test/t,2026-11-20\n",
            )

            fun passed(samples: List<LtOfficialSample>) =
                ltOfficialReport(samples, problem, origins, results).single().text("passed") == "true"

            it("passesOnlyWhenMinuteDestinationAndFamilyAllMatch") {
                assertTrue(passed(sample("x01", "x02", "23:45", "x04", "X")))
                assertFalse(passed(sample("x01", "x02", "23:44", "x04", "X")), "minute")
                assertFalse(passed(sample("x01", "x02", "23:45", "x06", "X")), "destination")
                // The review's hole: a sample of one family vouching for another.
                assertFalse(passed(sample("x01", "x02", "23:45", "x04", "N")), "family")
            }

            it("comparesTheSingleTrainEvenWhereATransferWinsTheCell") {
                // x01 → x06: the published cell is a transfer (23:45), but the last single train is the 23:30 express.
                val cell =
                    results.getValue(DayType.WEEKDAY).cells[
                        problem.homes.indexOf("x06") * 3 +
                            problem.meetings.indexOf("x01"),
                    ]
                assertEquals(LastTrainKind.MARGIN_TRANSFER.raw, cell.kind)
                assertTrue(passed(sample("x01", "x06", "23:30", "x06", "X")))
                assertFalse(
                    passed(sample("x01", "x06", "23:45", "x06", "X")),
                    "the transfer's time is not a direct train",
                )
            }

            it("neverPassesWhereNoSingleTrainRuns") {
                // x01 → n01 needs a change at t00.
                assertFalse(passed(sample("x01", "n01", "23:45", "n01", "X")))
            }

            it("failsACeilingOnlyWhenTheShownTimeIsLater") {
                fun report(notAfter: String) =
                    ltCeilingReport(
                        ltCeilings(
                            "meeting,home,day,notAfter,url,checkedAt,note\n" +
                                "x01,t00,holiday,$notAfter,https://example.test/t,2026-11-20,\n",
                        ),
                        problem,
                        origins,
                        results,
                    ).single()
                // 22:57 is shown as 22:50.
                assertEquals("true", report("22:50").text("passed"))
                assertEquals("false", report("22:49").text("passed"))
                assertEquals("1370", report("22:50").text("shown"))
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
                    second: String = """["1","X"]""",
                ) = parseObject(
                    """{"days":{"weekday":{"seoulLines":["1"],"tagoGroups":["X"]},
                        "saturday":{"seoulLines":["1"],"tagoGroups":$saturday},
                        "holiday":{"seoulLines":["1"],"tagoGroups":["X"]}},"exact":$exact,
                        "secondSource":{"lines":$second}}""",
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
                assertEquals(setOf("1", "X"), ok.secondSourceLines)
                // Saturday leaves family X out: it is a day type computed from some lines only.
                assertEquals(listOf(DayType.SATURDAY), ok.partialDays)
                assertEquals(emptyList(), LtConfig(config(saturday = """["X"]"""), setOf("X")).partialDays)
                assertFailsWith<IllegalArgumentException> { LtConfig(config(saturday = """["Y"]"""), setOf("X")) }
                assertFailsWith<IllegalArgumentException> { LtConfig(config(second = """["Y"]"""), setOf("X")) }
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
