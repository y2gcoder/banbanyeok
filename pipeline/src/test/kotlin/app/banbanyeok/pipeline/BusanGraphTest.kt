package app.banbanyeok.pipeline

import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationStatus
import app.banbanyeok.schema.TimeSlot
import io.kotest.core.spec.style.DescribeSpec
import kotlin.test.assertEquals
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
        }
    })

private fun graphStation(
    code: String,
    name: String,
) = Station(code, name, StationStatus.ACTIVE, 35.0, 129.0, emptyList(), emptyList(), emptyMap(), 1)
