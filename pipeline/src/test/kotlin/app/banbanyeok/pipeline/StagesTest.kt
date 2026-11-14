package app.banbanyeok.pipeline

import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.RegistryCompatibility
import app.banbanyeok.schema.StationStatus
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

private fun fixtureRules(): NetworkRules =
    NetworkRules(
        parseObject(
            """{"aliases":{"구역":"새역"},"predecessors":{},"oneWay":{"1":["A","B","C"]},
      "services":{},"sourceLineOverrides":{}}""",
        ),
    )

private fun record(
    name: String,
    line: String = "1호선",
): Record =
    Record(
        name,
        name,
        line,
        37.0,
        127.0,
        "서울교통공사",
        name,
        line,
        emptySet(),
    )

private fun departure(
    time: String,
    direction: String = "1",
    branch: String = "",
): JsonObject =
    obj(
        "LINE_NUM" to "01호선",
        "STATION_CD" to "0150",
        "INOUT_TAG" to direction,
        "WEEK_TAG" to "1",
        "LEFTTIME" to time,
        "TRAIN_NO" to time,
        "BRANCH_LINE" to branch,
        "EXPRESS_YN" to "G",
    )

class StagesTest :
    DescribeSpec({
        describe("pure parsing and normalization") {
            it("normalizes configured aliases while preserving unrelated names") {
                assertEquals("새역", fixtureRules().canonical("구역역(구명)"))
                assertEquals("A", fixtureRules().canonical("A역"))
            }
            it("escapes control characters using the serialization library") {
                val value = "a\u0001\n\"\\"
                assertEquals(value, parseObject(obj("value" to value).toString()).text("value"))
            }
            it("rejects incomplete quoted CSV") {
                assertFailsWith<IllegalArgumentException> { csv("\"abc") }
            }
            it("preserves empty cells and BOM") {
                assertEquals(listOf(listOf("a", "", "")), csv("\uFEFFa,,\n"))
            }
        }
        describe("append-only registry") {
            it("keeps codes and addedIn without consulting random on replay") {
                val rules = fixtureRules()
                val initial =
                    RegistryBuilder(
                        Registry(1, 1, emptyList()),
                        listOf(record("A")),
                        rules,
                        CodeSource { 15 },
                    ).build()
                val replay =
                    RegistryBuilder(
                        initial,
                        listOf(record("A")),
                        rules,
                        CodeSource { error("Unexpected allocation") },
                    ).build()
                assertEquals(initial, replay)
                val values = listOf(15, 16).iterator()
                val appended =
                    RegistryBuilder(
                        initial,
                        listOf(record("A"), record("B")),
                        rules,
                        CodeSource { values.next() },
                    ).build()
                assertEquals(initial.stations.single(), appended.stations.first())
                assertEquals(3, appended.registryVersion)
                assertTrue(RegistryCompatibility.checkAppendOnly(initial, appended).isEmpty())
            }
            it("rejects dropped codes and reactivated deprecated stations") {
                val initial =
                    RegistryBuilder(
                        Registry(1, 1, emptyList()),
                        listOf(record("A")),
                        fixtureRules(),
                        CodeSource {
                            15
                        },
                    ).build()
                assertTrue(
                    RegistryCompatibility.checkAppendOnly(initial, initial.copy(stations = emptyList())).isNotEmpty(),
                )
                val retired =
                    initial.copy(
                        registryVersion = 3,
                        stations =
                            initial.stations.map {
                                it.copy(status = StationStatus.DEPRECATED, deprecatedIn = 3)
                            },
                    )
                assertTrue(
                    RegistryCompatibility.checkAppendOnly(retired, initial.copy(registryVersion = 4)).isNotEmpty(),
                )
            }
        }
        describe("small one-way graph and OD golden") {
            it("builds an entire graph from memory and preserves directed cycle distances") {
                val records = listOf(record("A"), record("B"), record("C"))
                val next = listOf(1, 2, 3).iterator()
                val input =
                    PipelineInput(
                        Registry(1, 1, emptyList()),
                        records,
                        listOf(
                            listOf("0", "1", "A", "00:00"),
                            listOf("1", "1", "B", "01:00"),
                            listOf("2", "1", "C", "02:00"),
                            listOf("3", "1", "A", "03:00"),
                        ),
                        emptyList(),
                        fixtureRules(),
                        mapOf("1" to 120),
                    )
                val net = network(input, CodeSource { next.next() })
                assertEquals(
                    listOf(listOf(Edge(1, 60, 0)), listOf(Edge(2, 120, 0)), listOf(Edge(0, 180, 0))),
                    net.graph,
                )
                assertEquals(
                    listOf(listOf(0, 120, 240), listOf(360, 0, 180), listOf(240, 300, 0)),
                    matrixCosts(net).map { row -> row.map { it.seconds } },
                )
                assertTrue(graphGate(net, matrixCosts(net)).passed)
            }
        }
        describe("branch boarding golden") {
            it("requires walking and reboarding between the main and branch train") {
                val rules =
                    NetworkRules(
                        parseObject(
                            """{"aliases":{},"predecessors":{"2:X":"A"},"oneWay":{},
                "services":{"2branch":{"line":"2","stations":["X"],"root":"A"}},"sourceLineOverrides":{}}""",
                        ),
                    )
                val next = listOf(1, 2, 3).iterator()
                val input =
                    PipelineInput(
                        Registry(1, 1, emptyList()),
                        listOf(record("A", "2호선"), record("B", "2호선"), record("X", "2호선")),
                        listOf(
                            listOf("0", "2", "A", "00:00"),
                            listOf("1", "2", "B", "01:00"),
                            listOf("2", "2", "X", "01:30"),
                        ),
                        listOf(listOf("0", "2", "A", "2호선", "72", "01:00")),
                        rules,
                        mapOf("2" to 120),
                    )
                val net = network(input, CodeSource { next.next() })
                val costs = matrixCosts(net)
                assertEquals(Cost(150, 0), costs[0][2])
                assertEquals(Cost(330, 1), costs[1][2])
                assertTrue(graphGate(net, costs).passed)
            }
        }
        describe("explicit network commands") {
            it("fails clearly on missing credentials without filesystem or HTTP") {
                val failure =
                    assertFailsWith<IllegalArgumentException> {
                        refreshHeadways(
                            Path.of("missing-root"),
                            key = null,
                            http =
                                PipelineHttp {
                                    _,
                                    _,
                                    ->
                                    error("Unexpected HTTP")
                                },
                        )
                    }
                assertTrue(failure.message.orEmpty().contains("SEOUL_OPENAPI_KEY is required"))
            }
            it("redacts URI parsing failures and removes their causes") {
                val failure =
                    assertFailsWith<IllegalStateException> {
                        JdkPipelineHttp().request("invalid secret URI", null)
                    }
                assertTrue(!failure.toString().contains("invalid secret URI"))
                assertEquals(null, failure.cause)
            }
        }
        describe("timetable to headway") {
            it("loads recorded API response without network") {
                val text = requireNotNull(javaClass.getResource("/seoul-timetable-recorded.json")).readText()
                val page = timetablePage(text)
                assertEquals(120, page.total)
                assertEquals(5, page.rows.size)
                assertTrue(stationHeadways(page.rows).isEmpty())
            }
            it("handles both zero-hour and extended-hour midnight times") {
                assertEquals(serviceSeconds("24:10:00"), serviceSeconds("00:10:00"))
                assertEquals(86400 + 3600, serviceSeconds("01:00:00"))
                assertFailsWith<IllegalArgumentException> { serviceSeconds("29:80:00") }
            }
            it("separates directions and branches and deduplicates trains") {
                val rows =
                    listOf(
                        departure("10:00:00"),
                        departure("10:10:00"),
                        departure("10:10:00"),
                        departure("10:00:00", "2"),
                        departure("10:20:00", "2"),
                        departure("12:00:00", branch = "branch"),
                    )
                val result = stationHeadways(rows)
                assertEquals(listOf("600", "1200"), result.map { it.text("seconds") })
                assertEquals(listOf("1", "1"), result.map { it.text("intervalCount") })
            }
            it("excludes out of period trains and treats insufficient rows as missing") {
                assertTrue(stationHeadways(listOf(departure("09:59:59"), departure("16:00:01"))).isEmpty())
                assertTrue(stationHeadways(listOf(departure("10:00:00"))).isEmpty())
                val empty = timetablePage("""{"RESULT":{"CODE":"INFO-200","MESSAGE":"none"}}""")
                assertTrue(empty.rows.isEmpty())
                assertFailsWith<IllegalArgumentException> { timetablePage("""{"RESULT":{"CODE":"ERROR-300"}}""") }
            }
            it("preserves estimates for incomplete directions and computes complete line means") {
                val original = parseObject(Path.of("../data/config/headways.json").readText())
                val rows =
                    listOf(
                        departure("10:00:00"),
                        departure("10:10:00"),
                        departure("10:00:00", "2"),
                        departure("10:20:00", "2"),
                    )
                val updated = updatedHeadways(original, rows, "2026-11-14T00:00:00Z")
                assertEquals(
                    "900",
                    updated
                        .getValue("lines")
                        .jsonObject
                        .getValue("1")
                        .jsonObject
                        .text("seconds"),
                )
                assertEquals(2, updated.getValue("directions").jsonArray.size)
                assertEquals(
                    original.getValue("lines").jsonObject.getValue("8"),
                    updated.getValue("lines").jsonObject.getValue("8"),
                )
            }
        }
    })
