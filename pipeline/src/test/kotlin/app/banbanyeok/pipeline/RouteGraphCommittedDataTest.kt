package app.banbanyeok.pipeline

import app.banbanyeok.core.RouteSearch
import app.banbanyeok.schema.TimeSlot
import io.kotest.core.spec.style.DescribeSpec
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private val repo: Path = Path.of("..")
private val dev: Path = repo.resolve("data/artifacts/dev")

/**
 * The committed route graph (#120) against the committed od matrices. CI has no raw sources, so this is where it runs
 * the publish gate: every slot and cell recomputed from rg.bin with the shared route search equals od.bin.
 */
class RouteGraphCommittedDataTest :
    DescribeSpec({
        val dataSet = loadDevArtifacts(dev)
        val graph = requireNotNull(loadDevRouteGraph(dev, dataSet)) { "dev artifacts have no route graph" }

        describe("the committed route graph") {
            it("reproducesEveryOdCellOfEverySlot") {
                val gate = routeGate(graph, TimeSlot.ALL.associateWith { requireNotNull(dataSet.odFor(it)) })
                assertTrue(gate.passed, gate.problems.joinToString("\n"))
                assertEquals(12L * dataSet.od.originCount * dataSet.od.candidateCount, gate.cells)
            }

            it("namesOnlyLinesTheWebColours") {
                // web/src/lib/stations/lines.ts LINE_COLORS의 키. 여기 없는 이름은 웹에서 중립색이 된다.
                val webLines =
                    Regex("""^\s+"?([^":]+)"?: "#[0-9a-f]{6}",$""", RegexOption.MULTILINE)
                        .findAll(repo.resolve("web/src/lib/stations/lines.ts").readText())
                        .map { it.groupValues[1] }
                        .toSet()
                assertTrue(webLines.size >= 20, "parsed $webLines")
                assertTrue(webLines.containsAll(graph.lines), "${graph.lines - webLines}")
            }

            it("showsTheKakaoFirstRouteForOnePairTheFastestRouteMissed") {
                // #120 카카오 대조 7번: 최단(2호선 → 시청 1호선 → 서울역 4호선, 환승 2)보다 113초 느린 환승 1번 길을 보인다.
                val names = dataSet.registry.stations.associate { it.name to it.code }
                val tree = requireNotNull(RouteSearch(graph, TimeSlot.DEFAULT).from(names.getValue("을지로입구")))
                val destination = names.getValue("숙대입구")
                assertEquals(2, tree.fastest(destination)?.transfers)
                val route = requireNotNull(tree.display(destination))
                assertEquals(listOf("2호선", "4호선"), route.legs.map { it.line })
                assertEquals(names.getValue("동대문역사문화공원"), route.legs[0].toCode)
            }
        }

        describe("display line names") {
            it("coverEveryServiceGroupOfTheMetroLines") {
                val lines = MetroLines(parseObject(repo.resolve("data/config/metro-lines.json").readText()))
                (lines.groups.values + (1..8).map { it.toString() }).toSet().forEach { displayLine(it) }
                assertEquals("2호선", displayLine("2"))
                assertEquals("수인분당선", displayLine("수인분당"))
            }
        }
    })
