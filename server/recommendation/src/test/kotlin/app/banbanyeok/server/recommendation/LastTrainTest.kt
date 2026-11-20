package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainCell
import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.TimeBand
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.recommendation.lasttrain.LastTrainBasis
import app.banbanyeok.server.recommendation.lasttrain.LastTrainData
import app.banbanyeok.server.recommendation.lasttrain.LastTrainRule
import app.banbanyeok.server.recommendation.lasttrain.LastTrainSource
import app.banbanyeok.server.recommendation.lasttrain.LastTrainUnavailable
import app.banbanyeok.server.recommendation.lasttrain.ParticipantLastTrain
import app.banbanyeok.server.recommendation.time.DayCertainty
import app.banbanyeok.server.recommendation.time.HolidayCalendar
import app.banbanyeok.server.recommendation.time.TimeBasis
import app.banbanyeok.server.recommendation.time.TimeSlotLabels
import app.banbanyeok.server.recommendation.time.TimeSlotResolver
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

private val asOf: LocalDate = sampleLastTrainAsOf

private fun code(text: String) = StationCode.parse(text)

private fun clockOn(date: String): Clock = Clock.fixed(Instant.parse("${date}T03:00:00Z"), ZoneOffset.UTC)

private fun service(
    source: LastTrainSource = LastTrainSource { LastTrainData(sampleLastTrains, asOf) },
    clock: Clock = clockOn("2026-11-20"),
    slots: Map<TimeSlot, app.banbanyeok.schema.OdMatrix> = TimeSlot.ALL.associateWith { sampleOd },
) = RecommendationService(
    OdTravelTimeProvider(sampleOd, "20261120.1", slots),
    codeNames,
    lastTrains = source,
    clock = clock,
)

private fun person(
    id: String,
    origin: String,
    hidden: Boolean = false,
) = RecommendParticipant(id, null, origin, hidden)

private val night = TimeSlot(DayType.WEEKDAY, TimeBand.NIGHT)

private fun request(
    people: List<RecommendParticipant> = listOf(person("a", "03v"), person("b", "130")),
    slot: TimeSlot = night,
    certainty: DayCertainty = DayCertainty.KNOWN,
    viewer: String? = null,
    mode: RecommendMode = RecommendMode.FAIR,
) = RecommendRequest(
    people,
    mode,
    time = TimeBasis(slot, TimeSlotLabels.of(slot)),
    dayCertainty = certainty,
    viewerId = viewer,
)

private fun Recommendation.at(station: String) = candidates.first { it.stationCode == station }.lastTrains

