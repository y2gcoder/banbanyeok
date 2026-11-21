package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.compileLastTrains
import app.banbanyeok.pipeline.lasttrain.input.ltOfficialSamples
import app.banbanyeok.pipeline.lasttrain.model.LastTrainInputs
import app.banbanyeok.pipeline.lasttrain.model.LtConfig
import app.banbanyeok.pipeline.lasttrain.model.LtNoticeSeen
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorChecks
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorReceipt
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.StationStatus
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private val STATIONS = listOf("A", "B", "C")

private fun station(
    code: String,
    name: String,
) = Station(
    code,
    name,
    StationStatus.ACTIVE,
    37.0,
    127.0,
    listOf("1"),
    emptyList(),
    mapOf("s5" to "record-$name"),
    1,
)

/** One S5 row: the stop of train T1 (A → C, last train of the night) at a station, "00:00:00" for no value. */
private fun s5Row(
    name: String,
    arrival: String,
    departure: String,
): JsonObject =
    buildJsonObject {
        put("LINE_NUM", "01호선")
        put("INOUT_TAG", "1")
        put("TRAIN_NO", "T1")
        put("ORIGINSTATION", "A")
        put("DESTSTATION", "C")
        put("STATION_NM", name)
        put("ARRIVETIME", arrival)
        put("LEFTTIME", departure)
        put("SUBWAYENAME", "C")
    }

private val CONFIG = config(exact = false)

/** Line 1 everywhere; [exact] marks it exact on weekdays (its samples then switch it off instead of failing). */
private fun config(exact: Boolean) =
    LtConfig(
        buildJsonObject {
            put("secondSource", buildJsonObject { putJsonArray("lines") {} })
            put(
                "exact",
                buildJsonObject {
                    if (exact) {
                        put(
                            "1",
                            buildJsonObject {
                                putJsonArray("days") { add("weekday") }
                                put("source", "https://example.test/t")
                                put("checkedAt", "2026-11-21")
                                put("receipt", "S8")
                                put("baseline", "data/config/shinbundang-baseline.json")
                            },
                        )
                    }
                },
            )
            put(
                "days",
                buildJsonObject {
                    DayType.entries.forEach { day ->
                        put(
                            day.id,
                            buildJsonObject {
                                putJsonArray("seoulLines") { add("1") }
                                putJsonArray("tagoGroups") {}
                            },
                        )
                    }
                },
            )
        },
        emptySet(),
    )

/** A tiny line 1 (A–B–C, Seoul Metro rows only) in memory: nothing here is a file. */
private fun inputs(
    config: LtConfig = CONFIG,
    checks: LtOperatorChecks = LtOperatorChecks(emptyList(), emptyList()),
): Pair<LastTrainInputs, Network> {
    val rules =
        NetworkRules(
            parseObject("""{"aliases":{},"predecessors":{},"oneWay":{},"services":{},"sourceLineOverrides":{}}"""),
        )
    val records =
        STATIONS.map {
            Record("record-$it", it, "1호선", 37.0, 127.0, "서울교통공사", it, "1호선", emptySet())
        }
    val origins = STATIONS.mapIndexed { index, name -> station("00${index + 1}", name) }
    val net =
        Network(
            Registry(1, 1, origins),
            Registry(1, 1, origins),
            origins,
            origins.map { it.code to "1" },
            listOf(
                listOf(Edge(1, 120, 0)),
                listOf(Edge(0, 120, 0), Edge(2, 120, 0)),
                listOf(Edge(1, 120, 0)),
            ),
            mapOf("1" to 60),
            emptyList(),
            tagoReport = buildJsonObject { put("edges", JsonArray(emptyList())) },
        )
    val rows =
        listOf(
            s5Row("A", "00:00:00", "23:30:00"),
            s5Row("B", "23:34:00", "23:34:30"),
            s5Row("C", "23:38:00", "00:00:00"),
        )
    return LastTrainInputs(
        config,
        PipelineInput(Registry(1, 1, emptyList()), records, emptyList(), emptyList(), rules, mapOf("1" to 120)),
        DayType.entries.associateWith { rows },
        emptyList(),
        checks,
        "2026-11-16",
    ) to net
}

