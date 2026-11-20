package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.compute.LtRebuiltDirect
import app.banbanyeok.pipeline.lasttrain.compute.ltFamilyDirect
import app.banbanyeok.pipeline.lasttrain.compute.ltLatestTimetableChange
import app.banbanyeok.pipeline.lasttrain.compute.ltWithProvenDirect
import app.banbanyeok.pipeline.lasttrain.gate.LT_OPERATOR_MAX_AGE_DAYS
import app.banbanyeok.pipeline.lasttrain.gate.ltExactSwitches
import app.banbanyeok.pipeline.lasttrain.gate.ltOfficialReport
import app.banbanyeok.pipeline.lasttrain.gate.provenRides
import app.banbanyeok.pipeline.lasttrain.gate.unbackedExact
import app.banbanyeok.pipeline.lasttrain.input.ltAsOf
import app.banbanyeok.pipeline.lasttrain.input.ltOfficialSamples
import app.banbanyeok.pipeline.lasttrain.input.ltOperatorReceipts
import app.banbanyeok.pipeline.lasttrain.input.parseShinbundangNotice
import app.banbanyeok.pipeline.lasttrain.input.shinbundangTimetableTitle
import app.banbanyeok.pipeline.lasttrain.model.LtCell
import app.banbanyeok.pipeline.lasttrain.model.LtConfig
import app.banbanyeok.pipeline.lasttrain.model.LtDayResult
import app.banbanyeok.pipeline.lasttrain.model.LtDirect
import app.banbanyeok.pipeline.lasttrain.model.LtFamilies
import app.banbanyeok.pipeline.lasttrain.model.LtOfficialSample
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorChecks
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorReceipt
import app.banbanyeok.pipeline.lasttrain.model.LtProblem
import app.banbanyeok.pipeline.lasttrain.model.LtWalks
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationStatus
import io.kotest.core.spec.style.DescribeSpec
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// Family "S" plays 신분당선 (no train numbers, compared with the operator's station pages), "3" plays line 3
// (numbered, gives times on its own) and "Q" plays 수인분당선 (no train numbers, gives no time while rebuilding is off).

private fun origin(code: String) =
    Station(code, code, StationStatus.ACTIVE, 37.5, 127.0, emptyList(), emptyList(), emptyMap(), 1)

/** Two meeting stations (m1, m2) and two homes (h1, h2): cell = home × 2 + meeting. */
private val problem =
    LtProblem(
        listOf("h1", "h2"),
        listOf("m1", "m2"),
        LtFamilies(emptyMap()),
        emptyMap(),
        emptyMap(),
        LtWalks(emptyMap(), emptyMap()),
        mapOf(DayType.WEEKDAY to setOf("S"), DayType.HOLIDAY to setOf("S")),
    )
private val origins = listOf("h1", "h2", "m1", "m2").map(::origin)

private fun cell(
    home: String,
    meeting: String,
) = problem.homes.indexOf(home) * 2 + problem.meetings.indexOf(meeting)

private fun at(
    hour: Int,
    minute: Int,
) = hour * 3600 + minute * 60

private fun train(
    departure: Int,
    bound: String,
    family: String,
    verified: Boolean = false,
) = LtDirect(departure, departure, bound, family, verified)

/**
 * m1 → h1 (신사 → 양재): S leaves at 24:22 for h2, a confirmed line 3 train at 24:45 for h1 — line 3 is the cell's
 * last single train. m2 → h2 (정자 → 미금): S leaves at 23:49, Q (no time of its own) at 24:22; no numbered train.
 */
private val result =
    LtDayResult(
        listOf(LtCell(LastTrainKind.DIRECT.raw, 24 * 60 + 45, "h1"), LtCell.UNKNOWN, LtCell.UNKNOWN, LtCell.UNKNOWN),
        intArrayOf(at(24, 45), -1, -1, -1),
        listOf(train(at(24, 45), "h1", "3", verified = true), null, null, null),
    )
private val rebuilt =
    LtRebuiltDirect(
        mapOf(
            "S" to
                mapOf(
                    cell("h1", "m1") to train(at(24, 22), "h2", "S"),
                    cell("h2", "m2") to train(at(23, 49), "h2", "S"),
                ),
            "Q" to mapOf(cell("h2", "m2") to train(at(24, 22), "h2", "Q")),
        ),
    )

