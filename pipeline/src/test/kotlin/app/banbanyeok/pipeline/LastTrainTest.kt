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
            val overtake = ltProblem(data)
            val trains = ltTrains(overtake, DayType.WEEKDAY, ltRows(data, DayType.WEEKDAY))

            it("keepsTheTwoTrainsApart") {
                // The local: a 23:00, waits at b from 23:02 to 23:12, c 23:14, d 23:16.
                val local =
                    trains.single { train ->
                        train.stops.first().let {
                            it.code == "a" &&
                                it.departure == at(23, 0)
                        }
                    }
                assertEquals(listOf("a", "b", "c", "d"), local.stops.map { it.code })
                assertEquals(listOf(-1, at(23, 2), at(23, 14), at(23, 16)), local.stops.map { it.arrival })
                // No rebuilt train reaches a stop before it left the previous one.
                trains.forEach { train ->
                    train.stops.zipWithNext().forEach { (from, to) ->
                        assertTrue(to.key > from.departure, "${from.code}→${to.code} goes back in time")
                    }
                }
                // The express that leaves a at 23:10 only passes b and c: it never gets the local's stop at c.
                val express =
                    trains.single { train ->
                        train.stops.first().let {
                            it.code == "a" &&
                                it.departure == at(23, 10)
                        }
                    }
                assertTrue(express.stops.drop(1).none { it.code == "c" && it.alights })
            }

            it("answersAToCWithTheLocalNotTheExpress") {
                val cell = ltNight(overtake, DayType.WEEKDAY, ltRows(data, DayType.WEEKDAY)).cells.single()
                // 23:00 less the three-minute source margin; the review's wrong answer was 23:10.
                assertEquals(LtCell(LastTrainKind.MARGIN_DIRECT.raw, 22 * 60 + 57, "d"), cell)
                assertTrue(ltShown(cell) <= 23 * 60)
            }

            it("matchesTheIndependentOracle") {
                // python3 -B prototype/last_train.py expect pipeline/src/test/resources/last-train/overtake.json
                val result = ltNight(overtake, DayType.WEEKDAY, ltRows(data, DayType.WEEKDAY))
                assertEquals(listOf(LtCell(3, 1377, "d")), result.cells)
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
