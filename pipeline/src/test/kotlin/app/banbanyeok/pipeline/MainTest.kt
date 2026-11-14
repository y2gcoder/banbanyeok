package app.banbanyeok.pipeline

import io.kotest.core.spec.style.DescribeSpec
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class MainTest :
    DescribeSpec({
        describe("pipeline contracts") {
            it("parsesMinutesAndSecondsStrictly") {
                assertEquals(120, duration("02:00"))
                assertEquals(133, duration("02:13"))
                assertFailsWith<IllegalArgumentException> { duration("2:99") }
            }

            it("csvPreservesQuotedCommaAndEmptyCells") {
                assertEquals(listOf(listOf("a,b", "", "c")), csv("\"a,b\",,c\r\n"))
            }

            it("shortestPathChoosesFewerTransfersOnlyWhenTimeTies") {
                val graph = listOf(listOf(Edge(1, 20, 1), Edge(2, 10, 0)), emptyList(), listOf(Edge(1, 10, 0)))
                val result = shortest(graph, mapOf(0 to 0))
                assertEquals(Cost(20, 0), result[1])
            }

            it("branchRootsAndOneWayLoopAreExplicit") {
                val rules = NetworkRules(parseObject(Path.of("../data/config/network-rules.json").readText()))
                assertEquals("성수", rules.predecessor("2", "용답", "시청"))
                assertEquals("신도림", rules.predecessor("2", "도림천", "신설동"))
                assertEquals("강동", rules.predecessor("5", "둔촌동", "하남검단산"))
                assertEquals(false, rules.bidirectional("6", "응암", "역촌"))
                assertEquals(true, rules.bidirectional("6", "응암", "새절"))
            }

            it("rejectsHtmlEvenWithSuccessfulDownloadStatus") {
                assertFailsWith<IllegalArgumentException> {
                    checkSource(sources[1], "<html>error</html>".toByteArray(), "text/html")
                }
                assertFailsWith<IllegalArgumentException> {
                    checkSource(sources[1], "<html>error</html>".toByteArray(), "application/octet-stream")
                }
            }

            it("stateTriangleGateDetectsCorruptDistance") {
                val distances =
                    listOf(
                        listOf(Cost(0, 0), Cost(10, 0), Cost(30, 0)),
                        listOf(infinity, Cost(0, 0), Cost(10, 0)),
                        listOf(infinity, infinity, Cost(0, 0)),
                    )
                assertEquals(1, stateTriangles(distances))
            }

            it("physicalTriangleViolationIsBoundedBySkippedTransfer") {
                val stationA =
                    app.banbanyeok.schema.Station(
                        "001",
                        "A",
                        app.banbanyeok.schema.StationStatus.ACTIVE,
                        37.0,
                        127.0,
                        listOf("1"),
                        emptyList(),
                        emptyMap(),
                        1,
                    )
                val stationB = stationA.copy(code = "002", name = "B")
                val stationC = stationA.copy(code = "003", name = "C")
                val registry = app.banbanyeok.schema.Registry(1, 1, listOf(stationA, stationB, stationC))
                val graph =
                    listOf(
                        listOf(Edge(1, 120, 0)),
                        listOf(Edge(0, 120, 0), Edge(2, 360, 1)),
                        listOf(Edge(1, 360, 1), Edge(3, 120, 0)),
                        listOf(Edge(2, 120, 0)),
                    )
                val net =
                    Network(
                        registry,
                        registry,
                        registry.stations,
                        listOf(
                            "001" to "1",
                            "002" to "1",
                            "002" to "2",
                            "003" to "2",
                        ),
                        graph,
                        mapOf("1" to 60, "2" to 60),
                        emptyList(),
                    )
                val costs = matrixCosts(net)
                assertEquals(660, costs[0][2].seconds)
                assertEquals(costs[0][2], costs[2][0])
                assertEquals(300, physicalTriangleBounds(net)[1])
                assertEquals(true, graphGate(net, costs).passed)
                val corrupt = costs.map { it.toMutableList() }
                corrupt[0][2] = Cost(661, 1)
                assertEquals(false, graphGate(net, corrupt).passed)
            }
            it("mixedSourceDatesDoNotBecomeFalseFreshnessClaims") {
                assertEquals("2026-06-18", normalizedSourceDate("46191"))
                assertEquals("2024-08-12", normalizedSourceDate("20240812"))
                assertEquals(null, normalizedSourceDate("1900-01-00"))
                assertEquals(null, normalizedSourceDate(""))
            }
        }
    })
