package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.TimeBand
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.recommendation.lasttrain.LastTrainData
import app.banbanyeok.server.recommendation.mapmiddle.GeoPoint
import app.banbanyeok.server.recommendation.mapmiddle.StationLocations
import app.banbanyeok.server.recommendation.time.DayCertainty
import app.banbanyeok.server.recommendation.time.TimeBasis
import app.banbanyeok.server.recommendation.time.TimeSlotLabels
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import java.nio.file.Files
import java.nio.file.Path
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/**
 * [RecommendationService]의 결과를 통째로 고정하는 특성 테스트(#88). 모드 3종 × 구분(기본 / 행렬이 있는 비기본 / 행렬이
 * 없는 비기본) × 막차 기준(KNOWN / DEFAULTED / OUT_OF_RANGE)마다 순위, 지도 한가운데, 순위 밖 역까지의 시간·막차를 적는다.
 * 구조를 바꾸는 리팩터링 앞뒤로 글자까지 같아야 한다. 의도한 변경일 때만 `UPDATE_CHARACTERIZATION=1`로 다시 쓴다.
 */
class RecommendationSnapshotTest :
    DescribeSpec({
        it("keeps the whole result for every mode, time slot and day certainty") {
            val night = TimeSlot(DayType.WEEKDAY, TimeBand.NIGHT)
            val saturdayNight = TimeSlot(DayType.SATURDAY, TimeBand.NIGHT)
            val holidayMorning = TimeSlot(DayType.HOLIDAY, TimeBand.MORNING)
            // 평일 밤만 다른(느린) 행렬이 있다. 토요일 밤은 행렬이 없어 기본 구분으로 계산되고 막차가 빠진다.
            val slower =
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
            val locations =
                StationLocations {
                    mapOf(
                        "03v" to GeoPoint(37.50, 127.00),
                        "130" to GeoPoint(37.50, 127.20),
                        "225" to GeoPoint(37.50, 127.10),
                        "31a" to GeoPoint(37.56, 127.10),
                        "4xz" to GeoPoint(37.40, 127.30),
                    )[it]
                }
            val service =
                RecommendationService(
                    OdTravelTimeProvider(sampleOd, "20261120.1", mapOf(night to slower, holidayMorning to sampleOd)),
                    codeNames,
                    toleranceSeconds = 60,
                    locations = locations,
                    lastTrains = { LastTrainData(sampleLastTrains, sampleLastTrainAsOf) },
                    clock = Clock.fixed(Instant.parse("2026-11-20T03:00:00Z"), ZoneOffset.UTC),
                )
            val origins = listOf("03v", "130")
            val people = origins.mapIndexed { i, code -> RecommendParticipant("p$i", "사람$i".takeIf { i == 0 }, code) }
            val lines = mutableListOf<String>()
            for (mode in RecommendMode.entries) {
                for (slot in listOf(TimeSlot.DEFAULT, night, saturdayNight, holidayMorning)) {
                    for (certainty in DayCertainty.entries) {
                        val request =
                            RecommendRequest(
                                people,
                                mode,
                                favorId = if (mode == RecommendMode.FAVOR) people.last().id else null,
                                time = TimeBasis(slot, TimeSlotLabels.of(slot)),
                                dayCertainty = certainty,
                            )
                        lines += "## ${origins.joinToString("+")} $mode ${slot.id} $certainty"
                        lines += snapshot(service, request)
                    }
                }
            }
            val actual = lines.joinToString("\n", postfix = "\n")
            val path = Path.of("src/test/resources/characterization/recommendation-service.txt")
            if (System.getenv("UPDATE_CHARACTERIZATION") == "1") {
                Files.createDirectories(path.parent)
                Files.writeString(path, actual)
            }
            actual shouldBe Files.readString(path)
        }
    })

/** 한 요청에 대해 응용 계층이 꺼내 쓰는 값 전부. 순위 밖의 역(4xz·03v)까지의 시간과 막차도 적는다. */
private suspend fun snapshot(
    service: RecommendationService,
    request: RecommendRequest,
): List<String> {
    val evaluation = service.evaluate(request)
    val recommendation = evaluation.recommendation
    return listOf(
        "recommendation=$recommendation",
        "mapMiddle=${evaluation.mapMiddle}",
        "recommendEqualsRanking=${service.evaluate(request).recommendation == recommendation}",
    ) +
        listOf("03v", "4xz", "zzz").flatMap { code ->
            // 순위 밖 역의 막차는 응답의 막차 기준과 짝이다(기준이 없으면 막차도 없다). 줄 이름은 리팩터링 전 함수 이름 그대로 둔다(기대값 고정).
            val lastTrains = evaluation.lastTrainsAt(code)?.let { requireNotNull(recommendation.lastTrainBasis) to it }
            listOf(
                "timesTo($code)=${evaluation.timesTo(code)}",
                "lastTrainsTo($code)=$lastTrains",
            )
        }
}
