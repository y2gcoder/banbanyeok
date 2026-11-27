package app.banbanyeok.server.app

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.TimeBand
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.app.application.CanonicalStations
import app.banbanyeok.server.app.application.StatelessRecommendation
import app.banbanyeok.server.app.application.StatelessRequest
import app.banbanyeok.server.recommendation.OdTravelTimeProvider
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.RecommendRequest
import app.banbanyeok.server.recommendation.RecommendationError
import app.banbanyeok.server.recommendation.RecommendationException
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.codeNames
import app.banbanyeok.server.recommendation.lasttrain.LastTrainData
import app.banbanyeok.server.recommendation.lasttrain.LastTrainUnavailable
import app.banbanyeok.server.recommendation.sampleLastTrainAsOf
import app.banbanyeok.server.recommendation.sampleLastTrains
import app.banbanyeok.server.recommendation.sampleOd
import app.banbanyeok.server.recommendation.time.DayCertainty
import app.banbanyeok.server.recommendation.time.TimeBasis
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.mockk.coEvery
import io.mockk.mockk
import io.mockk.slot
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneOffset

/** 무상태 추천의 규칙(정식 코드화, 입력 순서 참가자, 구분 결정, [DayCertainty])을 Ktor 없이 확인한다. */
class StatelessRecommendationTest :
    DescribeSpec({
        val keep = CanonicalStations { it }

        /** 서비스를 가짜로 두고 유스케이스가 서비스에 넘긴 요청만 본다(서비스는 요청을 받자마자 오류를 던진다). */
        suspend fun sentToService(
            request: StatelessRequest,
            stations: CanonicalStations = keep,
        ): RecommendRequest {
            val service = mockk<RecommendationService>()
            val sent = slot<RecommendRequest>()
            coEvery { service.evaluate(capture(sent)) } throws
                RecommendationException(RecommendationError.PEOPLE_COUNT, "x")
            shouldThrow<RecommendationException> { StatelessRecommendation(service, stations).recommend(request) }
            return sent.captured
        }

        fun request(
            slot: TimeSlot?,
            mode: RecommendMode = RecommendMode.FAIR,
            favorIndex: Int? = null,
            origins: List<String> = listOf("03v", "130"),
            nicknames: List<String?> = origins.map { null },
        ) = StatelessRequest(origins, nicknames, mode, favorIndex, slot)

        describe("the time slot and how far to trust its day type") {
            it("calculates a request without a slot for weekday daytime but does not trust the weekday") {
                val sent = sentToService(request(slot = null))
                sent.time shouldBe TimeBasis.of(TimeSlot.DEFAULT)
                sent.dayCertainty shouldBe DayCertainty.DEFAULTED
            }

            it("trusts a slot the person chose, even when it is the default slot") {
                val sent = sentToService(request(slot = TimeSlot.DEFAULT))
                sent.time shouldBe TimeBasis.of(TimeSlot.DEFAULT)
                sent.dayCertainty shouldBe DayCertainty.KNOWN
            }

            it("calculates for the slot the person chose") {
                val saturdayNight = TimeSlot(DayType.SATURDAY, TimeBand.NIGHT)
                val sent = sentToService(request(slot = saturdayNight))
                sent.time shouldBe TimeBasis.of(saturdayNight)
                sent.dayCertainty shouldBe DayCertainty.KNOWN
            }
        }

        describe("the people") {
            it("ids people by their positions and keeps their origins") {
                val sent =
                    sentToService(
                        request(null, origins = listOf("03v", "130", "225"), nicknames = listOf("민수", null, "지연")),
                    )
                sent.participants.map { it.id } shouldBe listOf("0", "1", "2")
                sent.participants.map { it.nickname } shouldBe listOf("민수", null, "지연")
                sent.participants.map { it.originCode } shouldBe listOf("03v", "130", "225")
            }

            it("replaces retired station codes with their current codes") {
                val renamed = CanonicalStations { if (it == "old") "130" else it }
                val sent = sentToService(request(null, origins = listOf("03v", "old")), renamed)
                sent.participants.map { it.originCode } shouldBe listOf("03v", "130")
            }

            it("passes the favor index as the favored person's id") {
                val sent = sentToService(request(null, RecommendMode.FAVOR, favorIndex = 1))
                sent.mode shouldBe RecommendMode.FAVOR
                sent.favorId shouldBe "1"
                sentToService(request(null)).favorId.shouldBeNull()
            }

            it("rejects nicknames that do not line up with the origins") {
                shouldThrow<IllegalArgumentException> { request(null, nicknames = listOf("민수")) }
            }
        }

        describe("the result") {
            val service =
                RecommendationService(
                    OdTravelTimeProvider(sampleOd, "20261120.1", TimeSlot.ALL.associateWith { sampleOd }),
                    codeNames,
                    lastTrains = { LastTrainData(sampleLastTrains, sampleLastTrainAsOf) },
                    clock =
                        Clock.fixed(
                            LocalDate.parse("2026-11-20").atTime(12, 0).toInstant(ZoneOffset.UTC),
                            ZoneOffset.UTC,
                        ),
                )
            val useCase = StatelessRecommendation(service, CanonicalStations { if (it == "old") "130" else it })

            it("gives back the current codes and the nicknames, with the ranking for them") {
                val result =
                    useCase.recommend(
                        request(TimeSlot.DEFAULT, origins = listOf("03v", "old"), nicknames = listOf("민수", null)),
                    )
                result.origins shouldBe listOf("03v", "130")
                result.nicknames shouldBe listOf("민수", null)
                result.recommendation.candidates
                    .shouldNotBeNull()
                    .first()
                    .times
                    .map { it.participantId } shouldBe
                    listOf("0", "1")
                result.mapMiddle.shouldBeNull()
            }

            it("does not give a last-train time for a slot nobody chose, and does for one somebody chose") {
                val defaulted = useCase.recommend(request(null)).recommendation
                defaulted.lastTrainBasis.shouldNotBeNull().unavailable shouldBe LastTrainUnavailable.DAY_UNKNOWN
                val chosen = useCase.recommend(request(TimeSlot.DEFAULT)).recommendation
                chosen.lastTrainBasis
                    .shouldNotBeNull()
                    .unavailable
                    .shouldBeNull()
            }

            it("works on the lists as they were when the request was made, whatever the caller does to them later") {
                val origins = mutableListOf("03v", "130")
                val nicknames = mutableListOf<String?>("민수", null)
                val made = StatelessRequest(origins, nicknames, RecommendMode.FAIR, null, TimeSlot.DEFAULT)
                // 요청을 만든 뒤 호출자가 가변 목록을 바꾼다(첫 별칭 교체, 비우기).
                nicknames[0] = "바뀜"
                origins.clear()
                nicknames.clear()
                val result = useCase.recommend(made)
                result.origins shouldBe listOf("03v", "130")
                result.nicknames shouldBe listOf("민수", null)
                // 별칭과 표시 이름은 같은 사본에서 나온다.
                result.recommendation.labels
                    .first()
                    .text shouldBe "민수"
                // 평가가 끝난 뒤에 바꿔도 결과는 그대로다.
                origins.add("225")
                result.origins shouldBe listOf("03v", "130")
            }

            it("rejects nicknames that do not line up with the origins when the request is made") {
                shouldThrow<IllegalArgumentException> {
                    StatelessRequest(listOf("03v", "130"), listOf("민수"), RecommendMode.FAIR, null, null)
                }
            }

            it("lets the recommendation's own errors through for the HTTP layer to translate") {
                val e =
                    shouldThrow<RecommendationException> {
                        useCase.recommend(
                            request(null, origins = listOf("03v", "zzz")),
                        )
                    }
                e.error shouldBe RecommendationError.UNKNOWN_STATION
            }
        }
    })
