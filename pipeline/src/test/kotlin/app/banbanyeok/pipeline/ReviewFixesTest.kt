package app.banbanyeok.pipeline

import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationStatus
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Test services as metro-lines.json would declare them; TAGO names equal the ids. */
private fun lines(vararg services: Triple<String, List<String>, Boolean>): MetroLines =
    MetroLines(
        parseObject(
            obj(
                "services" to
                    obj(
                        *services
                            .map { (id, stations, trunk) ->
                                id to
                                    obj(
                                        "group" to "g",
                                        "label" to id,
                                        "kric" to emptyList<String>(),
                                        "stations" to stations.map { "$it $it" },
                                        "trunk" to trunk,
                                    )
                            }.toTypedArray(),
                    ),
                "nameAliases" to obj(),
                "explicitStations" to obj(),
                "lineNames" to obj(),
                "newStations" to obj(),
                "transfers" to
                    obj("s4LineGroups" to obj(), "defaultWalkSeconds" to 89, "groupWalkSeconds" to obj()),
            ).toString(),
        ),
    )

private fun input(
    lines: MetroLines,
    timetable: TagoTimetable,
): TagoInput = TagoInput(lines, emptyMap(), timetable)

private fun estimate(seconds: Int) = RunEstimate(seconds, seconds, 0, 100, 1.0)

private fun station(
    code: String,
    name: String,
    seoulMetro: Boolean,
): Station =
    Station(
        code,
        name,
        StationStatus.ACTIVE,
        37.5,
        127.0,
        listOf("x"),
        emptyList(),
        if (seoulMetro) mapOf("kric:서울교통공사:2호선" to code) else mapOf("kric:한국철도공사:경의중앙선" to code),
        1,
    )

class ReviewFixesTest :
    DescribeSpec({
        describe("1. 별내선: constant wrong termini and asymmetric edges") {
            // A(0) → B(1) → C(2). Every U row (really northbound, towards A) claims terminus B, as TAGO does with 구리.
            val trains = (0 until 60).map { 6 * 3600 + it * 600 }
            val timetable: TagoTimetable =
                mapOf(
                    "A" to
                        mapOf(
                            "U" to trains.map { TagoTrain(null, it + 400, "B") },
                            "D" to trains.map { TagoTrain(it, null, null) },
                        ),
                    "B" to
                        mapOf(
                            "U" to trains.map { TagoTrain(it + 230, it + 200, "B") },
                            "D" to trains.map { TagoTrain(it + 150, it + 120, null) },
                        ),
                    "C" to
                        mapOf(
                            "U" to trains.map { TagoTrain(it, null, "B") },
                            "D" to trains.map { TagoTrain(null, it + 270, null) },
                        ),
                )
            val metro = lines(Triple("s", listOf("A", "B", "C"), false))
            val heading =
                TagoHeading(input(metro, timetable), metro.services.single(), mapOf("A" to "a", "B" to "b", "C" to "c"))

            it("flags a terminus claimed from both sides and learns U/D direction from the end stations") {
                assertTrue(("U" to "B") in heading.bogusTermini)
                assertEquals(-1, heading.codeDirections["U"])
                assertEquals(1, heading.codeDirections["D"])
                // Northbound B → A keeps only the U rows, southbound only the D rows.
                assertTrue(heading.rows("B", 1, 0).all { it.end == "B" })
                assertTrue(heading.rows("B", 1, 2).all { it.end == null })
            }
            it("estimates both directions from the right rows") {
                val run = tagoRunTimes(heading, "A", "B")
                assertEquals(150, run.forward?.seconds)
                // A is the terminus (no train continues): its dwell is the service's ordinary 30 s.
                assertEquals(200, run.reverse?.seconds)
            }
            it("treats a reverse run over twice (and 120 s longer than) the forward one as a headway alias") {
                assertTrue(asymmetric(estimate(220), estimate(1220)))
                assertFalse(asymmetric(estimate(60), estimate(120)))
                assertFalse(asymmetric(estimate(220), estimate(400)))
            }
        }
        describe("2. dwell where most trains terminate") {
            it("uses the service's ordinary dwell when few trains continue") {
                val terminating = (0 until 159).map { TagoTrain(null, it * 300, null) }
                val through = (0 until 9).map { TagoTrain(it * 300 + 170, it * 300, null) }
                assertEquals(30, dwellAt(terminating + through, ordinary = 30))
                val busy = (0 until 100).map { TagoTrain(it * 300 + 45, it * 300, null) }
                assertEquals(45, dwellAt(busy, ordinary = 30))
            }
        }
        describe("3. transfer overrides") {
            val config = parseObject(Path.of("../data/config/metro-lines.json").readText())
            val transfers = config.getValue("transfers").jsonObject
            val default = transfers.getValue("defaultWalkSeconds").jsonPrimitive.int
            val overrides = transfers.getValue("overrides").jsonArray.map { it.jsonObject }

            it("never give 0 s to a same-direction-only platform: the graph cannot tell directions") {
                overrides.filter { "sameDirectionWalkSeconds" in it }.forEach {
                    assertTrue(it.getValue("walkSeconds").jsonPrimitive.int >= default, it.toString())
                }
                assertTrue(
                    overrides.any {
                        it.getValue("stations").toString().contains("금정") &&
                            "sameDirectionWalkSeconds" in it
                    },
                )
            }
            it("keep sourced long transfers above the default and carry a source") {
                val noryangjin = overrides.single { it.getValue("stations").toString().contains("노량진") }
                assertEquals(180, noryangjin.getValue("walkSeconds").jsonPrimitive.int)
                overrides.forEach { assertTrue(it.text("source").startsWith("https://"), it.toString()) }
            }
        }
        describe("4. shared trunk headway") {
            it("counts every train of a trunk section, a branch only its exclusive stations") {
                fun every(seconds: Int) = (0 until 40).map { TagoTrain(36_000 + it * seconds, null, null) }
                val timetable: TagoTimetable =
                    mapOf(
                        "T" to mapOf("U" to every(300)),
                        "X" to mapOf("U" to every(600)),
                        "Y" to mapOf("U" to every(600)),
                    )
                val metro =
                    lines(
                        Triple("bx", listOf("T", "X"), false),
                        Triple("by", listOf("T", "Y"), false),
                        Triple("trunk", listOf("T"), true),
                    )
                val headways = tagoServiceHeadways(input(metro, timetable))
                assertEquals(600, headways["bx"])
                assertEquals(300, headways["trunk"])
            }
        }
        describe("6. names resolve to codes") {
            it("prefers the Seoul Metro station of a duplicated name and rejects other ambiguity") {
                val stations = listOf(station("1qs", "신촌", true), station("pxn", "신촌", false))
                assertEquals("1qs", stationNamed(stations, "신촌").code)
                assertFailsWith<IllegalArgumentException> {
                    stationNamed(listOf(station("a", "x", false), station("b", "x", false)), "x")
                }
            }
        }
    })
