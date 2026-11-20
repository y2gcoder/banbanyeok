package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.TimeBand
import app.banbanyeok.schema.TimeSlot
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe

/**
 * 출발역 03v·130, 후보 03v·130·225·31a·4xz. 03v와 130은 같은 위도에서 경도가 0.2도 떨어져 있어 평균점은 경도 127.10이다.
 * 225는 정확히 그 점에 있으므로 지도 한가운데는 225이고, 공평 1위는 최장 10분인 130이다.
 */
private val coordinates =
    mapOf(
        "03v" to GeoPoint(37.50, 127.00),
        "130" to GeoPoint(37.50, 127.20),
        "225" to GeoPoint(37.50, 127.10),
        "31a" to GeoPoint(37.56, 127.10),
        "4xz" to GeoPoint(37.40, 127.30),
    )

private val locations = StationLocations { coordinates[it] }

/** [middleFrom03v]는 03v에서 225까지의 초(지도 한가운데 역의 최장 시간을 정한다). 130에서 225까지는 600초, 130까지는 03v 600초다. */
private fun od(middleFrom03v: Int = 1200): OdMatrix =
    smallOd(
        origins = listOf("03v", "130"),
        candidates = listOf("03v", "130", "225", "31a", "4xz"),
        times =
            listOf(
                listOf(0, 600, middleFrom03v, 1800, 2400),
                listOf(900, 0, 600, 1500, 1200),
            ),
    )

private fun service(
    od: OdMatrix = od(),
    slots: Map<TimeSlot, OdMatrix> = emptyMap(),
    stationLocations: StationLocations = locations,
) = RecommendationService(OdTravelTimeProvider(od, "20261120.1", slots), codeNames, locations = stationLocations)

private fun people(vararg codes: String) = codes.mapIndexed { i, c -> RecommendParticipant("p$i", null, c) }

private fun RecommendationService.middleOf(request: RecommendRequest): MapMiddle? =
    mapMiddle(request, recommend(request))

