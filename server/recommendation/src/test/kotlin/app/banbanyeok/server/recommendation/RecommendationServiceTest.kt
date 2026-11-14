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
                val result = service().recommend(RecommendRequest(people("03v", "130"), RecommendMode.FAIR))
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
                val result = service().recommend(RecommendRequest(people("130", "225"), RecommendMode.FAIR))
                result.candidates.map { it.rank } shouldContainExactly listOf(1, 2, 3)
                result.candidates
                    .drop(1)
                    .map { it.reasonCode }
                    .toSet() shouldBe setOf("FAIR_ALTERNATIVE")
                result.candidates.size shouldBeLessThanOrEqual 3
            }

            it("uses nicknames, or origin labels when there are none, never a first-person word") {
                val named =
                    service().recommend(
                        RecommendRequest(
                            listOf(RecommendParticipant("a", "민수", "03v"), RecommendParticipant("b", "지연", "130")),
                            RecommendMode.FAIR,
                        ),
                    )
                named.candidates.first().reason shouldContain "민수"
                named.labels.map { it.text } shouldContainExactly listOf("민수", "지연")
                val anonymous = service().recommend(RecommendRequest(people("03v", "130"), RecommendMode.FAIR))
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
                val same = service().recommend(RecommendRequest(people("03v", "03v", "130"), RecommendMode.FAIR))
                same.labels.map { it.text } shouldContainExactly
                    listOf("03v역에서 오는 분 1", "03v역에서 오는 분 2", "130역에서 오는 분")
                val twins =
                    service().recommend(
                        RecommendRequest(
                            listOf(RecommendParticipant("a", "민수", "03v"), RecommendParticipant("b", "민수", "130")),
                            RecommendMode.FAIR,
                        ),
                    )
                twins.labels.map { it.text } shouldContainExactly listOf("민수 1", "민수 2")
            }

            it("never puts a hidden participant's origin into labels or sentences") {
                val result =
                    service().recommend(
                        RecommendRequest(
                            listOf(
                                RecommendParticipant("a", null, "03v"),
                                RecommendParticipant("b", null, "130", hidden = true),
                            ),
                            RecommendMode.FAST,
                        ),
                    )
                result.labels.map { it.text } shouldContainExactly listOf("03v역에서 오는 분", "참가자 2")
                result.labels.map { it.kind } shouldContainExactly listOf(LabelKind.ORIGIN, LabelKind.ORDINAL)
                result.candidates.map { it.reason }.forEach { it shouldNotContain "130역에서" }
            }

            it("treats a blank nickname as none and rejects an invalid one") {
                val blank =
                    service().recommend(
                        RecommendRequest(
                            listOf(RecommendParticipant("a", "  ", "03v"), RecommendParticipant("b", "지연", "130")),
                            RecommendMode.FAIR,
                        ),
                    )
                blank.labels.first().text shouldBe "03v역에서 오는 분"
                shouldThrow<RecommendationException> {
                    service().recommend(
                        RecommendRequest(
                            listOf(
                                RecommendParticipant("a", "가".repeat(21), "03v"),
                                RecommendParticipant("b", null, "130"),
                            ),
                            RecommendMode.FAIR,
                        ),
                    )
                }.error shouldBe RecommendationError.INVALID_NICKNAME
            }
        }

        describe("fast mode") {
            it("ranks by the sum of travel times") {
                val result = service().recommend(RecommendRequest(people("03v", "31a"), RecommendMode.FAST))
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
                val result = service().recommend(request)
                val first = result.candidates.first()
                first.reasonCode shouldBe "FAVOR_CAPPED"
                first.favoredSeconds shouldBe first.times[1].seconds
                first.reason.shouldNotBeBlank()
                result.baselineStationCode.shouldNotBeNull()
            }

            it("requires an existing favor target") {
                shouldThrow<RecommendationException> {
                    service().recommend(RecommendRequest(people("03v", "130"), RecommendMode.FAVOR))
                }.error shouldBe RecommendationError.FAVOR_TARGET_REQUIRED
                shouldThrow<RecommendationException> {
                    service().recommend(RecommendRequest(people("03v", "130"), RecommendMode.FAVOR, favorId = "x"))
                }.error shouldBe RecommendationError.FAVOR_TARGET_UNKNOWN
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
                val result = service(od).recommend(RecommendRequest(people("03v", "130"), RecommendMode.FAIR))
                result.status shouldBe "no_common_candidate"
                result.candidates.shouldBeEmpty()
                result.baselineStationCode.shouldBeNull()
            }
        }

        describe("request validation") {
            it("rejects fewer than two or more than four people") {
                shouldThrow<RecommendationException> {
                    service().recommend(RecommendRequest(people("03v"), RecommendMode.FAIR))
                }.error shouldBe RecommendationError.PEOPLE_COUNT
                shouldThrow<RecommendationException> {
                    service().recommend(RecommendRequest(people("03v", "130", "225", "31a", "03v"), RecommendMode.FAIR))
                }.error shouldBe RecommendationError.PEOPLE_COUNT
            }

            it("rejects stations that are not origins") {
                shouldThrow<RecommendationException> {
                    service().recommend(RecommendRequest(people("03v", "4xz"), RecommendMode.FAIR))
                }.error shouldBe RecommendationError.UNKNOWN_STATION
                shouldThrow<RecommendationException> {
                    service().recommend(RecommendRequest(people("03v", "ZZZ"), RecommendMode.FAIR))
                }.error shouldBe RecommendationError.UNKNOWN_STATION
            }

            it("allows two people to start from the same station") {
                val result = service().recommend(RecommendRequest(people("130", "130"), RecommendMode.FAIR))
                result.candidates.first().stationCode shouldBe "130"
                result.candidates.first().reason shouldContain "같은 동네"
            }
        }
    })
