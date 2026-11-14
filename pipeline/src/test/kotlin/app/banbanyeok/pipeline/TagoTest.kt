package app.banbanyeok.pipeline

import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Files
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun recorded(name: String): List<TagoTrain> =
    tagoPage(requireNotNull(TagoTest::class.java.getResource("/tago/$name.json")).readText()).items.map(::tagoTrain)

private fun envelope(items: String) =
    """{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL SERVICE."},
    "body":{"items":$items,"numOfRows":1000,"pageNo":1,"totalCount":TOTAL}}}"""

/** Synthetic line timetable: departures at [from] with a variable headway, arrival [run] s later at [to]. */
private fun synthetic(
    run: Int,
    dwell: Int = 30,
): Pair<List<TagoTrain>, List<TagoTrain>> {
    val departures =
        generateSequence(5 * 3600) {
            it +
                if (it in
                    7 * 3600..9 * 3600
                ) {
                    240
                } else {
                    420
                }
        }.takeWhile { it < 24 * 3600 }.toList()
    return departures.map { TagoTrain(it, it - dwell) } to departures.map { TagoTrain(it + run + dwell, it + run) }
}

class TagoTest :
    DescribeSpec({
        describe("TAGO envelope") {
            it("accepts array, single object and empty items") {
                val one = """{"subwayStationId":"A","depTime":"000800","arrTime":"0"}"""
                assertEquals(2, tagoPage(envelope("{\"item\":[$one,$one]}").replace("TOTAL", "2")).items.size)
                assertEquals(1, tagoPage(envelope("{\"item\":$one}").replace("TOTAL", "1")).items.size)
                assertEquals(0, tagoPage(envelope("\"\"").replace("TOTAL", "0")).items.size)
            }
            it("rejects error codes, gateway XML and reports quota as resumable") {
                assertFailsWith<IllegalArgumentException> {
                    tagoPage("""{"response":{"header":{"resultCode":"30"},"body":{}}}""")
                }
                val gateway =
                    "<OpenAPI_ServiceResponse><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR" +
                        "</returnAuthMsg></OpenAPI_ServiceResponse>"
                assertFailsWith<TagoQuotaExceeded> { tagoPage(gateway) }
                val xml = assertFailsWith<IllegalStateException> { tagoPage("<html>secret-in-body</html>") }
                assertTrue("secret-in-body" !in xml.message.orEmpty())
            }
            it("parses HHMMSS with service-day hours and ignores blanks") {
                assertEquals(24 * 3600 + 480, tagoSeconds("000800"))
                assertEquals(5 * 3600 + 30 * 60, tagoSeconds("053000"))
                assertNull(tagoSeconds("0"))
                assertNull(tagoSeconds("      "))
                assertNull(tagoSeconds("256100"))
            }
            it("accepts encoded and decoded data.go.kr keys without double encoding") {
                assertEquals("a%2Bb", tagoKeyParameter("a%2Bb"))
                assertEquals("a%2Bb%3D", tagoKeyParameter("a+b="))
            }
        }
        describe("resumable cache") {
            it("caches only valid pages under lowercase names and never re-requests them") {
                val dir = Files.createTempDirectory("tago")
                var calls = 0
                val body = envelope("{\"item\":{\"depTime\":\"100000\",\"arrTime\":\"095930\"}}").replace("TOTAL", "1")
                val http =
                    PipelineHttp { url, _ ->
                        calls++
                        assertTrue(url.startsWith("https://apis.data.go.kr/1613000/SubwayInfo/"))
                        Download(body.toByteArray(), "application/json")
                    }
                val api = TagoApi("k", http, dir)
                repeat(2) { assertEquals(1, api.schedule("MTRKRK4K322", "01", "U").size) }
                assertEquals(1, calls)
                assertEquals(
                    listOf("mtrkrk4k322-01-u-p1.json"),
                    dir.resolve("schedule").listDirectoryEntries().map { it.name },
                )
                val offline = TagoApi(null, http, dir)
                assertEquals(1, offline.schedule("MTRKRK4K322", "01", "U").size)
                assertFailsWith<IllegalArgumentException> { offline.schedule("MTRKRK4K322", "01", "D") }
            }
            it("does not cache failed pages and stops at the call budget") {
                val dir = Files.createTempDirectory("tago")
                val failing =
                    PipelineHttp {
                        _,
                        _,
                        ->
                        Download("""{"response":{"header":{"resultCode":"99"}}}""".toByteArray(), "")
                    }
                assertFailsWith<IllegalArgumentException> { TagoApi("k", failing, dir).schedule("MTRA1", "01", "U") }
                assertTrue(dir.resolve("schedule").listDirectoryEntries().isEmpty())
                assertFailsWith<TagoQuotaExceeded> {
                    TagoApi(
                        "k",
                        failing,
                        dir,
                        budget = 0,
                    ).schedule("MTRA1", "01", "U")
                }
            }
            it("keeps the key out of exceptions raised by the HTTP layer (invalid URI, no network)") {
                val key = "secret key%zz"
                val failure =
                    assertFailsWith<IllegalStateException> {
                        TagoApi(key, JdkPipelineHttp(), Files.createTempDirectory("tago")).schedule("MTRA1", "01", "U")
                    }
                assertTrue("secret" !in failure.toString())
                assertNull(failure.cause)
            }
        }
        describe("run time estimate") {
            it("recovers run plus dwell from whole-day timetables without train ids") {
                val (from, to) = synthetic(run = 150)
                val estimate = assertNotNull(estimateRun(from, to))
                assertEquals(180, estimate.seconds)
                assertEquals(from.size, estimate.matched)
            }
            it("prefers the adjacent run over a weaker headway alias and keeps the peak inside the window") {
                val (from, to) = synthetic(run = 69, dwell = 0)
                // A second, sparser train set 6 min later: the 69 s peak must win, not the 429 s alias.
                val alias = from.filterIndexed { i, _ -> i % 3 == 0 }.map { TagoTrain(null, it.departure!! + 429) }
                assertEquals(69, assertNotNull(estimateRun(from, to + alias)).seconds)
            }
            it("matches departures when an operator omits intermediate arrival times") {
                val (from, to) = synthetic(run = 120)
                val departuresOnly = to.map { TagoTrain(it.departure, null) }
                assertEquals(150, assertNotNull(estimateRun(from, departuresOnly)).seconds)
            }
            it("matches the recorded GTX-A 대곡→서울역 weekday timetable") {
                val daegok = mapOf("U" to recorded("mtrgxax103-01-u"), "D" to recorded("mtrgxax103-01-d"))
                val seoul = mapOf("U" to recorded("mtrgxax106-01-u"), "D" to recorded("mtrgxax106-01-d"))
                val forward = assertNotNull(estimateByCodes(daegok, seoul))
                assertEquals(141, forward.matched)
                assertEquals(1.0, forward.ratio)
                // 서울역 is the terminus: no departures, so no dwell is added.
                assertEquals(780, forward.seconds)
                val reverse = assertNotNull(estimateByCodes(seoul, daegok))
                assertEquals(141, reverse.matched)
                assertTrue(reverse.seconds in 600..800)
            }
            it("computes off-peak headways per direction") {
                val (from, _) = synthetic(run = 100)
                assertEquals(420, serviceHeadway(listOf(mapOf("U" to from, "D" to from))))
                assertEquals(null, serviceHeadway(listOf(mapOf("U" to from.take(1)))))
            }
        }
    })

