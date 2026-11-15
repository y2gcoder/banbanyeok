package app.banbanyeok.schema

/** 요일 유형(시간표 구분). 공휴일은 일요일 시간표를 쓴다. 정의 원본: contracts/time-slots.json. */
public enum class DayType(
    public val id: String,
) {
    WEEKDAY("weekday"),
    SATURDAY("saturday"),
    HOLIDAY("holiday"),
}

/** 시간대. 경계와 배차를 재는 창은 contracts/time-slots.json. */
public enum class TimeBand(
    public val id: String,
) {
    MORNING("morning"),
    DAY("day"),
    EVENING("evening"),
    NIGHT("night"),
}

/** 요일 유형 × 시간대 = 구분 하나. 구분마다 od 행렬이 하나 있다(data-format §5). 직렬화 표기는 [id] (`weekday-day`). */
public data class TimeSlot(
    public val day: DayType,
    public val band: TimeBand,
) {
    public val id: String get() = "${day.id}-${band.id}"

    override fun toString(): String = id

    public companion object {
        /** 기본 구분(평일 낮). manifest `files.od`가 이 행렬이다. 구분이 없는 요청·옛 공유 링크·SEO 페이지가 쓴다. */
        public val DEFAULT: TimeSlot = TimeSlot(DayType.WEEKDAY, TimeBand.DAY)

        /** 요일 유형 순, 그 안에서 시간대 순. */
        public val ALL: List<TimeSlot> = DayType.entries.flatMap { day -> TimeBand.entries.map { TimeSlot(day, it) } }

        public fun parseOrNull(id: String): TimeSlot? = ALL.firstOrNull { it.id == id }
    }
}
