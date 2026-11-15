package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.TimeBand
import app.banbanyeok.schema.TimeSlot
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.comparables.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path
import java.time.LocalDate
import java.time.LocalTime
import kotlin.io.path.readText

private fun contract(name: String): JsonObject =
    Json.parseToJsonElement(Path.of(System.getProperty("contracts.dir"), name).readText()).jsonObject

private fun JsonObject.text(key: String): String? = this[key]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content

class TimeSlotTest :
    DescribeSpec({
        val slots = contract("time-slots.json")
        val resolver = TimeSlotResolver(HolidayCalendar.bundled())

        describe("contracts/time-slots.json") {
            it("resolves every vector (date, time) to the expected slot") {
                slots.getValue("vectors").jsonArray.map { it.jsonObject }.forEach { vector ->
                    val basis =
                        resolver.resolve(
                            vector.text("date")?.let(LocalDate::parse),
                            vector.text("time")?.let(LocalTime::parse),
                        )
                    withClue(vector.text("id")) { basis.slot.id shouldBe vector.text("expected") }
                }
            }
            it("uses the contract labels and slot ids") {
                val days = slots.getValue("dayTypes").jsonArray.map { it.jsonObject }
                val bands = slots.getValue("bands").jsonArray.map { it.jsonObject }
                days.map { it.text("id") } shouldBe DayType.entries.map { it.id }
                bands.map { it.text("id") } shouldBe TimeBand.entries.map { it.id }
                days.forEach { day ->
                    TimeSlotLabels.day(DayType.entries.single { it.id == day.text("id") }) shouldBe day.text("label")
                }
                bands.forEach { band ->
                    TimeSlotLabels.band(TimeBand.entries.single { it.id == band.text("id") }) shouldBe
                        band.text("label")
                }
                slots.text("default") shouldBe TimeSlot.DEFAULT.id
                TimeSlotLabels.of(TimeSlot(DayType.SATURDAY, TimeBand.EVENING)) shouldBe "토요일 저녁"
            }
            it("names the holiday of the service day") {
                resolver.resolve(LocalDate.parse("2026-12-25"), LocalTime.parse("19:00")).holidayName shouldBe "기독탄신일"
                // 12/26 01:00 belongs to the Christmas service day.
                resolver.resolve(LocalDate.parse("2026-12-26"), LocalTime.parse("01:00")).slot shouldBe
                    TimeSlot(DayType.HOLIDAY, TimeBand.NIGHT)
            }
        }

        describe("contracts/holidays.json") {
            it("is the bundled resource, with sources, and warns when it ends within two months") {
                val file = contract("holidays.json")
                file.getValue("sources").jsonArray.forEach {
                    it.jsonObject
                        .text("url")
                        .orEmpty()
                        .startsWith("https://") shouldBe
                        true
                }
                val bundled = HolidayCalendar.bundled()
                file.getValue("holidays").jsonArray.forEach {
                    val item = it.jsonObject
                    bundled.nameOf(LocalDate.parse(item.text("date"))) shouldBe item.text("name")
                }
                bundled.coverage.endInclusive shouldBeGreaterThan bundled.coverage.start
                // 연 1회 갱신 알림: 목록이 끝나기 두 달 전부터 경고만 남긴다(벽시계 때문에 CI 전체를 깨뜨리지 않는다).
                // 우주항공청 월력요항은 매년 6월 말 발표된다. 목록 밖 날짜는 일요일만 공휴일로 계산되어 서비스는 계속 동작한다.
                if (bundled.coverage.endInclusive < LocalDate.now().plusMonths(2)) {
                    System.err.println(
                        "경고: contracts/holidays.json이 ${bundled.coverage.endInclusive}에 끝납니다. 다음 해 월력요항으로 갱신하세요.",
                    )
                }
            }
            it("treats dates outside the list as ordinary days, Sundays still holidays") {
                val calendar = HolidayCalendar(emptyMap(), LocalDate.parse("2026-01-01")..LocalDate.parse("2026-12-31"))
                val outside = TimeSlotResolver(calendar)
                outside.resolve(LocalDate.parse("2028-01-02"), null).slot.day shouldBe DayType.HOLIDAY
                outside.resolve(LocalDate.parse("2028-01-03"), null).slot.day shouldBe DayType.WEEKDAY
            }
        }

        describe("slot matrices") {
            val night = TimeSlot(DayType.SATURDAY, TimeBand.NIGHT)
            val slower =
                smallOd(
                    origins = listOf("03v", "130", "225", "31a"),
                    candidates = listOf("03v", "130", "225", "31a", "4xz"),
                    times =
                        listOf(
                            listOf(0, 900, 1500, 2100, 2700),
                            listOf(1200, 0, 900, 1800, 1500),
                            listOf(1800, 1000, 0, 900, 1300),
                            listOf(2400, 1900, 950, 0, 3300),
                        ),
                )
            val provider = OdTravelTimeProvider(sampleOd, "20261116.1", mapOf(night to slower))

            it("reads the requested slot and reports it") {
                val matrix = provider.measure(listOf("03v"), night)
                matrix.slot shouldBe night
                matrix.times.single()[1] shouldBe 900
                provider.measure(listOf("03v")).times.single()[1] shouldBe 600
            }
            it("falls back to the default slot when the data has no matrix for the slot") {
                val matrix = provider.measure(listOf("03v"), TimeSlot(DayType.HOLIDAY, TimeBand.MORNING))
                matrix.slot shouldBe TimeSlot.DEFAULT
                matrix.times.single()[1] shouldBe 600
            }
            it("puts the actually used slot in the recommendation") {
                val service = RecommendationService(provider, codeNames)
                val people = listOf(RecommendParticipant("0", null, "03v"), RecommendParticipant("1", null, "130"))
                val asked = TimeBasis(night, TimeSlotLabels.of(night))
                val result = service.recommend(RecommendRequest(people, RecommendMode.FAIR, time = asked))
                result.timeBasis shouldBe asked
                result.candidates.first().maxSeconds shouldBe 900
                val missing = TimeSlot(DayType.HOLIDAY, TimeBand.MORNING)
                val fallback =
                    service.recommend(
                        RecommendRequest(
                            people,
                            RecommendMode.FAIR,
                            time = TimeBasis(missing, TimeSlotLabels.of(missing)),
                        ),
                    )
                fallback.timeBasis shouldBe TimeBasis(TimeSlot.DEFAULT, "평일 낮")
            }
        }
    })
