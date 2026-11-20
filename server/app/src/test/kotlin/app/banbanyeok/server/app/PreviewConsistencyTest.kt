package app.banbanyeok.server.app

import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.app.application.RoomPreview
import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.recommendation.OdTravelTimeProvider
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.SlotMatrices
import app.banbanyeok.server.recommendation.codeNames
import app.banbanyeok.server.recommendation.lasttrain.LastTrainData
import app.banbanyeok.server.recommendation.lasttrain.LastTrainSource
import app.banbanyeok.server.recommendation.sampleLastTrainAsOf
import app.banbanyeok.server.recommendation.sampleLastTrains
import app.banbanyeok.server.recommendation.sampleOd
import app.banbanyeok.server.recommendation.smallOd
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.FakeStationCatalog
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomFixture
import app.banbanyeok.server.room.RoomMode
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import kotlinx.coroutines.test.runTest
import java.time.LocalDate
import java.time.LocalTime
import java.util.concurrent.atomic.AtomicInteger

/** 평일 밤 행렬: [sampleOd]보다 모두 100초씩 느리다(대각선 제외). */
private val slowerNight =
    smallOd(
        origins = listOf("03v", "130", "225", "31a"),
        candidates = listOf("03v", "130", "225", "31a", "4xz"),
        times =
            listOf(
                listOf(0, 700, 1300, 1900, 2500),
                listOf(1000, 0, 700, 1600, 1300),
                listOf(1600, 800, 0, 700, 1100),
                listOf(2200, 1700, 750, 0, 3100),
            ),
    )

/** 03v(민수)와 130(지연)의 방. 지연이 순위 밖의 4xz로 정했다. */
private suspend fun decidedOutsideTop(
    recommendation: RecommendationService,
    date: LocalDate?,
    time: LocalTime?,
): Pair<RoomResultService, String> {
    val fixture = RoomFixture(stations = FakeStationCatalog(meetingStations = setOf("03v", "130", "225", "31a", "4xz")))
    val results = RoomResultService(fixture.service, recommendation, testTimes)
    val created =
        fixture.service.create(
            CreateRoomCommand(RoomMode.FAIR, null, date, ParticipantInput("민수", "03v", false), null, null, time),
        )
    val friend = fixture.service.join(created.roomId, ParticipantInput("지연", "130"), null)
    val seen = fixture.service.get(created.roomId, null).shareVersion
    fixture.service.decide(created.roomId, friend.participantToken, "4xz", seen)
    return results to created.roomId
}

/**
 * 링크 미리보기는 한 요청 안에서 행렬과 막차 표를 **한 번만** 읽는다(#88). 정한 역이 순위 밖이어도 그 역의 시간·막차가 순위와 같은
 * 행렬·같은 표에서 나와야 한다. 구분 행렬 검사나 막차 표 읽기가 요청 도중에 끝나는 경우(서버가 막 떴을 때)를 가짜 포트로 만든다.
 */
class PreviewConsistencyTest :
    DescribeSpec({
        describe("a decided station outside the top three") {
            it("takes its times from the matrix the ranking used, even if the slot matrix appears mid-request") {
                runTest {
                    val reads = AtomicInteger()
                    // 첫 측정에는 구분 행렬이 아직 없고(기본 구분으로 계산), 그다음부터 보인다.
                    val slots =
                        SlotMatrices { slot ->
                            if (reads.getAndIncrement() ==
                                0
                            ) {
                                null
                            } else {
                                slowerNight.takeIf { slot.id == "weekday-night" }
                            }
                        }
                    val recommendation =
                        RecommendationService(OdTravelTimeProvider(sampleOd, "20261120.1", slots), codeNames)
                    // 2026-11-27(금) 22:00 → 평일 밤을 요청한다.
                    val (results, roomId) =
                        decidedOutsideTop(
                            recommendation,
                            LocalDate.parse("2026-11-27"),
                            LocalTime.of(22, 0),
                        )
                    val preview = results.preview(roomId).shouldBeInstanceOf<RoomPreview.Decided>()
                    // 순위는 기본 구분(sampleOd)으로 계산됐다. 정한 역의 시간도 sampleOd의 4xz(2400, 1200)여야 한다.
                    preview.station.stationCode shouldBe "4xz"
                    preview.station.times.map { it.seconds } shouldBe listOf(2400, 1200)
                    reads.get() shouldBe 1
                }
            }

            it("carries no last train when the ranking had none, even if the table loads mid-request") {
                runTest {
                    val reads = AtomicInteger()
                    // 첫 조회에는 막차 표가 아직 없고, 그다음부터 있다.
                    val source =
                        LastTrainSource {
                            if (reads.getAndIncrement() ==
                                0
                            ) {
                                null
                            } else {
                                LastTrainData(sampleLastTrains, sampleLastTrainAsOf)
                            }
                        }
                    val recommendation =
                        RecommendationService(
                            OdTravelTimeProvider(sampleOd, "20261120.1", TimeSlot.ALL.associateWith { sampleOd }),
                            codeNames,
                            lastTrains = source,
                        )
                    val (results, roomId) = decidedOutsideTop(recommendation, date = null, time = null)
                    val preview = results.preview(roomId).shouldBeInstanceOf<RoomPreview.Decided>()
                    preview.lastTrainBasis.shouldBeNull()
                    preview.station.times.map { it.lastTrain } shouldBe listOf(null, null)
                    reads.get() shouldBe 1
                }
            }
        }
    })
