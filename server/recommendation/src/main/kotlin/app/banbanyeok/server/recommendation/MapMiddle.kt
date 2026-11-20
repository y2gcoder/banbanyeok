package app.banbanyeok.server.recommendation

import app.banbanyeok.applogic.DisplayMinutes
import kotlin.math.abs
import kotlin.math.cos

/** 위도·경도(도). */
public data class GeoPoint(
    public val lat: Double,
    public val lng: Double,
)

/** 역 코드의 좌표(레지스트리). 좌표를 모르는 역이면 null. */
public fun interface StationLocations {
    public fun locate(code: String): GeoPoint?
}

/**
 * "지도 한가운데" 역(#68): 출발역 좌표의 평균점에서 가장 가까운, **모두가 갈 수 있는** 만날 역. 공평 순위와 별개로 표시만 더하는 값이다.
 * [times]는 요청 참가자 순서이고 [Recommendation]의 후보 시간과 같은 방식(같은 데이터 버전·같은 구분의 od)으로 꺼낸 값이다.
 */
public data class MapMiddle(
    public val stationCode: String,
    public val stationName: String,
    public val times: List<ParticipantTime>,
)

internal object MapMiddleRule {
    /**
     * 지도 한가운데 역의 가장 오래 걸리는 시간이 추천 역보다 이만큼(표시 분) 이상 길 때만 보인다. 그보다 작으면 "지도 한가운데도
     * 괜찮다"는 뜻이라 비교가 의미 없다. 화면에 보이는 최장(사람별 반올림 분의 최댓값)끼리 뺀 값이라 표의 숫자와 맞는다.
     */
    const val MIN_EXTRA_MINUTES = 5

    /** 같은 거리로 보는 오차(도²). 좌표는 소수 6자리(약 0.1m)다. */
    private const val TIE_EPSILON = 1e-12

    private const val DEGREES_TO_RADIANS = Math.PI / 180

    /**
     * 후보 중 [reachable]인 역에서 [origins]의 산술 평균점에 가장 가까운 곳의 인덱스. 없으면 null.
     * 경도 차이는 cos(평균 위도)로 눌러 거리를 잰다(수도권 범위라 평면 근사로 충분하다). 같은 거리면 역 코드가 앞선 쪽.
     * 같은 출발역에서 둘이 나오면 두 번 센다.
     */
    fun nearest(
        origins: List<GeoPoint>,
        candidates: List<String>,
        locations: StationLocations,
        reachable: (Int) -> Boolean,
    ): Int? {
        if (origins.isEmpty()) return null
        val lat = origins.sumOf { it.lat } / origins.size
        val lng = origins.sumOf { it.lng } / origins.size
        val squeeze = cos(lat * DEGREES_TO_RADIANS)
        return candidates.indices
            .filter(reachable)
            .mapNotNull { index ->
                locations.locate(candidates[index])?.let {
                    val dLat = it.lat - lat
                    val dLng = (it.lng - lng) * squeeze
                    Scored(index, candidates[index], dLat * dLat + dLng * dLng)
                }
            }.reduceOrNull { best, next -> if (next.isCloserThan(best)) next else best }
            ?.index
    }

    private class Scored(
        val index: Int,
        val code: String,
        val distance: Double,
    ) {
        /** 더 가깝거나, 같은 거리(오차 안)이면 역 코드가 앞선다. */
        fun isCloserThan(other: Scored): Boolean =
            distance < other.distance - TIE_EPSILON ||
                (abs(distance - other.distance) <= TIE_EPSILON && code < other.code)
    }

    /** 화면에 보이는 최장(분)끼리의 차이. 공평 기준에서는 추천 역의 최장이 모든 후보 중 가장 작으므로 음수가 되지 않는다. */
    fun extraMinutes(
        middleSeconds: List<Int>,
        topMaxSeconds: Int,
    ): Int = DisplayMinutes.fromSeconds(middleSeconds.max()) - DisplayMinutes.fromSeconds(topMaxSeconds)
}