private fun samples(vararg rows: String): List<LtOfficialSample> =
    ltOfficialSamples(
        "meeting,home,day,time,bound,family,url,checkedAt\n" +
            rows.joinToString("") { "$it,https://example.test/sb,2026-11-21\n" },
    )

private val SAMPLES =
    samples(
        "m1,h1,weekday,24:22,h2,S",
        "m2,h2,weekday,23:49,h2,S",
        "m1,h1,holiday,24:22,h2,S",
        "m2,h2,holiday,23:49,h2,S",
    )

private fun report(samples: List<LtOfficialSample>) =
    ltOfficialReport(samples, problem, origins) { _, index, family -> ltFamilyDirect(result, rebuilt, family, index) }

private val CONFIG =
    LtConfig(
        parseObject(
            """{"days":{"weekday":{"seoulLines":["3"],"tagoGroups":["S","Q"]},
                "saturday":{"seoulLines":["3"],"tagoGroups":[]},
                "holiday":{"seoulLines":["3"],"tagoGroups":["S","Q"]}},
                "exact":{"S":{"days":["weekday","holiday"],"source":"https://example.test/sb","checkedAt":"2026-11-21",
                "receipt":"S8"}},"secondSource":{"lines":[]}}""",
        ),
        setOf("S", "Q"),
    )

private fun checks(
    fetchedOn: String = "2026-11-21",
    latestChange: String = "2026-11-06",
    tago: String? = "2026-11-16",
    receipt: String = "S8",
) = LtOperatorChecks(emptyList(), emptyList(), mapOf("S" to LtOperatorReceipt(receipt, fetchedOn, latestChange)), tago)

