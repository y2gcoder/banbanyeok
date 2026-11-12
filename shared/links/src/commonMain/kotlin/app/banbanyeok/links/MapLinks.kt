package app.banbanyeok.links

import kotlin.math.abs
import kotlin.math.floor

/**
 * 지도 앱에 넘길 장소. [name]은 지도 앱에 표시될 이름이며 그대로 쓴다(예: "합정역").
 * 좌표는 십진 도(WGS84)다.
 */
public data class MapPlace(val name: String, val latitude: Double, val longitude: Double) {
    init {
        require(name.isNotBlank()) { "장소 이름이 비어 있습니다" }
        require(latitude.isFinite() && latitude in -90.0..90.0) { "위도가 올바르지 않습니다: $latitude" }
        require(longitude.isFinite() && longitude in -180.0..180.0) { "경도가 올바르지 않습니다: $longitude" }
    }
}

/**
 * 지도 앱 하나에 대한 링크 묶음.
 *
 * @property webUrl 기본으로 쓰는 웹 링크(https). 앱이 설치돼 있으면 모바일 브라우저가 앱으로 넘기는 경우가 많다.
 * @property appUrl 보조 앱 스킴. 앱이 없으면 열리지 않으므로 호출하는 쪽이 [webUrl]로 되돌아가야 한다.
 */
public data class MapLinks(val webUrl: String, val appUrl: String)

/**
 * 카카오맵 대중교통 길찾기 링크.
 *
 * - 웹: `https://map.kakao.com/link/by/traffic/{이름},{위도},{경도}/{이름},{위도},{경도}` — 공식 문서(Kakao 지도 Web API 가이드
 *   "길찾기 바로가기")가 정의한 형식이다. 이동수단 `traffic` = 대중교통.
 * - 앱: `kakaomap://route?sp={위도},{경도}&ep={위도},{경도}&by=PUBLICTRANSIT` — **공식 문서를 확인하지 못했다**(미확인).
 *   앱을 열지 못할 수 있으니 웹 링크가 기본이다. 근거와 확인일은 docs/setup/p6-notes.md.
 */
public object KakaoMapLinks {
    public fun transitDirections(from: MapPlace, to: MapPlace): MapLinks = MapLinks(
        webUrl = "https://map.kakao.com/link/by/traffic/${segment(from)}/${segment(to)}",
        appUrl = "kakaomap://route?sp=${coordinates(from)}&ep=${coordinates(to)}&by=PUBLICTRANSIT",
    )

    private fun segment(place: MapPlace): String = "${Percent.encode(place.name)},${coordinates(place)}"

    private fun coordinates(place: MapPlace): String =
        "${Coordinate.format(place.latitude)},${Coordinate.format(place.longitude)}"
}

/**
 * 네이버지도 대중교통 길찾기 링크.
 *
 * - 앱: `nmap://route/public?slat=&slng=&sname=&dlat=&dlng=&dname=&appname=` — 공식 문서(네이버 클라우드 플랫폼 Maps
 *   "지도 앱 연결/URL Scheme")가 정의한 형식이다. `appname`은 필수이며 안드로이드는 applicationId, iOS는 번들 ID,
 *   모바일 웹은 페이지 URL을 넣는다.
 * - 웹: 길찾기용 웹 URL은 공식 문서에 **없다**. 그래서 도착지 장소 검색 페이지(`https://map.naver.com/p/search/{이름}`,
 *   비공식)를 웹 링크로 쓴다. 사용자는 거기서 "도착"을 눌러 길찾기를 시작한다. 근거와 확인일은 docs/setup/p6-notes.md.
 */
public object NaverMapLinks {
    public fun transitDirections(from: MapPlace, to: MapPlace, appName: String): MapLinks {
        require(appName.isNotBlank()) { "appName이 비어 있습니다" }
        return MapLinks(
            webUrl = "https://map.naver.com/p/search/${Percent.encode(to.name)}",
            appUrl = "nmap://route/public" +
                "?slat=${Coordinate.format(from.latitude)}&slng=${Coordinate.format(from.longitude)}&sname=${Percent.encode(from.name)}" +
                "&dlat=${Coordinate.format(to.latitude)}&dlng=${Coordinate.format(to.longitude)}&dname=${Percent.encode(to.name)}" +
                "&appname=${Percent.encode(appName)}",
        )
    }
}

/** 좌표를 소수 6자리로 고정해 쓴다(플랫폼별 `Double.toString` 차이와 지수 표기를 피한다). 반올림은 0.5 올림. */
internal object Coordinate {
    private const val SCALE = 1_000_000L

    fun format(value: Double): String {
        val scaled = floor(abs(value) * SCALE + 0.5).toLong()
        val sign = if (value < 0 && scaled != 0L) "-" else ""
        val fraction = (scaled % SCALE).toString().padStart(6, '0')
        return "$sign${scaled / SCALE}.$fraction"
    }
}
