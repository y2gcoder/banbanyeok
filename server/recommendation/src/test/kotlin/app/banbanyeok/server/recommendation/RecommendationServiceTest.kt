package app.banbanyeok.server.recommendation

import app.banbanyeok.applogic.LabelKind
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotBeBlank
import io.kotest.matchers.string.shouldNotContain

private fun service(od: app.banbanyeok.schema.OdMatrix = sampleOd) =
    RecommendationService(OdTravelTimeProvider(od, "20261112.1"), codeNames)

private fun people(vararg codes: String) = codes.mapIndexed { i, c -> RecommendParticipant("p$i", null, c) }

class RecommendationServiceTest :
    DescribeSpec({
        describe("fair mode") {
            it("ranks the minimax station first and reports seconds, transfers and a Korean reason") {
                val result =
                    service()
                        .evaluate(
                            RecommendRequest(people("03v", "130"), RecommendMode.FAIR),
                        ).recommendation
                result.status shouldBe "ok"
                result.dataVersion shouldBe "20261112.1"
                val first = result.candidates.first()
                first.stationCode shouldBe "130"
                first.stationName shouldBe "130역"
                first.times.map { it.participantId to it.seconds } shouldContainExactly listOf("p0" to 600, "p1" to 0)
                first.times.map { it.transfers } shouldContainExactly listOf(1, 0)
                first.maxSeconds shouldBe 600
                first.spreadSeconds shouldBe 600
                first.totalSeconds shouldBe 600
                first.reasonCode shouldBe "FAIR_MINIMAX"
                first.reason.shouldNotBeBlank()
                first.favoredSeconds.shouldBeNull()
                result.baselineStationCode shouldBe "130"
            }

            it("returns at most three ranked cards with an alternative reason code after the first") {
                val result =
                    service()
                        .evaluate(
                            RecommendRequest(people("130", "225"), RecommendMode.FAIR),
                        ).recommendation
                result.candidates.map { it.rank } shouldContainExactly listOf(1, 2, 3)
                result.candidates
                    .drop(1)
                    .map { it.reasonCode }
                    .toSet() shouldBe setOf("FAIR_ALTERNATIVE")
                result.candidates.size shouldBeLessThanOrEqual 3
            }

            it("uses nicknames, or origin labels when there are none, never a first-person word") {
                val named =
                    service()
                        .evaluate(
                            RecommendRequest(
                                listOf(RecommendParticipant("a", "민수", "03v"), RecommendParticipant("b", "지연", "130")),
                                RecommendMode.FAIR,
                            ),
                        ).recommendation
                named.candidates.first().reason shouldContain "민수"
                named.labels.map { it.text } shouldContainExactly listOf("민수", "지연")
                val anonymous =
                    service()
                        .evaluate(
                            RecommendRequest(people("03v", "130"), RecommendMode.FAIR),
                        ).recommendation
                anonymous.labels.map { it.text } shouldContainExactly listOf("03v역에서 오는 분", "130역에서 오는 분")
                anonymous.labels.map { it.kind } shouldContainExactly listOf(LabelKind.ORIGIN, LabelKind.ORIGIN)
                anonymous.candidates.first().reason shouldContain "03v역에서 오는 분"
                anonymous.candidates.map { it.reason }.forEach {
                    it shouldNotContain "나는"
                    it shouldNotContain "나가"
                    it shouldNotContain "친구"
                }
            }

            it("numbers people from the same origin and identical nicknames") {
                val same =
                    service()
                        .evaluate(
                            RecommendRequest(people("03v", "03v", "130"), RecommendMode.FAIR),
                        ).recommendation
                same.labels.map { it.text } shouldContainExactly
                    listOf("03v역에서 오는 분 1", "03v역에서 오는 분 2", "130역에서 오는 분")
                val twins =
                    service()
                        .evaluate(
                            RecommendRequest(
                                listOf(RecommendParticipant("a", "민수", "03v"), RecommendParticipant("b", "민수", "130")),
                                RecommendMode.FAIR,
                            ),
                        ).recommendation
                twins.labels.map { it.text } shouldContainExactly listOf("민수 1", "민수 2")
            }

            it("never puts a hidden participant's origin into labels or sentences") {
                val result =
                    service()
                        .evaluate(
                            RecommendRequest(
                                listOf(
                                    RecommendParticipant("a", null, "03v"),
                                    RecommendParticipant("b", null, "130", hidden = true),
                                ),
                                RecommendMode.FAST,
                            ),
                        ).recommendation
                result.labels.map { it.text } shouldContainExactly listOf("03v역에서 오는 분", "참가자 2")
                result.labels.map { it.kind } shouldContainExactly listOf(LabelKind.ORIGIN, LabelKind.ORDINAL)
                result.candidates.map { it.reason }.forEach { it shouldNotContain "130역에서" }
            }

            describe("hidden participant's times for other viewers (#142)") {
                // 지연(130, 숨김)의 출발역이 공평 2위 후보다. 순위: 225(최장 1100) → 130(1200, 지연 0초) → 03v(1500).
                val od =
                    smallOd(
                        origins = listOf("03v", "130"),
                        candidates = listOf("03v", "130", "225"),
                        times = listOf(listOf(0, 1200, 600), listOf(1500, 0, 1100)),
                        transfers = listOf(listOf(0, 1, 0), listOf(2, 0, 1)),
                    )

                fun request(
                    mode: RecommendMode,
                    viewer: String?,
                    favor: String? = null,
                ) = RecommendRequest(
                    listOf(
                        RecommendParticipant("a", "민수", "03v"),
                        RecommendParticipant("b", "지연", "130", hidden = true),
                    ),
                    mode,
                    favor,
                    viewerId = viewer,
                )

                it(
                    "shows others a 5-minute-rounded time without transfers, recomputes aggregates, and keeps the order",
                ) {
                    val others = service(od).evaluate(request(RecommendMode.FAIR, viewer = null)).recommendation
                    val self = service(od).evaluate(request(RecommendMode.FAIR, viewer = "b")).recommendation
                    others.candidates.map { it.stationCode } shouldContainExactly listOf("225", "130", "03v")
                    self.candidates.map { it.stationCode } shouldContainExactly others.candidates.map { it.stationCode }
                    val own = others.candidates.single { it.stationCode == "130" }
                    own.times[1] shouldBe ParticipantTime("b", 300, null)
                    own.maxSeconds shouldBe 1200
                    own.spreadSeconds shouldBe 900
                    own.totalSeconds shouldBe 1500
                    own.reason shouldNotContain "0~"
                    others.candidates.single { it.stationCode == "225" }.times[1] shouldBe
                        ParticipantTime("b", 1200, null)
                    // 공개한 사람의 칸과 본인 화면은 정확한 값 그대로다.
                    others.candidates.zip(self.candidates).forEach { (o, m) -> o.times[0] shouldBe m.times[0] }
                    self.candidates.single { it.stationCode == "130" }.times[1] shouldBe ParticipantTime("b", 0, 0)
                }

                it("uses the same rounded time for stations outside the ranking") {
                    service(od).evaluate(request(RecommendMode.FAIR, viewer = null)).timesTo("130")!![1] shouldBe
                        ParticipantTime("b", 300, null)
                    service(od).evaluate(request(RecommendMode.FAIR, viewer = "b")).timesTo("130")!![1] shouldBe
                        ParticipantTime("b", 0, 0)
                }

                it(
                    "does not show the hidden person's cap in a favor sentence (it gives away the exact baseline time)",
                ) {
                    val others =
                        service(
                            od,
                        ).evaluate(request(RecommendMode.FAVOR, viewer = null, favor = "a")).recommendation
                    val self =
                        service(
                            od,
                        ).evaluate(request(RecommendMode.FAVOR, viewer = "b", favor = "a")).recommendation
                    others.candidates.first().stationCode shouldBe self.candidates.first().stationCode
                    others.candidates.first().reason shouldNotContain "상한"
                    others.candidates.first().reason shouldContain "(25분)"
                    self.candidates.first().reason shouldContain "상한 +"
                }
            }

            it("treats a blank nickname as none and rejects an invalid one") {
                val blank =
                    service()
                        .evaluate(
                            RecommendRequest(
                                listOf(RecommendParticipant("a", "  ", "03v"), RecommendParticipant("b", "지연", "130")),
                                RecommendMode.FAIR,
                            ),
                        ).recommendation
                blank.labels.first().text shouldBe "03v역에서 오는 분"
                shouldThrow<RecommendationException> {
                    service()
                        .evaluate(
                            RecommendRequest(
                                listOf(
                                    RecommendParticipant("a", "가".repeat(21), "03v"),
                                    RecommendParticipant("b", null, "130"),
                                ),
                                RecommendMode.FAIR,
                            ),
                        ).recommendation
                }.error shouldBe RecommendationError.INVALID_NICKNAME
            }
        }

        describe("fast mode") {
            it("ranks by the sum of travel times") {
                val result =
                    service()
                        .evaluate(
                            RecommendRequest(people("03v", "31a"), RecommendMode.FAST),
                        ).recommendation
                result.candidates.first().let {
                    it.stationCode shouldBe "31a"
                    it.totalSeconds shouldBe 1800
                    it.reasonCode shouldBe "FAST_TOTAL"
                }
            }
        }

        describe("favor mode") {
            it("favors the target within the cap and reports the favored person's time") {
                val request = RecommendRequest(people("03v", "130"), RecommendMode.FAVOR, favorId = "p1")
                val result = service().evaluate(request).recommendation
                val first = result.candidates.first()
                first.reasonCode shouldBe "FAVOR_CAPPED"
                first.favoredSeconds shouldBe first.times[1].seconds
                first.reason.shouldNotBeBlank()
                result.baselineStationCode.shouldNotBeNull()
            }

            it("requires an existing favor target") {
                shouldThrow<RecommendationException> {
                    service().evaluate(RecommendRequest(people("03v", "130"), RecommendMode.FAVOR)).recommendation
                }.error shouldBe RecommendationError.FAVOR_TARGET_REQUIRED
                shouldThrow<RecommendationException> {
                    service()
                        .evaluate(
                            RecommendRequest(people("03v", "130"), RecommendMode.FAVOR, favorId = "x"),
                        ).recommendation
                }.error shouldBe RecommendationError.FAVOR_TARGET_UNKNOWN
            }
        }

        describe("an evaluation") {
            it("keeps the participants it was given even if the caller changes the list afterwards") {
                val people =
                    mutableListOf(RecommendParticipant("a", null, "03v"), RecommendParticipant("b", null, "130"))
                val evaluation = service().evaluate(RecommendRequest(people, RecommendMode.FAIR))
                val before = evaluation.timesTo("4xz")
                before shouldContainExactly listOf(ParticipantTime("a", 2400, 2), ParticipantTime("b", 1200, 1))
                people.reverse()
                evaluation.timesTo("4xz") shouldBe before
                evaluation.lastTrainsAt("4xz").shouldBeNull()
            }
        }

        describe("unreachable stations") {
            it("reports no_common_candidate when nobody can reach a common candidate") {
                val od =
                    smallOd(
                        origins = listOf("03v", "130"),
                        candidates = listOf("225", "31a"),
                        times = listOf(listOf(600, null), listOf(null, 900)),
                    )
                val result =
                    service(
                        od,
                    ).evaluate(RecommendRequest(people("03v", "130"), RecommendMode.FAIR)).recommendation
                result.status shouldBe "no_common_candidate"
                result.candidates.shouldBeEmpty()
                result.baselineStationCode.shouldBeNull()
            }
        }

        describe("times to one station") {
            it(
                "measures a station outside the top three, keeps unreachable people as null, and knows only candidates",
            ) {
                val request = RecommendRequest(people("03v", "31a"), RecommendMode.FAIR)
                (
                    "4xz" in
                        service()
                            .evaluate(request)
                            .recommendation.candidates
                            .map { it.stationCode }
                ) shouldBe false
                service().evaluate(request).timesTo("4xz") shouldContainExactly
                    listOf(ParticipantTime("p0", 2400, 2), ParticipantTime("p1", 3000, 3))
                service().evaluate(request).timesTo("zzz").shouldBeNull()

                val gap =
                    smallOd(listOf("03v", "130"), listOf("03v", "130"), listOf(listOf(0, null), listOf(900, 0)))
                service(
                    gap,
                ).evaluate(
                    RecommendRequest(people("03v", "130"), RecommendMode.FAIR),
                ).timesTo("130") shouldContainExactly
                    listOf(null, ParticipantTime("p1", 0, 0))
            }

            it("rejects the same requests as recommend") {
                shouldThrow<RecommendationException> {
                    service().evaluate(RecommendRequest(people("03v", "zzz"), RecommendMode.FAIR)).timesTo("130")
                }.error shouldBe RecommendationError.UNKNOWN_STATION
            }
        }

        describe("request validation") {
            it("rejects fewer than two or more than four people") {
                shouldThrow<RecommendationException> {
                    service().evaluate(RecommendRequest(people("03v"), RecommendMode.FAIR)).recommendation
                }.error shouldBe RecommendationError.PEOPLE_COUNT
                shouldThrow<RecommendationException> {
                    service()
                        .evaluate(
                            RecommendRequest(people("03v", "130", "225", "31a", "03v"), RecommendMode.FAIR),
                        ).recommendation
                }.error shouldBe RecommendationError.PEOPLE_COUNT
            }

            it("rejects stations that are not origins") {
                shouldThrow<RecommendationException> {
                    service().evaluate(RecommendRequest(people("03v", "4xz"), RecommendMode.FAIR)).recommendation
                }.error shouldBe RecommendationError.UNKNOWN_STATION
                shouldThrow<RecommendationException> {
                    service().evaluate(RecommendRequest(people("03v", "ZZZ"), RecommendMode.FAIR)).recommendation
                }.error shouldBe RecommendationError.UNKNOWN_STATION
            }

            it("allows two people to start from the same station") {
                val result =
                    service()
                        .evaluate(
                            RecommendRequest(people("130", "130"), RecommendMode.FAIR),
                        ).recommendation
                result.candidates.first().stationCode shouldBe "130"
                result.candidates.first().reason shouldContain "같은 동네"
            }
        }
    })
