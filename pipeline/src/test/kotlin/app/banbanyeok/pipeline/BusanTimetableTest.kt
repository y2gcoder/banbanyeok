package app.banbanyeok.pipeline

import io.kotest.core.spec.style.DescribeSpec
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class BusanTimetableTest :
    DescribeSpec({
        describe("Busan graph schedules") {
            it("pairs consecutive stops by train number and keeps directional travel times") {
                val line =
                    parseBusanLine(
                        parseObject(
                            """{"stations":[{"code":"001","name":"A"},{"code":"002","name":"B"},{"code":"003","name":"C"}],
                            "trains":[
                            {"number":"101","day":"weekday","stops":[[0,null,85800],[1,85920,85950],[2,86100,null]]},
                            {"number":"202","day":"weekday","stops":[[2,null,86200],[1,86320,86350],[0,86500,null]]},
                            {"number":"101","day":"saturday","stops":[[0,null,85800],[1,86000,null]]}]}""",
                        ),
                    )
                assertEquals(
                    listOf(BusanRide(0, 1, 150), BusanRide(1, 0, 150), BusanRide(1, 2, 150), BusanRide(2, 1, 150)),
                    numberedRides(line),
                )
                assertEquals(
                    listOf(TagoTrain(86_350, 86_320)),
                    numberedDepartures(line, "weekday")[1].getValue("reverse"),
                )
                assertEquals(emptyList(), numberedDepartures(line, "holiday"))
            }

            it("splits both TAGO responses by terminus and retains arrival rows") {
                val ids = listOf("MTRBGB10101", "MTRBGB10102", "MTRBGB10103")
                val (first, middle, last) = ids
                val a = TagoTrain(120, 90, first)
                val b = TagoTrain(180, 150, last)
                val c = TagoTrain(240, 210, first)
                val d = TagoTrain(300, 270, last)
                val arrival = TagoTrain(null, 500, last)
                val rows =
                    busanLightRailDirections(
                        ids,
                        mapOf(
                            first to mapOf("U" to emptyList(), "D" to emptyList()),
                            middle to mapOf("U" to listOf(a, b), "D" to listOf(c, d)),
                            last to mapOf("U" to listOf(arrival), "D" to listOf(arrival)),
                        ),
                    )
                assertEquals(listOf(a, c), rows[1].getValue("reverse"))
                assertEquals(listOf(b, d), rows[1].getValue("forward"))
                assertEquals(listOf(arrival), rows[2].getValue("forward"))
                assertTrue(rows[2].getValue("reverse").isEmpty())
                assertFailsWith<IllegalArgumentException> {
                    busanLightRailDirections(ids, ids.associateWith { mapOf("U" to listOf(a.copy(end = middle))) })
                }
            }
        }
    })
