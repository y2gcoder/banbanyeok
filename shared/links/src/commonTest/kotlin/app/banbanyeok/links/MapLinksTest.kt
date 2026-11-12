package app.banbanyeok.links

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class MapLinksTest {
    private val from = MapPlace("합정역", 37.549463, 126.914)
    private val to = MapPlace("신촌역", 37.555134, 126.936893)

    @Test
    fun kakaoWebLinkFollowsOfficialTrafficPattern() {
        val links = KakaoMapLinks.transitDirections(from, to)
        assertEquals(
            "https://map.kakao.com/link/by/traffic/%ED%95%A9%EC%A0%95%EC%97%AD,37.549463,126.914000/" +
                "%EC%8B%A0%EC%B4%8C%EC%97%AD,37.555134,126.936893",
            links.webUrl,
        )
        assertEquals("kakaomap://route?sp=37.549463,126.914000&ep=37.555134,126.936893&by=PUBLICTRANSIT", links.appUrl)
    }

    @Test
    fun naverAppLinkFollowsOfficialRoutePublicPattern() {
        val links = NaverMapLinks.transitDirections(from, to, "app.banbanyeok")
        assertEquals(
            "nmap://route/public?slat=37.549463&slng=126.914000&sname=%ED%95%A9%EC%A0%95%EC%97%AD" +
                "&dlat=37.555134&dlng=126.936893&dname=%EC%8B%A0%EC%B4%8C%EC%97%AD&appname=app.banbanyeok",
            links.appUrl,
        )
        assertEquals("https://map.naver.com/p/search/%EC%8B%A0%EC%B4%8C%EC%97%AD", links.webUrl)
    }

    @Test
    fun nameWithCommaOrSlashCannotBreakThePath() {
        val place = MapPlace("A,B/C 역", 37.0, 127.0)
        val web = KakaoMapLinks.transitDirections(place, to).webUrl
        assertEquals("https://map.kakao.com/link/by/traffic/A%2CB%2FC%20%EC%97%AD,37.000000,127.000000/", web.substringBefore("%EC%8B%A0"))
    }

    @Test
    fun coordinatesAreFixedSixDecimals() {
        assertEquals("37.500000", Coordinate.format(37.5))
        assertEquals("0.000001", Coordinate.format(0.000001))
        assertEquals("-0.500000", Coordinate.format(-0.5))
        assertEquals("0.000000", Coordinate.format(-0.0000001))
        assertEquals("127.000000", Coordinate.format(127.0))
        assertEquals("127.000001", Coordinate.format(127.0000005))
    }

    @Test
    fun invalidInputIsRejected() {
        assertFailsWith<IllegalArgumentException> { MapPlace("", 37.0, 127.0) }
        assertFailsWith<IllegalArgumentException> { MapPlace("x", 91.0, 127.0) }
        assertFailsWith<IllegalArgumentException> { MapPlace("x", 37.0, Double.NaN) }
        assertFailsWith<IllegalArgumentException> { NaverMapLinks.transitDirections(from, to, " ") }
    }
}