/** The computation of the last-train table takes its inputs as values (#92): no file is read or written. */
class LastTrainCompilerTest :
    DescribeSpec({
        describe("compiling the last trains of a tiny network from memory") {
            val (given, net) = inputs()
            val artifact = compileLastTrains(given, net, listOf("001"))

            it("showsTheLastTrainThreeMinutesBeforeItLeavesBecauseNothingConfirmsTheSource") {
                // The 23:30 departure of A is boarded at 23:27: S5 alone is not compared with the operator's file here.
                val table = artifact.table
                val toC = table.cell(DayType.WEEKDAY, table.indexOfHome(StationCode.parse("003")), 0)
                val toB = table.cell(DayType.WEEKDAY, table.indexOfHome(StationCode.parse("002")), 0)
                assertEquals(LastTrainKind.MARGIN_DIRECT, toC.kind)
                assertEquals(23 * 60 + 27, toC.minute)
                assertEquals(StationCode.parse("003"), toC.boundFor)
                assertEquals(toC, toB)
                // Nobody rides from a station to itself, and the table has the three day types.
                assertEquals(
                    LastTrainKind.UNKNOWN,
                    table.cell(DayType.WEEKDAY, table.indexOfHome(StationCode.parse("001")), 0).kind,
                )
                assertEquals(
                    toC,
                    table.cell(DayType.HOLIDAY, table.indexOfHome(StationCode.parse("003")), 0),
                )
            }

            it("passesItsGatesAndSaysWhichRulesItUsed") {
                assertTrue(artifact.passed)
                assertEquals("numbered-v1+walk2x5m+source3m", artifact.model)
                assertEquals("2026-11-16", artifact.asOf)
                assertEquals(null, artifact.partialDays)
                assertEquals(true, artifact.report.text("passed").toBoolean())
                assertEquals(
                    DayType.entries.map { it.id }.toSet(),
                    artifact.report
                        .getValue("days")
                        .jsonObject.keys,
                )
            }

            it("handsTheCallerTheOracleProblemInsteadOfWritingIt") {
                val problem = artifact.oracleProblem
                assertEquals(
                    listOf("001", "002", "003"),
                    problem.getValue("homes").jsonArray.map { it.toString().trim('"') },
                )
                assertEquals(listOf("001"), problem.getValue("meetings").jsonArray.map { it.toString().trim('"') })
                assertTrue("allowed" in problem)
            }

            it("switchesAnExactFamilyOffWhenItsSampleFailsButStopsForAnyOtherFailingSample") {
                // A→C weekday: the 23:30 train to C. A sample a minute off fails.
                val wrong =
                    ltOfficialSamples(
                        "meeting,home,day,time,bound,family,url,checkedAt\n" +
                            "A,C,weekday,23:31,C,1,https://example.test/t,2026-11-21\n",
                    )
                val notice = LtNoticeSeen("1358", "변경", "bed5cb7e")
                val receipts = mapOf("1" to LtOperatorReceipt("S8", "2026-11-21", "2026-11-06", notice))
                val checks =
                    LtOperatorChecks(
                        wrong,
                        emptyList(),
                        receipts,
                        "2026-11-16",
                        mapOf("1" to notice),
                        mapOf("1" to operatorEvidence()),
                    )
                val (soft, softNet) = inputs(config(exact = true), checks)
                val off = compileLastTrains(soft, softNet, listOf("001"))
                assertTrue(off.passed)
                val switch =
                    off.report
                        .getValue("exactSwitches")
                        .jsonArray
                        .single()
                        .jsonObject
                assertEquals(false, switch.text("on").toBoolean())
                assertEquals(
                    "1 of 1 samples failed",
                    switch
                        .getValue("reasons")
                        .jsonArray
                        .single()
                        .jsonPrimitive.content,
                )
                // The same sample of a line that is not exact stops the build, as before.
                val (hard, hardNet) = inputs(CONFIG, checks)
                assertFalse(compileLastTrains(hard, hardNet, listOf("001")).passed)
            }

            it("givesTheSameTableEveryTime") {
                val again = compileLastTrains(given, net, listOf("001"))
                assertEquals(artifact.table, again.table)
                assertEquals(artifact.report, again.report)
                assertEquals(artifact.oracleProblem, again.oracleProblem)
            }
        }
    })