class LastTrainTest :
    DescribeSpec({
        describe("last trains on a recommendation") {
            it("attaches each visible person's last train to every candidate, with the classification unchanged") {
                val result = service().evaluate(request()).recommendation
                result.lastTrainBasis shouldBe LastTrainBasis(DayType.WEEKDAY, asOf)
                result.candidates.forEach { card ->
                    card.lastTrains.shouldNotBeNull().map { it.participantId } shouldBe
                        listOf("a", "b")
                }
                val at130 = result.at("130").shouldNotBeNull()
                at130[0] shouldBe
                    ParticipantLastTrain("a", LastTrainCell(LastTrainKind.DIRECT, 1443, code("4xz")), "4xz역")
                // 자기 역에서 만나면 돌아갈 열차가 없다(대각은 확인 필요로 비어 있다).
                at130[1] shouldBe ParticipantLastTrain("b", LastTrainCell.UNKNOWN, null)
                result.at("03v").shouldNotBeNull()[1] shouldBe
                    ParticipantLastTrain("b", LastTrainCell(LastTrainKind.MARGIN_TRANSFER, 1397, null), null)
            }

            it("never changes the ranking, the times or the reasons") {
                val requests =
                    RecommendMode.entries.flatMap { mode ->
                        listOf(
                            request(mode = mode).let { if (mode == RecommendMode.FAVOR) favoring(it, "a") else it },
                            request(
                                listOf(person("a", "03v"), person("b", "225", hidden = true), person("c", "31a")),
                                mode = mode,
                            ).let { if (mode == RecommendMode.FAVOR) favoring(it, "c") else it },
                        )
                    }
                requests.forEach { request ->
                    val with = service().evaluate(request).recommendation
                    val without = service(source = { null }).evaluate(request).recommendation
                    with.candidates.map { it.copy(lastTrains = null) } shouldBe without.candidates
                    with.copy(candidates = emptyList(), lastTrainBasis = null) shouldBe
                        without.copy(candidates = emptyList())
                    with.candidates.map { it.rank to it.stationCode } shouldBe
                        without.candidates.map { it.rank to it.stationCode }
                }
            }

            it("uses the day type of the slot that was actually computed") {
                val holiday = TimeSlot(DayType.HOLIDAY, TimeBand.EVENING)
                val result = service().evaluate(request(slot = holiday)).recommendation
                result.lastTrainBasis shouldBe LastTrainBasis(DayType.HOLIDAY, asOf)
                result
                    .at("130")
                    .shouldNotBeNull()[0]
                    .cell.minute shouldBe 1410
                // 토요일은 표에 값이 없다: 시각 없이 확인 필요.
                val saturday =
                    service()
                        .evaluate(
                            request(slot = TimeSlot(DayType.SATURDAY, TimeBand.NIGHT)),
                        ).recommendation
                saturday.lastTrainBasis shouldBe LastTrainBasis(DayType.SATURDAY, asOf)
                saturday.at("130").shouldNotBeNull().map { it.cell } shouldBe
                    listOf(LastTrainCell.UNKNOWN, LastTrainCell.UNKNOWN)
            }

            it("says when the day type was computed from some lines only") {
                val partial =
                    service(LastTrainSource { LastTrainData(sampleLastTrains, asOf, setOf(DayType.SATURDAY)) })
                partial
                    .evaluate(request(slot = TimeSlot(DayType.SATURDAY, TimeBand.NIGHT)))
                    .recommendation
                    .lastTrainBasis shouldBe LastTrainBasis(DayType.SATURDAY, asOf, partial = true)
                partial.evaluate(request()).recommendation.lastTrainBasis shouldBe LastTrainBasis(DayType.WEEKDAY, asOf)
            }

            it("leaves last trains out when the requested slot could not be computed") {
                // 구분 행렬이 없으면 평일 낮으로 대신 계산한다. 그 응답에 다른 요일의 막차를 붙이지 않는다.
                val result =
                    service(
                        slots = emptyMap(),
                    ).evaluate(request(slot = TimeSlot(DayType.HOLIDAY, TimeBand.NIGHT))).recommendation
                result.timeBasis.slot shouldBe TimeSlot.DEFAULT
                result.lastTrainBasis.shouldBeNull()
                result.candidates.forEach { it.lastTrains.shouldBeNull() }
            }

            it("leaves last trains out while the table is not ready or failed validation") {
                val result = service(source = { null }).evaluate(request()).recommendation
                result.lastTrainBasis.shouldBeNull()
                result.candidates.forEach { it.lastTrains.shouldBeNull() }
            }
        }

        describe("when the times must not be shown") {
            it("turns every entry into check once the timetable is older than 120 days") {
                val lastDay = service(clock = clockOn("2027-03-16")).evaluate(request()).recommendation
                lastDay.lastTrainBasis shouldBe LastTrainBasis(DayType.WEEKDAY, asOf)
                lastDay
                    .at("130")
                    .shouldNotBeNull()[0]
                    .cell.kind shouldBe LastTrainKind.DIRECT
                val stale = service(clock = clockOn("2027-03-17")).evaluate(request()).recommendation
                stale.lastTrainBasis shouldBe LastTrainBasis(DayType.WEEKDAY, asOf, LastTrainUnavailable.STALE)
                stale.candidates.forEach { card ->
                    card.lastTrains.shouldNotBeNull().map { it.cell } shouldBe
                        listOf(LastTrainCell.UNKNOWN, LastTrainCell.UNKNOWN)
                }
            }

            it("counts the 120 days on the Seoul calendar") {
                // 2027-03-16 15:00Z는 서울 3월 17일 00:00이다.
                LastTrainRule.stale(asOf, Clock.fixed(Instant.parse("2027-03-16T14:59:59Z"), ZoneOffset.UTC)) shouldBe
                    false
                LastTrainRule.stale(asOf, Clock.fixed(Instant.parse("2027-03-16T15:00:00Z"), ZoneOffset.UTC)) shouldBe
                    true
            }

            it("shows no time when the day type was not chosen or the date is beyond the holiday list") {
                val defaulted = service().evaluate(request(certainty = DayCertainty.DEFAULTED)).recommendation
                defaulted.lastTrainBasis?.unavailable shouldBe LastTrainUnavailable.DAY_UNKNOWN
                defaulted
                    .at("130")
                    .shouldNotBeNull()
                    .map { it.cell.kind }
                    .distinct() shouldBe
                    listOf(LastTrainKind.UNKNOWN)
                val beyond = service().evaluate(request(certainty = DayCertainty.OUT_OF_RANGE)).recommendation
                beyond.lastTrainBasis?.unavailable shouldBe LastTrainUnavailable.DATE_OUT_OF_RANGE
                beyond
                    .at("130")
                    .shouldNotBeNull()
                    .map { it.cell.kind }
                    .distinct() shouldBe
                    listOf(LastTrainKind.UNKNOWN)
            }
        }

        describe("a participant who hid the origin") {
            val people = listOf(person("a", "03v"), person("b", "225", hidden = true), person("c", "31a"))

            it("is left out of everyone else's result") {
                val result = service().evaluate(request(people)).recommendation
                result.candidates.forEach { card ->
                    card.lastTrains.shouldNotBeNull().map { it.participantId } shouldContainExactly listOf("a", "c")
                }
                service().evaluate(request(people, viewer = "a")).recommendation.candidates.forEach { card ->
                    card.lastTrains.shouldNotBeNull().map { it.participantId } shouldContainExactly listOf("a", "c")
                }
            }

            it("sees the own last train on the own request only") {
                val own = service().evaluate(request(people, viewer = "b")).recommendation
                own.candidates.forEach { card ->
                    card.lastTrains.shouldNotBeNull().map { it.participantId } shouldBe
                        listOf("a", "b", "c")
                }
                own.at("130").shouldNotBeNull()[1] shouldBe
                    ParticipantLastTrain("b", LastTrainCell(LastTrainKind.MARGIN_DIRECT, 1421, code("31a")), "31a역")
            }

            it("gives others the same answer whatever the hidden origin is") {
                // 숨긴 사람의 출발역만 다른 두 요청에서, 다른 사람이 받는 막차는 같다(같은 후보에 대해).
                val one = service().evaluate(request(people)).recommendation
                val other =
                    service()
                        .evaluate(
                            request(listOf(person("a", "03v"), person("b", "130", hidden = true), person("c", "31a"))),
                        ).recommendation
                val shared =
                    one.candidates.map { it.stationCode }.intersect(
                        other.candidates.map { it.stationCode }.toSet(),
                    )
                shared.isNotEmpty() shouldBe true
                shared.forEach { station -> one.at(station) shouldBe other.at(station) }
            }

            it("is also left out of last trains read for a station outside the ranking") {
                val service = service()
                val evaluation = service.evaluate(request(people))
                evaluation.recommendation.lastTrainBasis shouldBe LastTrainBasis(DayType.WEEKDAY, asOf)
                evaluation.lastTrainsAt("4xz").shouldNotBeNull().map { it.participantId } shouldBe listOf("a", "c")
                service
                    .evaluate(request(people, viewer = "b"))
                    .lastTrainsAt("4xz")
                    .shouldNotBeNull()
                    .map { it.participantId } shouldBe
                    listOf("a", "b", "c")
            }
        }

        describe("day certainty of a room's date") {
            val resolver = TimeSlotResolver(HolidayCalendar.bundled())

            it("is known inside the holiday list, defaulted without a date, and out of range beyond the list") {
                resolver.certainty(LocalDate.parse("2026-11-27"), null) shouldBe DayCertainty.KNOWN
                resolver.certainty(null, null) shouldBe DayCertainty.DEFAULTED
                resolver.certainty(LocalDate.parse("2028-01-03"), null) shouldBe DayCertainty.OUT_OF_RANGE
                // 범위 밖이어도 일요일은 언제나 휴일이다.
                resolver.certainty(LocalDate.parse("2028-01-02"), null) shouldBe DayCertainty.KNOWN
                // 03:00 전은 전날 운행일이다: 2028-01-01 01:00은 2027-12-31(범위 안)의 밤이다.
                resolver.certainty(LocalDate.parse("2028-01-01"), java.time.LocalTime.of(1, 0)) shouldBe
                    DayCertainty.KNOWN
            }
        }
    })

private fun favoring(
    request: RecommendRequest,
    id: String,
) = RecommendRequest(request.participants, request.mode, id, request.time, request.dayCertainty, request.viewerId)