private fun korail(
    name: String,
    line: String,
    lineId: String,
    lat: Double,
    transfers: Set<String> = emptySet(),
): Record = Record("K:$lineId:$name", name, line, lat, 127.0, "한국철도공사", name, lineId, transfers)

private fun seoul(
    name: String,
    lat: Double,
): Record = Record("S:$name", name, "1호선", lat, 127.0, "서울교통공사", name, "S1", emptySet())

class TagoGraphTest :
    DescribeSpec({
        describe("TAGO services in the state graph") {
            val lines =
                MetroLines(
                    parseObject(
                        """{"services":{
                          "1x":{"group":"1","label":"1 through","kric":["한국철도공사:경부선","서울교통공사:1호선"],
                                "joins":{"TB":"1"},"stations":["TB B","TC C"]},
                          "y":{"group":"y","label":"other line","kric":["한국철도공사:경춘선"],"stations":["TD C","TE E"]}},
                        "nameAliases":{},"explicitStations":{},"lineNames":{},
                        "newStations":{"TN":{"name":"N","lines":["N선"],"lat":37.2,"lng":127.0,"source":"wikidata:Q1"}},
                        "transfers":{"s4LineGroups":{},"defaultWalkSeconds":89,"groupWalkSeconds":{}}}""",
                    ),
                )
            val (bDepart, cArrive) = synthetic(run = 150)
            val (dDepart, eArrive) = synthetic(run = 270)
            val tago =
                TagoInput(
                    lines,
                    mapOf(
                        "TB" to ("B" to "1호선"),
                        "TC" to ("C" to "1호선"),
                        "TD" to ("C" to "경춘"),
                        "TE" to ("E" to "경춘"),
                        "TN" to ("N" to "N선"),
                    ),
                    // Every row runs towards the second station (terminus TC/TE), so the reverse run has no data and
                    // is mirrored from the forward estimate.
                    mapOf(
                        "TB" to mapOf("U" to bDepart.map { it.copy(end = "TC") }),
                        "TC" to mapOf("U" to cArrive.map { it.copy(end = "TC") }),
                        "TD" to mapOf("U" to dDepart.map { it.copy(end = "TE") }),
                        "TE" to mapOf("U" to eArrive.map { it.copy(end = "TE") }),
                    ),
                )
            val records =
                listOf(
                    seoul("A", 37.00),
                    seoul("B", 37.02),
                    korail("C", "경부선", "I1", 37.05, setOf("I2")),
                    korail("C", "경춘선", "I2", 37.0501, setOf("I1")),
                    korail("E", "경춘선", "I2", 37.10),
                )
            val rules =
                NetworkRules(
                    parseObject(
                        """{"aliases":{},"predecessors":{},"oneWay":{},"services":{},"sourceLineOverrides":{}}""",
                    ),
                )
            val next = (1..10).iterator()
            val input =
                PipelineInput(
                    app.banbanyeok.schema.Registry(1, 1, emptyList()),
                    records,
                    listOf(listOf("0", "1", "A", "00:00"), listOf("1", "1", "B", "02:00")),
                    emptyList(),
                    rules,
                    mapOf("1" to 120),
                    tago,
                )
            val net = network(input, CodeSource { next.next() })
            val costs = matrixCosts(net)
            val index = net.origins.associate { it.name to net.origins.indexOf(it) }

            it("merges the two-operator station and adds TAGO ids and the S1-missing station") {
                assertEquals(
                    listOf("A", "B", "C", "E", "N"),
                    net.registry.stations
                        .map { it.name }
                        .sorted(),
                )
                val c = net.registry.stations.single { it.name == "C" }
                assertEquals("TC", c.sources["tago:1호선"])
                assertEquals("TD", c.sources["tago:경춘"])
                assertEquals(
                    "Q1",
                    net.registry.stations
                        .single { it.name == "N" }
                        .sources["wikidata"],
                )
            }
            it("rides through the S3 junction without a transfer and pays the TAGO boarding wait") {
                // A boards line 1 (wait 60) and rides 120 s to B, then 150 s run + 30 s dwell to C.
                assertEquals(Cost(60 + 120 + 180, 0), costs[index.getValue("A")][index.getValue("C")])
                // C boards service 1x: TAGO headway 420 s at its own stations → wait 210.
                assertEquals(210 + 180, costs[index.getValue("C")][index.getValue("B")].seconds)
            }
            it("applies the rule-based walk where S4 has no record and passes the gate") {
                // At C: walk 89 + wait of y (210), then 270 + 30 to E.
                assertEquals(Cost(60 + 120 + 180 + 89 + 210 + 300, 1), costs[index.getValue("A")][index.getValue("E")])
                assertEquals(
                    listOf("default"),
                    net.tagoReport!!
                        .getValue("transfers")
                        .jsonArray
                        .map { it.jsonObject.text("status") },
                )
                assertTrue(graphGate(net, costs).passed)
            }
        }
    })