class MapMiddleTest :
    DescribeSpec({
        describe("map middle station") {
            it(
                "is the common station nearest to the average of the origins, with each person's time from the same od",
            ) {
                val request = RecommendRequest(people("03v", "130"), RecommendMode.FAIR)
                val service = service()
                val result = service.recommend(request)
                result.candidates.first().stationCode shouldBe "130" // 공평 1위(최장 10분)는 그대로다
                val middle = service.mapMiddle(request, result).shouldNotBeNull()
                middle.stationCode shouldBe "225"
                middle.stationName shouldBe "225역"
                middle.times.map { it.participantId to it.seconds } shouldContainExactly
                    listOf("p0" to 1200, "p1" to 600)
            }

            it("does not change the fair ranking") {
                val request = RecommendRequest(people("03v", "130"), RecommendMode.FAIR)
                val plain =
                    RecommendationService(
                        OdTravelTimeProvider(od(), "20261120.1"),
                        codeNames,
                    ).recommend(request)
                val withLocations = service().recommend(request)
                withLocations.candidates.map { it.stationCode to it.times } shouldBe
                    plain.candidates.map { it.stationCode to it.times }
            }

            it("is hidden when it is the recommended station itself") {
                // 두 사람이 같은 130에서 출발하면 평균점이 130이고 1위도 130이다.
                service().middleOf(RecommendRequest(people("130", "130"), RecommendMode.FAIR)).shouldBeNull()
            }

            it("picks the next nearest station when the nearest cannot be reached by everyone") {
                val unreachable =
                    smallOd(
                        origins = listOf("03v", "130"),
                        candidates = listOf("03v", "130", "225", "31a", "4xz"),
                        times =
                            listOf(
                                listOf(0, 600, null, 1800, 2400),
                                listOf(900, 0, 600, 1500, 1200),
                            ),
                    )
                val request = RecommendRequest(people("03v", "130"), RecommendMode.FAIR)
                // 225(가장 가까움)는 03v에서 갈 수 없다. 다음으로 가까운 31a(최장 25분)가 고른다.
                service(unreachable).middleOf(request).shouldNotBeNull().stationCode shouldBe "31a"
            }

            it("is hidden when the only station everyone can reach is the recommended one") {
                val onlyTop =
                    smallOd(
                        origins = listOf("03v", "130"),
                        candidates = listOf("130", "225"),
                        times = listOf(listOf(600, null), listOf(0, 600)),
                    )
                service(onlyTop).middleOf(RecommendRequest(people("03v", "130"), RecommendMode.FAIR)).shouldBeNull()
            }

            it("is hidden when there is no common candidate") {
                val none =
                    smallOd(
                        origins = listOf("03v", "130"),
                        candidates = listOf("225", "31a"),
                        times = listOf(listOf(600, null), listOf(null, 600)),
                    )
                service(none).middleOf(RecommendRequest(people("03v", "130"), RecommendMode.FAIR)).shouldBeNull()
            }
        }

        describe("the 5 minute rule (compared by the minutes people see, longest vs longest)") {
            val request = RecommendRequest(people("03v", "130"), RecommendMode.FAIR)

            it("shows the comparison when the longest time is exactly 5 minutes longer") {
                // 1위 130의 최장 600초 = 10분. 225의 최장 870초 = 14.5분 → 15분, 차이 5분.
                service(od(870)).middleOf(request).shouldNotBeNull().stationCode shouldBe "225"
            }

            it("hides it when the longest time is only 4 minutes longer") {
                // 869초 = 14분 29초 → 14분, 차이 4분.
                service(od(869)).middleOf(request).shouldBeNull()
            }

            it("hides it when the middle station is as good as the recommendation") {
                service(od(600)).middleOf(request).shouldBeNull()
            }
        }

        describe("when it is not shown") {
            it("is hidden for fast and favor modes, which answer a different question") {
                val service = service()
                for (mode in listOf(RecommendMode.FAST, RecommendMode.FAVOR)) {
                    val request = RecommendRequest(people("03v", "130"), mode, favorId = "p0")
                    service.middleOf(request).shouldBeNull()
                }
            }

            it("is hidden when anyone hides their origin, since the origin could be worked back from it") {
                val hidden =
                    listOf(
                        RecommendParticipant("p0", null, "03v"),
                        RecommendParticipant("p1", null, "130", hidden = true),
                    )
                service().middleOf(RecommendRequest(hidden, RecommendMode.FAIR)).shouldBeNull()
                // 같은 사람들이 숨기지 않으면 보인다(숨김 때문에만 가려진 것).
                service().middleOf(RecommendRequest(people("03v", "130"), RecommendMode.FAIR)).shouldNotBeNull()
            }

            it("is hidden when an origin has no coordinates") {
                val partial = StationLocations { if (it == "130") null else coordinates[it] }
                service(stationLocations = partial)
                    .middleOf(RecommendRequest(people("03v", "130"), RecommendMode.FAIR))
                    .shouldBeNull()
            }

            it("is hidden when the service has no station locations") {
                RecommendationService(OdTravelTimeProvider(od(), "20261120.1"), codeNames)
                    .middleOf(RecommendRequest(people("03v", "130"), RecommendMode.FAIR))
                    .shouldBeNull()
            }
        }

        describe("time slots") {
            val saturdayEvening = TimeSlot(DayType.SATURDAY, TimeBand.EVENING)

            fun requestAt(slot: TimeSlot) =
                RecommendRequest(
                    people("03v", "130"),
                    RecommendMode.FAIR,
                    time = TimeBasis(slot, TimeSlotLabels.of(slot)),
                )

            it("takes each person's time from the od of the requested slot") {
                val service = service(slots = mapOf(saturdayEvening to od(1500)))
                service
                    .middleOf(
                        requestAt(TimeSlot.DEFAULT),
                    ).shouldNotBeNull()
                    .times
                    .map { it.seconds } shouldContainExactly
                    listOf(1200, 600)
                service
                    .middleOf(
                        requestAt(saturdayEvening),
                    ).shouldNotBeNull()
                    .times
                    .map { it.seconds } shouldContainExactly
                    listOf(1500, 600)
            }

            it("judges the 5 minute rule in the slot used, not the default one") {
                // 평일 낮은 차이 10분이라 보이지만, 토요일 저녁은 차이가 4분이라 숨긴다.
                val service = service(slots = mapOf(saturdayEvening to od(840)))
                service.middleOf(requestAt(TimeSlot.DEFAULT)).shouldNotBeNull()
                service.middleOf(requestAt(saturdayEvening)).shouldBeNull()
            }

            it("falls back to the default slot like the ranking does when the slot has no matrix") {
                service()
                    .middleOf(
                        requestAt(saturdayEvening),
                    ).shouldNotBeNull()
                    .times
                    .map { it.seconds } shouldContainExactly
                    listOf(1200, 600)
            }
        }

        describe("nearest") {
            fun nearestOf(
                origins: List<GeoPoint>,
                candidates: List<String>,
                reachable: (Int) -> Boolean = { true },
            ) = MapMiddleRule.nearest(origins, candidates, locations, reachable)

            it("breaks a tie in distance by the smaller station code, whatever the order of the candidates") {
                val tie =
                    StationLocations {
                        when (it) {
                            "225" -> GeoPoint(37.50, 127.09)
                            "31a" -> GeoPoint(37.50, 127.11)
                            else -> null
                        }
                    }
                val origins = listOf(GeoPoint(37.50, 127.00), GeoPoint(37.50, 127.20))
                MapMiddleRule.nearest(origins, listOf("225", "31a"), tie) { true } shouldBe 0
                MapMiddleRule.nearest(origins, listOf("31a", "225"), tie) { true } shouldBe 1
            }

            it("counts two people from the same origin twice") {
                // 03v 두 명과 130 한 명: 평균 경도는 127.0667이라 03v(127.00)보다 225(127.10)가 가깝다.
                // 사람마다 한 번만 센다면(두 곳의 중점 127.10) 03v와 225는 같은 거리가 되지 않으므로 두 번 센 결과만 225를 고른다.
                val origins = listOf(GeoPoint(37.50, 127.00), GeoPoint(37.50, 127.00), GeoPoint(37.50, 127.20))
                nearestOf(origins, listOf("03v", "225", "130")) shouldBe 1
                // 03v 두 명과 127.04에 한 명이면 평균은 127.0133이라 03v가 가깝다.
                val near = listOf(GeoPoint(37.50, 127.00), GeoPoint(37.50, 127.00), GeoPoint(37.50, 127.04))
                nearestOf(near, listOf("03v", "225")) shouldBe 0
            }

            it("squeezes longitude by the cosine of the mean latitude") {
                // 평균점(37.5, 127.0)에서 위도로 0.05도(약 5.6km) 떨어진 역과 경도로 0.06도(약 5.3km) 떨어진 역.
                // 경도를 보정하지 않으면 0.05 < 0.06이라 위도 쪽이 가깝지만, 보정하면 경도 쪽(0.06 × 0.79 = 0.048)이 가깝다.
                val points =
                    StationLocations {
                        when (it) {
                            "225" -> GeoPoint(37.55, 127.00)
                            "31a" -> GeoPoint(37.50, 127.06)
                            else -> null
                        }
                    }
                MapMiddleRule.nearest(listOf(GeoPoint(37.5, 127.0)), listOf("225", "31a"), points) { true } shouldBe 1
            }

            it("skips candidates without coordinates and returns null when there is nothing to pick") {
                nearestOf(listOf(GeoPoint(37.5, 127.1)), listOf("zzz")).shouldBeNull()
                nearestOf(emptyList(), listOf("225")).shouldBeNull()
                nearestOf(listOf(GeoPoint(37.5, 127.1)), listOf("225"), reachable = { false }).shouldBeNull()
            }
        }
    })
