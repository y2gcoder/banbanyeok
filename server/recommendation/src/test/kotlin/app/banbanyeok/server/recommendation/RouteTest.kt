package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.TimeBand
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.recommendation.route.ParticipantRoute
import app.banbanyeok.server.recommendation.route.ParticipantRouteLeg
import app.banbanyeok.server.recommendation.route.RouteAttacher
import app.banbanyeok.server.recommendation.route.RouteSource
import app.banbanyeok.server.recommendation.route.RouteStop
import app.banbanyeok.server.recommendation.time.TimeBasis
import app.banbanyeok.server.recommendation.time.TimeSlotLabels
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe

private val graph = sampleRouteGraph()

private fun service(
    source: RouteSource = RouteSource { graph },
    slots: Map<TimeSlot, app.banbanyeok.schema.OdMatrix> = TimeSlot.ALL.associateWith { sampleOd },
) = RecommendationService(OdTravelTimeProvider(sampleOd, "20261120.1", slots), codeNames, routes = source)

private fun person(
    id: String,
    origin: String,
    hidden: Boolean = false,
) = RecommendParticipant(id, null, origin, hidden)

private val origins = mapOf("a" to "03v", "b" to "225", "c" to "31a")

private val night = TimeSlot(DayType.WEEKDAY, TimeBand.NIGHT)

private fun request(
    people: List<RecommendParticipant> = listOf(person("a", "03v"), person("c", "31a")),
    slot: TimeSlot = TimeSlot.DEFAULT,
    viewer: String? = null,
) = RecommendRequest(people, RecommendMode.FAIR, time = TimeBasis(slot, TimeSlotLabels.of(slot)), viewerId = viewer)

private fun stop(code: String) = RouteStop(code, "${code}역")

class RouteTest :
    DescribeSpec({
        describe("person routes (#120)") {
            it("are attached to every candidate for every person who travels, from the origin to the station") {
                val result = service().evaluate(request()).recommendation
                result.candidates.size shouldBe 3
                result.candidates.forEach { card ->
                    val routes = card.routes.shouldNotBeNull()
                    // 만날 역에서 출발하는 사람은 경로가 없다.
                    routes.map { it.participantId } shouldBe listOf("a", "c").filter { origins[it] != card.stationCode }
                    routes.forEach { route ->
                        route.legs
                            .first()
                            .from.stationCode shouldBe origins[route.participantId]
                        route.legs
                            .last()
                            .to.stationCode shouldBe card.stationCode
                    }
                }
            }

            it("show the lines in order and the transfer station, with model times for the bar proportions") {
                // 03v → 4xz: 2호선만(60 + 1200초)보다 225에서 4호선으로 갈아타는 길(60 + 600 + 30 + 90 + 200초)이 2분 넘게 빠르다.
                val attached =
                    RouteAttacher(RouteSource { graph }, codeNames::nameOf)
                        .forRequest(TimeSlot.DEFAULT, listOf(RouteAttacher.Rider("a", "03v", false)), null)
                        .shouldNotBeNull()
                attached.at("4xz") shouldBe
                    listOf(
                        ParticipantRoute(
                            "a",
                            listOf(
                                ParticipantRouteLeg("2호선", stop("03v"), stop("225"), 60, 600),
                                ParticipantRouteLeg("4호선", stop("225"), stop("4xz"), 120, 200),
                            ),
                        ),
                    )
                attached.at("03v") shouldBe emptyList()
            }

            it("never change the ranking, the times or the reasons") {
                val without = service(RouteSource { null }).evaluate(request()).recommendation
                val with = service().evaluate(request()).recommendation
                without.candidates.forEach { it.routes.shouldBeNull() }
                with.copy(candidates = with.candidates.map { it.copy(routes = null) }) shouldBe without
            }

            it("use the waits of the slot that was actually computed") {
                fun firstWait(result: Recommendation) =
                    result.candidates
                        .first()
                        .routes
                        .shouldNotBeNull()
                        .first()
                        .legs
                        .first()
                        .waitSeconds
                firstWait(service().evaluate(request(slot = night)).recommendation) shouldBe 600
                // 밤 행렬이 없으면 평일 낮으로 계산하고, 경로도 평일 낮 대기를 쓴다.
                val fallback = service(slots = emptyMap()).evaluate(request(slot = night)).recommendation
                fallback.timeBasis.slot shouldBe TimeSlot.DEFAULT
                firstWait(fallback) shouldBe 60
            }
        }

        describe("a participant who hid the origin") {
            val people = listOf(person("a", "03v"), person("b", "225", hidden = true), person("c", "31a"))

            it("has no route in anyone else's result or in a result without a viewer") {
                listOf(null, "a", "c").forEach { viewer ->
                    service().evaluate(request(people, viewer = viewer)).recommendation.candidates.forEach { card ->
                        card.routes.shouldNotBeNull().none { it.participantId == "b" } shouldBe true
                    }
                }
            }

            it("sees the own route on the own request only") {
                val own = service().evaluate(request(people, viewer = "b")).recommendation
                own.candidates.forEach { card ->
                    card.routes.shouldNotBeNull().map { it.participantId } shouldBe
                        listOf("a", "b", "c").filter { origins[it] != card.stationCode }
                }
            }
        }
    })
