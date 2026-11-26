package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainCell
import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.schema.LtBinCodec
import app.banbanyeok.schema.StationCode
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.JsonObject
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

private const val H23 = 23 * 3600

private fun stop(
    index: Int,
    arrival: Int?,
    departure: Int?,
) = NumberedStop(index, arrival, departure)

private val numbered =
    BusanLine(
        listOf("b01", "b02", "b03", "b04").map { BusanStop(it, it) },
        listOf(
            BusanTrain(
                "1",
                "weekday",
                listOf(stop(0, null, H23), stop(1, H23 + 120, H23 + 150), stop(2, H23 + 300, null)),
            ),
            BusanTrain(
                "2",
                "weekday",
                listOf(
                    stop(1, null, H23 + 1800),
                    stop(2, H23 + 1920, H23 + 1950),
                    stop(
                        3,
                        H23 + 2100,
                        null,
                    ),
                ),
            ),
            BusanTrain("3", "saturday", listOf(stop(0, null, H23 + 600), stop(1, H23 + 720, null))),
        ),
    )

private fun config() =
    BusanLtConfig(
        "checks.csv",
        mapOf(
            "H1" to BusanLtTable("H1", "B1", listOf("L1"), "h1sha", "2026-08-24", "2026-11-26"),
            "K2" to BusanLtTable("K2", "S6-busan", listOf("L2"), "k2sha", "2026-09-01", "2026-11-26"),
        ),
        mapOf(
            "L1" to BusanLtLine("H1", mapOf(DayType.WEEKDAY to "weekday")),
            "L2" to BusanLtLine("K2", mapOf(DayType.WEEKDAY to "01")),
        ),
    )

private fun receipt(vararg fields: Pair<String, Any?>): JsonObject = obj(*fields)

private fun evidence(
    h1: String = "h1sha",
    checks: String = "csvsha",
    b1: String = "b1sha",
    tagoFetchedOn: String = "2026-11-25",
) = BusanLtEvidence(
    config(),
    checks(),
    mapOf(
        "H1" to receipt("sha256" to h1, "checks_sha256" to "csvsha", "checked_against" to obj("B1" to "b1sha")),
        "K2" to
            receipt(
                "sha256" to "k2sha",
                "checks_sha256" to "csvsha",
                "checked_against" to obj("S6-busan" to "tagosha"),
            ),
        "B1" to receipt("sha256" to b1),
        "S6-busan" to receipt("sha256" to "tagosha"),
    ),
    checks,
    tagoFetchedOn,
)

private val stations = mapOf("L1" to listOf("a01", "a02"), "L2" to listOf("a02", "a03"))

private val computed =
    mapOf(
        "L1" to mapOf(("a01" to "a02") to BusanLtDirect.Train(BusanLtTrain(H23 + 1450, "a02", false))),
        "L2" to mapOf(("a02" to "a03") to BusanLtDirect.Train(BusanLtTrain(H23 + 2730, "a03", false))),
    )

private fun checks(
    l1: String = "agree",
    l1Time: String = "23:24:10",
) = mapOf(
    BusanLtKey(DayType.WEEKDAY, "L1", "a01", "a02") to BusanLtCheck(l1Time, "a02", l1),
    BusanLtKey(DayType.WEEKDAY, "L1", "a02", "a01") to BusanLtCheck("", "", "missing"),
    BusanLtKey(DayType.WEEKDAY, "L2", "a02", "a03") to BusanLtCheck("23:45:30", "a03", "agree"),
)

private fun block(
    config: BusanLtConfig = config(),
    evidence: BusanLtEvidence = evidence(),
    checks: Map<BusanLtKey, BusanLtCheck> = checks(),
    homes: Set<String> = setOf("a01", "a02", "a03"),
    asOf: String = "2026-11-16",
) = busanLastTrains(
    evidence.copy(config = config, checks = checks),
    BusanLtNetwork({ line, _ -> computed.getValue(line) }, stations::getValue, setOf("a01", "a02"), homes),
    asOf,
)

private fun cell(
    kind: LastTrainKind,
    minute: Int,
    bound: String,
) = LastTrainCell(kind, minute, StationCode.parse(bound))

private val capitalTable =
    LastTrainTable(
        3,
        intArrayOf(StationCode.parse("c01").value, StationCode.parse("c02").value),
        intArrayOf(StationCode.parse("c02").value),
        IntArray(6) { if (it % 2 == 0) LastTrainTable.NONE else 1400 + it },
        IntArray(6) { if (it % 2 == 0) 0 else 1 },
        IntArray(6) { if (it % 2 == 0) LastTrainTable.NONE else StationCode.parse("c03").value },
    )

private fun regional(busan: BusanLastTrains) =
    regionalLastTrainTable(
        capitalTable,
        busan,
        listOf("a01", "a02", "a03", "c01", "c02"),
        listOf("a01", "a02", "c02"),
        3,
    )

