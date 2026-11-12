package app.banbanyeok.applogic

/**
 * 화면에 보이는 분 값의 규칙. 서버·웹·앱이 같은 규칙을 써야 같은 숫자가 보인다.
 *
 * - **반올림**: 초를 분으로 바꿀 때 0.5분(30초)은 올림이다. `분 = (초 + 30) / 60`(정수 나눗셈). 29초 → 0분, 30초 → 1분.
 * - 사람별 시간만 초에서 반올림하고, **합계·차이·최장 같은 파생 값은 반올림한 사람별 분으로 다시 계산한다.**
 *   그래서 화면에 보이는 숫자끼리 더하고 빼면 항상 맞는다(초에서 따로 반올림하면 1분씩 어긋날 수 있다).
 * - 순위는 반올림하지 않은 초로 정하고, 표시만 반올림한다.
 * - 60분 이상은 "1시간 4분", 정확히 60의 배수면 "2시간"으로 쓴다.
 */
public object DisplayMinutes {
    private const val SECONDS_PER_MINUTE = 60
    private const val HALF_MINUTE = 30
    private const val MINUTES_PER_HOUR = 60

    /** 초 → 분(30초는 올림). 음수는 허용하지 않는다. */
    public fun fromSeconds(seconds: Int): Int {
        require(seconds >= 0) { "초는 0 이상이어야 합니다: $seconds" }
        return ((seconds.toLong() + HALF_MINUTE) / SECONDS_PER_MINUTE).toInt()
    }

    /** 분 값을 "38분", "1시간", "1시간 4분"으로 쓴다. */
    public fun format(minutes: Int): String {
        require(minutes >= 0) { "분은 0 이상이어야 합니다: $minutes" }
        val hours = minutes / MINUTES_PER_HOUR
        val rest = minutes % MINUTES_PER_HOUR
        return when {
            hours == 0 -> "${rest}분"
            rest == 0 -> "${hours}시간"
            else -> "${hours}시간 ${rest}분"
        }
    }

    public fun formatSeconds(seconds: Int): String = format(fromSeconds(seconds))

    /** 환승 횟수 표기: 0 → "환승 없음", n → "환승 n번". */
    public fun transferLabel(transfers: Int): String {
        require(transfers >= 0) { "환승은 0 이상이어야 합니다: $transfers" }
        return if (transfers == 0) "환승 없음" else "환승 ${transfers}번"
    }
}
