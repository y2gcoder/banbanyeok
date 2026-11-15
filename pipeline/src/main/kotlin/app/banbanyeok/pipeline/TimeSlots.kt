package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.TimeBand

// 구분(요일 유형 × 시간대)의 어휘는 shared:schema(TimeSlot), 정의 원본은 contracts/time-slots.json.
// 여기에는 파이프라인만 쓰는 원천 대응(시간표 구분 코드)과 배차를 재는 창을 둔다. 근거: docs/setup/t2-notes.md.

/** S5 `WEEK_TAG`: 1 평일, 2 토요일, 3 휴일(일요일·공휴일). */
internal val DayType.seoulWeekTag: String
    get() =
        when (this) {
            DayType.WEEKDAY -> "1"
            DayType.SATURDAY -> "2"
            DayType.HOLIDAY -> "3"
        }

/** TAGO `dailyTypeCode`: 01 평일, 02 토요일, 03 일요일(공휴일 포함). */
internal val DayType.tagoDailyType: String
    get() =
        when (this) {
            DayType.WEEKDAY -> "01"
            DayType.SATURDAY -> "02"
            DayType.HOLIDAY -> "03"
        }

private const val HOUR = 3600

/**
 * 배차를 재는 출발 시각 창(서비스일 초, 양끝 포함, 00~02시는 24~26시). 낮은 P2b 이래의 평시 창(10:00~16:00)을 그대로 써서
 * 기존 평일 낮 결과가 바뀌지 않게 한다. 밤은 24시까지만 잰다(막차 무렵의 성긴 배차는 막차 안내 작업의 범위).
 */
internal val TimeBand.window: IntRange
    get() =
        when (this) {
            TimeBand.MORNING -> 7 * HOUR..10 * HOUR
            TimeBand.DAY -> 10 * HOUR..16 * HOUR
            TimeBand.EVENING -> 17 * HOUR..21 * HOUR
            TimeBand.NIGHT -> 21 * HOUR..24 * HOUR
        }

/** "HH:MM:SS–HH:MM:SS" 표기(보고서·headways.json용). */
internal fun windowText(window: IntRange): String {
    fun clock(seconds: Int) =
        "%02d:%02d:%02d".format(java.util.Locale.ROOT, seconds / HOUR, seconds % HOUR / 60, seconds % 60)
    return "${clock(window.first)}–${clock(window.last)}"
}
