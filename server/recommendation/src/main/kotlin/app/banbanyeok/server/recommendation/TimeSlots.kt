package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.TimeBand
import app.banbanyeok.schema.TimeSlot
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime

/**
 * 계산 기준(어느 구분의 행렬로 계산했는가). [label]은 화면 문구("토요일 저녁")이며 서버가 만든다(클라이언트는 그대로 쓴다).
 * [holidayName]은 약속일이 공휴일일 때 그 이름이다(방 결과에서만 생긴다).
 */
public data class TimeBasis(
    public val slot: TimeSlot,
    public val label: String,
    public val holidayName: String? = null,
)

/** 구분의 표시 이름. 정의 원본은 contracts/time-slots.json의 label이고 테스트가 대조한다. */
public object TimeSlotLabels {
    public fun day(day: DayType): String =
        when (day) {
            DayType.WEEKDAY -> "평일"
            DayType.SATURDAY -> "토요일"
            DayType.HOLIDAY -> "일요일·공휴일"
        }

    public fun band(band: TimeBand): String =
        when (band) {
            TimeBand.MORNING -> "아침"
            TimeBand.DAY -> "낮"
            TimeBand.EVENING -> "저녁"
            TimeBand.NIGHT -> "밤"
        }

    public fun of(slot: TimeSlot): String = "${day(slot.day)} ${band(slot.band)}"
}

/**
 * 관공서의 공휴일 목록(contracts/holidays.json, 빌드가 리소스로 넣는다). 일요일은 규칙으로 처리하므로 목록에 없어도 된다.
 * 목록 범위([coverage]) 밖의 날짜는 일요일만 공휴일로 본다(연 1회 갱신을 놓쳐도 계산은 계속된다).
 */
public class HolidayCalendar(
    private val names: Map<LocalDate, String>,
    public val coverage: ClosedRange<LocalDate>,
) {
    public fun nameOf(date: LocalDate): String? = names[date]

    public companion object {
        public fun parse(json: String): HolidayCalendar {
            val root = Json.parseToJsonElement(json).jsonObject
            val coverage = root.getValue("coverage").jsonObject
            val holidays =
                root.getValue("holidays").jsonArray.associate {
                    val item = it.jsonObject
                    LocalDate.parse(item.getValue("date").jsonPrimitive.content) to
                        item.getValue("name").jsonPrimitive.content
                }
            val from = LocalDate.parse(coverage.getValue("from").jsonPrimitive.content)
            val to = LocalDate.parse(coverage.getValue("to").jsonPrimitive.content)
            return HolidayCalendar(holidays, from..to)
        }

        /** 이 모듈에 들어 있는 contracts/holidays.json. */
        public fun bundled(): HolidayCalendar =
            parse(
                requireNotNull(HolidayCalendar::class.java.getResource("/holidays.json")) { "holidays.json 리소스가 없습니다" }
                    .readText(),
            )
    }
}

/**
 * 약속 날짜·시각 → 구분(contracts/time-slots.json의 rules). 03:00 전은 전날 운행일의 밤이고, 요일 유형은 운행일로 정한다.
 * 시각이 없으면 낮, 날짜가 없으면 평일이다.
 */
public class TimeSlotResolver(
    private val calendar: HolidayCalendar,
) {
    public fun resolve(
        date: LocalDate?,
        time: LocalTime?,
    ): TimeBasis {
        val band = time?.let(::bandOf) ?: TimeBand.DAY
        val serviceDay = if (time != null && time < SERVICE_DAY_START) date?.minusDays(1) else date
        val holiday = serviceDay?.let(calendar::nameOf)
        val day =
            when {
                serviceDay == null -> DayType.WEEKDAY
                holiday != null || serviceDay.dayOfWeek == DayOfWeek.SUNDAY -> DayType.HOLIDAY
                serviceDay.dayOfWeek == DayOfWeek.SATURDAY -> DayType.SATURDAY
                else -> DayType.WEEKDAY
            }
        val slot = TimeSlot(day, band)
        return TimeBasis(slot, TimeSlotLabels.of(slot), holiday)
    }

    private fun bandOf(time: LocalTime): TimeBand =
        when {
            time < SERVICE_DAY_START -> TimeBand.NIGHT
            time < DAY_START -> TimeBand.MORNING
            time < EVENING_START -> TimeBand.DAY
            time < NIGHT_START -> TimeBand.EVENING
            else -> TimeBand.NIGHT
        }

    private companion object {
        val SERVICE_DAY_START: LocalTime = LocalTime.of(3, 0)
        val DAY_START: LocalTime = LocalTime.of(10, 0)
        val EVENING_START: LocalTime = LocalTime.of(17, 0)
        val NIGHT_START: LocalTime = LocalTime.of(21, 0)
    }
}