class BusanLastTrainTest :
    DescribeSpec({
        describe("the computed directs") {
            it("take the train boarding last at the meeting station that stops at home, with its arrival there") {
                val directs = numberedBusanDirects(numbered, "weekday")
                assertEquals(BusanLtDirect.Train(BusanLtTrain(H23 + 1800, "b04", true)), directs["b02" to "b03"])
                assertEquals(BusanLtDirect.Train(BusanLtTrain(H23 + 1920, "b04", false)), directs["b03" to "b04"])
                assertEquals(BusanLtDirect.Train(BusanLtTrain(H23, "b03", true)), directs["b01" to "b03"])
                assertEquals(null, directs["b01" to "b04"])
                assertEquals(null, directs["b03" to "b02"])
            }

            it("are ambiguous when trains boarding at the same second disagree") {
                val tie =
                    numbered.copy(
                        trains =
                            listOf(
                                BusanTrain(
                                    "1",
                                    "weekday",
                                    listOf(
                                        stop(0, null, H23),
                                        stop(1, H23 + 60, H23 + 90),
                                        stop(
                                            2,
                                            H23 + 200,
                                            null,
                                        ),
                                    ),
                                ),
                                BusanTrain("2", "weekday", listOf(stop(0, null, H23), stop(1, H23 + 60, null))),
                            ),
                    )
                assertEquals(BusanLtDirect.Ambiguous, numberedBusanDirects(tie, "weekday")["b01" to "b02"])
            }

            it("take the TAGO departure last whose terminus is at or beyond home, in either direction") {
                val order = listOf("d01", "d02", "d03", "d04")
                val rows = mapOf("d02" to setOf(H23 to "d04", H23 + 600 to "d03", H23 + 900 to "d01"))
                val directs = tagoBusanDirects(order, rows)
                assertEquals(BusanLtDirect.Train(BusanLtTrain(H23, "d04", false)), directs["d02" to "d04"])
                assertEquals(BusanLtDirect.Train(BusanLtTrain(H23 + 600, "d03", false)), directs["d02" to "d03"])
                assertEquals(BusanLtDirect.Train(BusanLtTrain(H23 + 900, "d01", false)), directs["d02" to "d01"])
            }
        }

        describe("the Busan block") {
            it("shows an agreed 1~4호선 cell as a margin arrival minute and an agreed 동해선 cell as direct") {
                val cells = block().cells
                assertEquals(
                    cell(LastTrainKind.MARGIN_DIRECT, 1404, "a02"),
                    cells[Triple(DayType.WEEKDAY, "a02", "a01")],
                )
                assertEquals(cell(LastTrainKind.DIRECT, 1425, "a03"), cells[Triple(DayType.WEEKDAY, "a03", "a02")])
                assertEquals(2, cells.size)
            }

            it("switches a cell off when its operator table differs, it starts there, or home is no origin") {
                assertEquals(
                    setOf("a03"),
                    block(checks = checks("differs"))
                        .cells.keys
                        .map { it.second }
                        .toSet(),
                )
                assertEquals(
                    setOf("a03"),
                    block(checks = checks("origin"))
                        .cells.keys
                        .map { it.second }
                        .toSet(),
                )
                assertEquals(
                    setOf("a02"),
                    block(homes = setOf("a02"))
                        .cells.keys
                        .map { it.second }
                        .toSet(),
                )
            }

            it("switches one operator table's lines off by its evidence, leaving the other table on") {
                for (stale in listOf(evidence(h1 = "other"), evidence(b1 = "other"), evidence(checks = "other"))) {
                    val result = block(evidence = stale)
                    if (stale.checksSha256 == "other") {
                        assertTrue(result.cells.isEmpty())
                    } else {
                        assertEquals(
                            setOf("a03"),
                            result.cells.keys
                                .map { it.second }
                                .toSet(),
                        )
                    }
                }
                assertEquals(
                    setOf("a02"),
                    block(evidence = evidence(tagoFetchedOn = "2026-11-11"))
                        .cells.keys
                        .map {
                            it.second
                        }.toSet(),
                )
                assertTrue(block(asOf = "2026-11-27").cells.isEmpty())
            }

            it("stops when its own computation disagrees with the committed checks, unless the table is off") {
                assertFailsWith<IllegalArgumentException> { block(checks = checks(l1Time = "23:25:00")) }
                assertEquals(
                    1,
                    block(evidence = evidence(h1 = "other"), checks = checks(l1Time = "23:25:00")).cells.size,
                )
            }
        }

        describe("the regional table") {
            it("keeps every capital cell byte for byte, whatever the Busan block holds") {
                val on = regional(block())
                val off = regional(block(evidence = evidence(checks = "other")))
                val expected = LtBinCodec.encode(capitalTable)
                assertTrue(LtBinCodec.encode(projectLastTrains(on, capitalTable)).contentEquals(expected))
                assertTrue(LtBinCodec.encode(projectLastTrains(off, capitalTable)).contentEquals(expected))
                assertEquals(
                    LastTrainCell.UNKNOWN,
                    on.cell(
                        DayType.WEEKDAY,
                        on.indexOfHome(StationCode.parse("c01")),
                        on.indexOfMeeting(StationCode.parse("a01")),
                    ),
                )
            }

            it("keeps every Busan cell whatever the capital table holds") {
                val busan = block()
                val other =
                    regionalLastTrainTable(
                        LastTrainTable(
                            3,
                            intArrayOf(
                                StationCode.parse("c01").value,
                            ),
                            intArrayOf(StationCode.parse("c02").value),
                            IntArray(3) {
                                -1
                            },
                            IntArray(3),
                            IntArray(3) { -1 },
                        ),
                        busan,
                        listOf("a01", "a02", "a03", "c01", "c02"),
                        listOf("a01", "a02", "c02"),
                        3,
                    )
                val table = regional(busan)
                for (day in DayType.entries) {
                    for (home in listOf("a01", "a02", "a03")) {
                        for (meeting in listOf("a01", "a02")) {
                            val row = table.indexOfHome(StationCode.parse(home))
                            val column = table.indexOfMeeting(StationCode.parse(meeting))
                            assertEquals(table.cell(day, row, column), other.cell(day, row, column))
                            assertEquals(
                                busan.cells[Triple(day, home, meeting)] ?: LastTrainCell.UNKNOWN,
                                table.cell(day, row, column),
                            )
                        }
                    }
                }
            }
        }
    })