class LastTrainExactSwitchTest :
    DescribeSpec({
        describe("a sample compared with its own family's last train in the cell") {
            it("passesWhereAnotherLineIsLaterAndTheCellKeepsTheLaterLine") {
                // The cell's last single train overall is line 3's: compared with that, the S sample would fail.
                assertEquals("3", result.direct[cell("h1", "m1")]?.group)
                val official = report(SAMPLES)
                assertTrue(official.all { it.text("passed") == "true" })
                val proven = problem.copy(proven = provenRides(SAMPLES, official, CONFIG, origins))
                val cells = ltWithProvenDirect(proven, DayType.WEEKDAY, result, rebuilt).cells
                // The answer is still the later of the two confirmed direct trains: line 3 at 24:45.
                assertEquals(LtCell(LastTrainKind.DIRECT.raw, 24 * 60 + 45, "h1"), cells[cell("h1", "m1")])
            }

            it("givesTheFamilysOwnEarlierTrainWhereTheLaterLineGivesNoTime") {
                // 정자 → 미금: Q's 24:22 is later, but Q gives no time with rebuilding off. The cell shows S's 23:49,
                // earlier than the real last train, which is the side a published time may err on.
                assertEquals("Q", rebuilt[cell("h2", "m2")]?.group)
                val official = report(SAMPLES)
                val proven = problem.copy(proven = provenRides(SAMPLES, official, CONFIG, origins))
                val cells = ltWithProvenDirect(proven, DayType.WEEKDAY, result, rebuilt).cells
                assertEquals(LtCell(LastTrainKind.DIRECT.raw, 23 * 60 + 49, "h2"), cells[cell("h2", "m2")])
                // Nothing is proven where no sample is: m1 → h2 stays unknown.
                assertEquals(LtCell.UNKNOWN, cells[cell("h2", "m1")])
            }

            it("stillFailsAMinuteOffAWrongTerminalOrAnotherFamily") {
                val official =
                    report(
                        samples(
                            "m1,h1,weekday,24:21,h2,S",
                            "m1,h1,weekday,24:22,h1,S",
                            "m1,h1,weekday,24:45,h1,Q",
                            "m2,h1,weekday,24:22,h2,S",
                        ),
                    )
                assertEquals(listOf("false", "false", "false", "false"), official.map { it.text("passed") })
            }
        }

        describe("an exact family in last-train.json") {
            fun config(exact: String) =
                parseObject(
                    """{"days":{"weekday":{"seoulLines":["3"],"tagoGroups":["S"]},
                        "saturday":{"seoulLines":["3"],"tagoGroups":[]},
                        "holiday":{"seoulLines":["3"],"tagoGroups":["S"]}},
                        "exact":{"S":$exact},"secondSource":{"lines":[]}}""",
                )
            val source = """"source":"https://example.test/sb","checkedAt":"2026-11-21""""

            it("namesTheReceiptOfItsOperatorTimetable") {
                assertEquals(mapOf("S" to "S8"), CONFIG.exactReceipts)
                assertFailsWith<IllegalArgumentException> {
                    LtConfig(config("""{"days":["weekday"],$source}"""), setOf("S"))
                }
            }

            it("isNeverExactOnSaturdayWhereNoTagoFamilyIsComputed") {
                // The operator's table is one table for weekends and holidays; Saturday borrows no other day's rows.
                assertFailsWith<IllegalArgumentException> {
                    LtConfig(config("""{"days":["saturday"],$source,"receipt":"S8"}"""), setOf("S"))
                }
            }
        }

        describe("switching an exact family off by day type") {
            it("turnsOffOnlyTheDayTypeWhoseSampleIsAMinuteOff") {
                val wrong =
                    samples(
                        "m1,h1,weekday,24:21,h2,S",
                        "m2,h2,weekday,23:49,h2,S",
                        "m1,h1,holiday,24:22,h2,S",
                        "m2,h2,holiday,23:49,h2,S",
                    )
                val official = report(wrong)
                val switches = ltExactSwitches(CONFIG, wrong, official, checks())
                assertEquals(
                    listOf(DayType.WEEKDAY to false, DayType.HOLIDAY to true),
                    switches.map { it.day to it.on },
                )
                assertEquals(listOf("1 of 2 samples failed"), switches.first().reasons)
                val off = switches.filterNot { it.on }.map { it.family to it.day }.toSet()
                val rides = provenRides(wrong, official, CONFIG, origins, off)
                // The weekday's other sample passed but is not trusted either: no weekday cell is confirmed.
                assertEquals(null, rides[DayType.WEEKDAY])
                assertEquals(2, rides.getValue(DayType.HOLIDAY).size)
                val proven = problem.copy(proven = rides)
                assertEquals(
                    LtCell.UNKNOWN,
                    ltWithProvenDirect(proven, DayType.WEEKDAY, result, rebuilt).cells[cell("h2", "m2")],
                )
                assertEquals(
                    LtCell(LastTrainKind.DIRECT.raw, 23 * 60 + 49, "h2"),
                    ltWithProvenDirect(proven, DayType.HOLIDAY, result, rebuilt).cells[cell("h2", "m2")],
                )
                assertEquals(emptyList(), unbackedExact(CONFIG, wrong))
            }

            it("treatsAnExactFamilyDayWithoutAnySampleAsAMistakeInTheConfig") {
                assertEquals(listOf("S/holiday"), unbackedExact(CONFIG, SAMPLES.filter { it.day == DayType.WEEKDAY }))
            }
        }

        describe("receipts without their dates") {
            fun root(manifest: String): java.nio.file.Path {
                val dir =
                    java.nio.file.Files
                        .createTempDirectory("lt-receipts")
                java.nio.file.Files
                    .createDirectories(dir.resolve("data/config"))
                java.nio.file.Files
                    .writeString(dir.resolve("data/config/source-manifest.json"), manifest)
                return dir
            }

            fun receipt(
                id: String,
                fetched: Boolean = true,
            ) = """{"id":"$id",${if (fetched) "\"fetched_at\":\"2026-11-15T16:06:45Z\"," else ""}""" +
                """"latest_timetable_change":"2026-11-06"}"""

            it("stopsTheBuildNamingTheReceiptWhenS6HasNoFetchDate") {
                // #100 review: S6 without fetched_at ended in NoSuchElementException. The table cannot be dated.
                val missing =
                    root("[${receipt("S5")},${receipt("S6", fetched = false)},${receipt("S7")},${receipt("S8")}]")
                val asOf = assertFailsWith<IllegalArgumentException> { ltAsOf(missing) }
                assertTrue(
                    "receipt S6" in asOf.message.orEmpty() && "fetched_at" in asOf.message.orEmpty(),
                    asOf.message,
                )
                val tago = assertFailsWith<IllegalArgumentException> { ltOperatorReceipts(missing, CONFIG) }
                assertTrue("receipt S6" in tago.message.orEmpty(), tago.message)
                assertFailsWith<IllegalArgumentException> { ltOperatorReceipts(root("[${receipt("S8")}]"), CONFIG) }
            }

            it("readsTheDatesOfACompleteManifest") {
                val full = root("[${receipt("S5")},${receipt("S6")},${receipt("S7")},${receipt("S8")}]")
                assertEquals("2026-11-16", ltAsOf(full))
                val (receipts, tago) = ltOperatorReceipts(full, CONFIG)
                assertEquals("2026-11-16", tago)
                assertEquals(LtOperatorReceipt("S8", "2026-11-16", "2026-11-06"), receipts.getValue("S"))
            }
        }

        describe("the conditions under which an exact family is not switched on") {
            fun reasons(checks: LtOperatorChecks) =
                ltExactSwitches(CONFIG, SAMPLES, report(SAMPLES), checks).map { it.on to it.reasons }.distinct()

            it("isOnWhenThePagesAreOfTheTagoCachesTimeAndNoLaterChangeIsAnnounced") {
                // This PR's dates: TAGO 11-16 (Seoul), pages 11-21 (5 days), latest change in effect since 11-06.
                assertEquals(listOf(true to emptyList<String>()), reasons(checks()))
                assertEquals(listOf(true to emptyList<String>()), reasons(checks(latestChange = "2026-11-16")))
                // Fourteen days apart is still on.
                assertEquals(14, LT_OPERATOR_MAX_AGE_DAYS)
                val later = SAMPLES.map { it.copy(checkedAt = "2026-11-30") }
                assertTrue(
                    ltExactSwitches(CONFIG, later, report(later), checks(fetchedOn = "2026-11-30")).all { it.on },
                )
            }

            it("isOffWhenTheOperatorChangedItsTimetableAfterTagoWasFetched") {
                val (on, why) = reasons(checks(latestChange = "2026-11-17")).single()
                assertFalse(on)
                assertEquals(
                    listOf("the operator changed its timetable on 2026-11-17, after TAGO was fetched on 2026-11-16"),
                    why,
                )
            }

            it("isOffWhenANewestNoticeWithAnOddlySpacedTitleTakesEffectAfterTago") {
                // #100 review: one more blank in the title hid the date, 11-06 was kept and both days stayed on.
                val title = "신분당선 열차 운행시각표 변경 시행"
                val newest = parseShinbundangNotice("1359", operatorNotice(title, "2026.11.20", null, "1358" to CHANGE))
                val before = parseShinbundangNotice("1358", operatorNotice(CHANGE, "2026.11.06", "1359" to title, null))
                val latest = ltLatestTimetableChange(listOf(before, newest), ::shinbundangTimetableTitle)
                assertEquals("2026-11-20", latest)
                val switches = ltExactSwitches(CONFIG, SAMPLES, report(SAMPLES), checks(latestChange = latest))
                assertEquals(listOf(false, false), switches.map { it.on })
                assertEquals(
                    "the operator changed its timetable on 2026-11-20, after TAGO was fetched on 2026-11-16",
                    switches.first().reasons.single(),
                )
            }

            it("isOffWhenThePagesAndTagoAreMoreThanFourteenDaysApart") {
                // Fetched with the samples' date moved too, so only the distance counts.
                val late = SAMPLES.map { it.copy(checkedAt = "2026-12-01") }
                val (on, why) =
                    ltExactSwitches(CONFIG, late, report(late), checks(fetchedOn = "2026-12-01"))
                        .map { it.on to it.reasons }
                        .distinct()
                        .single()
                assertFalse(on)
                assertEquals(
                    listOf(
                        "the operator's pages (2026-12-01) and TAGO (2026-11-16) were fetched 15 days apart, more than 14",
                    ),
                    why,
                )
                // Earlier pages count the same way.
                assertFalse(reasons(checks(fetchedOn = "2026-11-01")).single().first)
            }

            it("isOffWithoutAReceiptAFetchDateOfTagoOrSamplesOfTheReceiptsDay") {
                assertEquals(
                    listOf(false to listOf("no receipt S8 for the operator's timetable")),
                    reasons(checks(receipt = "S9")),
                )
                assertEquals(
                    listOf(false to listOf("the TAGO cache (S6) has no fetch date")),
                    reasons(checks(tago = null)),
                )
                assertEquals(
                    listOf(
                        false to listOf("4 samples were not read on 2026-11-20, the day receipt S8 fetched the pages"),
                    ),
                    reasons(checks(fetchedOn = "2026-11-20")),
                )
            }
        }
    })
