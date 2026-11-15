package app.banbanyeok.pipeline

/**
 * 요일 유형. 원천의 시간표 구분과 1:1이다(S5 `WEEK_TAG` 1/2/3, TAGO `dailyTypeCode` 01/02/03).
 * 공휴일은 두 원천 모두 일요일 시간표를 쓴다. 정의 원본은 contracts/time-slots.json.
 */
internal enum class DayType(
    val id: String,
    val seoulWeekTag: String,
    val tagoDailyType: String,
) {
    WEEKDAY("weekday", "1", "01"),
    SATURDAY("saturday", "2", "02"),
    HOLIDAY("holiday", "3", "03"),
}

private const val HOUR = 3600

/**
 * 시간대. [window]는 배차를 재는 출발 시각 창이다(서비스일 초, 양끝 포함, 00~02시는 24~26시).
 * 낮은 P2b 이래의 평시 창(10:00~16:00)을 그대로 써서 기존 평일 낮 결과가 바뀌지 않게 한다. 근거는 docs/setup/t2-notes.md.
 */
internal enum class Band(
    val id: String,
    val window: IntRange,
) {
    MORNING("morning", 7 * HOUR..10 * HOUR),
    DAY("day", 10 * HOUR..16 * HOUR),
    EVENING("evening", 17 * HOUR..21 * HOUR),
    NIGHT("night", 21 * HOUR..24 * HOUR),
}

/** 요일 유형 × 시간대 = 구분 하나. 구분마다 od 행렬이 하나씩 있다. */
internal data class TimeSlot(
    val day: DayType,
    val band: Band,
) {
    val id: String get() = "${day.id}-${band.id}"

    override fun toString(): String = id

    companion object {
        /** 기본 구분. `files.od`가 이 행렬이고, 구분이 없는 요청·옛 공유 링크(v=1)·SEO 페이지가 쓴다. */
        val DEFAULT = TimeSlot(DayType.WEEKDAY, Band.DAY)
        val ALL: List<TimeSlot> = DayType.entries.flatMap { day -> Band.entries.map { TimeSlot(day, it) } }

        fun parse(id: String): TimeSlot = ALL.firstOrNull { it.id == id } ?: error("Unknown time slot $id")
    }
}

/** "HH:MM:SS–HH:MM:SS" 표기(보고서·headways.json용). */
internal fun windowText(window: IntRange): String {
    fun clock(seconds: Int) =
        "%02d:%02d:%02d".format(
            java.util.Locale.ROOT,
            seconds / HOUR,
            seconds % HOUR / 60,
            seconds % 60,
        )
    return "${clock(window.first)}–${clock(window.last)}"
}
