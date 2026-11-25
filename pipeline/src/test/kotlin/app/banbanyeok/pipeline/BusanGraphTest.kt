package app.banbanyeok.pipeline

import app.banbanyeok.core.RouteCost
import app.banbanyeok.core.RouteSearch
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.RouteGraphCodec
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationStatus
import app.banbanyeok.schema.TimeSlot
import io.kotest.core.spec.style.DescribeSpec
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BusanGraphTest :
    DescribeSpec({
        describe("Busan regional OD") {
            it("charges boarding and a long transfer while leaving the other region unreachable") {
                val names = mapOf("001" to "교대", "002" to "가", "003" to "교대", "004" to "나", "006" to "다")
                val registry = Registry(1, 1, names.map { (code, name) -> graphStation(code, name) })
                val slot = TimeSlot.DEFAULT
                val rides = listOf(BusanRide(0, 1, 60), BusanRide(1, 0, 60))
                val transfers =
                    BusanTransfers(
                        parseObject("""{"defaultSeconds":89,"longSeconds":221,"longStations":{"004":"fixture"}}"""),
                    )

                fun service(
                    id: String,
                    origin: String,
                    destination: String,
                    headway: Int,
                ) = BusanService(
                    id,
                    id,
                    listOf(origin, destination).map { BusanStop(it, names.getValue(it)) },
                    rides,
                    mapOf(slot to headway),
                )
                val capital =
                    busanNetwork(
                        registry,
                        listOf(service("capital1", "001", "003", 120)),
                        BusanTransfers(parseObject("""{"defaultSeconds":89,"longSeconds":221,"longStations":{}}""")),
                        slot,
                    )
                val busan =
                    busanNetwork(
                        registry,
                        listOf(service("busan1", "002", "004", 120), service("busan2", "004", "006", 180)),
                        transfers,
                        slot,
                    )
                val costs = matrixCosts(busan)
                assertEquals(
                    listOf(
                        listOf(Cost(0, 0), Cost(120, 0), Cost(491, 1)),
                        listOf(Cost(120, 0), Cost(0, 0), Cost(150, 0)),
                        listOf(Cost(491, 1), Cost(150, 0), Cost(0, 0)),
                    ),
                    costs,
                )
                assertTrue(graphGate(busan, costs).passed)
                assertEquals(12, verifyRegionalOd(capital, busan, costs))
                assertEquals(
                    listOf("001", "002", "003", "004", "006"),
                    combineRegions(capital, busan).origins.map { it.code },
                )
            }

            it("round-trips a two-code outdoor link and preserves the known Saturday route") {
                val a = "001"
                val b = "002"
                val c = "003"
                val d = "004"
                val registry = Registry(1, 1, listOf(a, b, c, d).map { graphStation(it, it) })
                val rides = listOf(BusanRide(0, 1, 60), BusanRide(1, 0, 60))
                val waits = TimeSlot.ALL.associateWith { 120 }
                val first = BusanService("1", "1호선", listOf(BusanStop(a, a), BusanStop(b, b)), rides, waits)
                val other =
                    BusanService(
                        "2",
                        "2호선",
                        listOf(BusanStop(c, c), BusanStop(d, d)),
                        rides,
                        waits.filterKeys { it.day != DayType.SATURDAY },
                    )
                val transfers =
                    BusanTransfers(
                        parseObject(
                            """{"defaultSeconds":89,"longSeconds":221,"longStations":{},
                        "outdoorLinks":[{"stations":["002","003"],"seconds":221}]}""",
                        ),
                    )
                val slots = TimeSlot.ALL.associateWith { busanNetwork(registry, listOf(first, other), transfers, it) }
                val encoded = RouteGraphCodec.encode(routeGraph(slots, RouteGraphCodec.REGIONAL_FORMAT_VERSION) { it })
                val regional = RouteGraphCodec.decode(encoded)
                val weekday = requireNotNull(RouteSearch(regional, TimeSlot.DEFAULT).from(a))
                assertEquals(RouteCost(461, 1), weekday.fastest(d))
                val weekdayCosts = matrixCosts(slots.getValue(TimeSlot.DEFAULT))
                assertEquals(Cost(461, 1), weekdayCosts[0][3])
                assertEquals(Cost(221, 0), weekdayCosts[1][2])
                assertEquals(Cost(341, 0), weekdayCosts[2][0])
                val saturdaySlot = TimeSlot.ALL.first { it.day == DayType.SATURDAY }
                val saturday = RouteSearch(regional, saturdaySlot)
                val available = requireNotNull(saturday.from(a))
                assertEquals(RouteCost(120, 0), available.fastest(b))
                assertEquals(RouteCost(341, 0), available.fastest(c))
                assertNull(available.fastest(d))
                assertNull(saturday.from(d))
                val partial = slots.getValue(saturdaySlot)
                assertFailsWith<IllegalArgumentException> { matrixCosts(partial) }
                val saturdayCosts = regionalMatrixCosts(partial)
                assertFailsWith<IllegalArgumentException> { graphGate(partial, saturdayCosts) }
                assertEquals(Cost(341, 0), saturdayCosts[0][2])
                assertEquals(infinity, saturdayCosts[0][3])
                assertEquals(List(4) { infinity }, saturdayCosts[3])
                verifyRegionalSlot(saturday, partial, emptyList())
            }

            it("disables a regional slot with too few origins or disconnected known services") {
                assertEquals("no-connected-rail", regionDisableReason(1, 0))
                assertEquals("disconnected-known-services", regionDisableReason(2, 2))
                assertNull(regionDisableReason(2, 0))
            }
        }
    })

private fun graphStation(
    code: String,
    name: String,
) = Station(code, name, StationStatus.ACTIVE, 35.0, 129.0, emptyList(), emptyList(), emptyMap(), 1)
