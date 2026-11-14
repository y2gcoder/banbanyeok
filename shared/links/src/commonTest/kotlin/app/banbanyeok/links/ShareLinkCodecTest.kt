package app.banbanyeok.links

import app.banbanyeok.schema.StationCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ShareLinkCodecTest {
    private val a = StationCode.parse("03v")
    private val b = StationCode.parse("130")

    @Test
    fun encodesCanonicalOrderAndDotSeparators() {
        val link = ShareLink(listOf(a, b), LinkMode.Fair, listOf("민수", "지연"))
        assertEquals("v=1&o=03v.130&m=f&n=66-87IiY.7KeA7Jew", ShareLinkCodec.encodeQuery(link))
        assertEquals("/s?v=1&o=03v.130&m=f&n=66-87IiY.7KeA7Jew", ShareLinkCodec.encodePath(link))
        assertEquals(
            "https://banbanyeok.example/s?v=1&o=03v.130&m=q",
            ShareLinkCodec.encodeUrl("https://banbanyeok.example/", ShareLink(listOf(a, b), LinkMode.Fast)),
        )
    }

    @Test
    fun encodedQueryUsesOnlyUnreservedCharacters() {
        val link = ShareLink(listOf(a, b), LinkMode.Fair, listOf("??>>", "ÿÿ"))
        val query = ShareLinkCodec.encodeQuery(link)
        assertTrue(query.all { (it.isLetterOrDigit() && it.code < 128) || it in "-_.=&" }, query)
        assertTrue('|' !in query)
    }

    @Test
    fun allEmptyNicknamesAreOmitted() {
        assertEquals(
            "v=1&o=03v.130&m=f",
            ShareLinkCodec.encodeQuery(ShareLink(listOf(a, b), LinkMode.Fair, listOf(null, ""))),
        )
    }

    @Test
    fun decodeUrlExtractsQueryBeforeFragment() {
        val result = ShareLinkCodec.decodeUrl("https://banbanyeok.example/s?utm_source=kakao&v=1&o=03v.130&m=p1#top")
        assertEquals(ShareLink(listOf(a, b), LinkMode.Favor(1)), result.getOrNull())
        assertEquals(
            LinkDecoding.Failure(LinkErrorCode.MISSING_PARAM),
            ShareLinkCodec.decodeUrl("https://banbanyeok.example/s"),
        )
    }

    @Test
    fun errorsAreReportedInTheDocumentedOrder() {
        // v가 틀리고 o도 틀리면 v가 먼저
        assertEquals(
            LinkDecoding.Failure(LinkErrorCode.UNSUPPORTED_VERSION),
            ShareLinkCodec.decodeQuery("v=2&o=zz&m=z"),
        )
        // o가 틀리고 m도 틀리면 o가 먼저
        assertEquals(LinkDecoding.Failure(LinkErrorCode.BAD_ORIGIN_COUNT), ShareLinkCodec.decodeQuery("v=1&o=03v&m=z"))
        // m이 틀리고 n도 틀리면 m이 먼저
        assertEquals(LinkDecoding.Failure(LinkErrorCode.BAD_MODE), ShareLinkCodec.decodeQuery("v=1&o=03v.130&m=z&n=!"))
        // 필수 키가 없으면 퍼센트 오류보다 뒤. 퍼센트 오류는 키를 읽는 중에 먼저 난다
        assertEquals(LinkDecoding.Failure(LinkErrorCode.MALFORMED_QUERY), ShareLinkCodec.decodeQuery("v=1&m=%"))
    }

    @Test
    fun plusIsNotDecodedAsSpace() {
        assertEquals(
            LinkDecoding.Failure(LinkErrorCode.BAD_NICKNAMES),
            ShareLinkCodec.decodeQuery("v=1&o=03v.130&m=f&n=+/+/.7KeA"),
        )
    }

    @Test
    fun emptyQueryIsMissingParam() {
        assertEquals(LinkDecoding.Failure(LinkErrorCode.MISSING_PARAM), ShareLinkCodec.decodeQuery(""))
    }

    @Test
    fun shareLinkRejectsInvalidState() {
        assertFailsWith<IllegalArgumentException> { ShareLink(listOf(a), LinkMode.Fair) }
        assertFailsWith<IllegalArgumentException> { ShareLink(listOf(a, a, a, a, a), LinkMode.Fair) }
        assertFailsWith<IllegalArgumentException> { ShareLink(listOf(a, b), LinkMode.Favor(2)) }
        assertFailsWith<IllegalArgumentException> { ShareLink(listOf(a, b), LinkMode.Fair, listOf("x")) }
        assertFailsWith<IllegalArgumentException> {
            ShareLink(
                listOf(a, b),
                LinkMode.Fair,
                listOf("a".repeat(21), null),
            )
        }
        assertFailsWith<IllegalArgumentException> { ShareLink(listOf(a, b), LinkMode.Fair, listOf("\uD83D", null)) }
        ShareLink(listOf(a, b), LinkMode.Fair, listOf("🙂".repeat(20), null)) // 코드포인트 20자는 통과
    }

    @Test
    fun nicknameRulesCountCodePoints() {
        assertEquals(1, NicknameRules.codePointCount("🙂"))
        assertEquals(2, NicknameRules.codePointCount("민수"))
        assertEquals(0, NicknameRules.codePointCount(""))
        assertEquals(2, NicknameRules.codePointCount("\uD83D" + "x")) // 짝 없는 서로게이트는 각각 1
        assertTrue(NicknameRules.isWellFormed("가🙂"))
        assertTrue(!NicknameRules.isWellFormed("\uDE42"))
    }

    @Test
    fun base64UrlHandlesAllResidueLengths() {
        for (size in 0..8) {
            val bytes = ByteArray(size) { (it * 37 + 200).toByte() }
            val text = Base64Url.encode(bytes)
            assertTrue('=' !in text)
            assertEquals(bytes.toList(), Base64Url.decodeCanonical(text)?.toList(), "size=$size")
        }
        assertNull(Base64Url.decodeCanonical("7KeA=="))
        assertNull(Base64Url.decodeCanonical("A")) // 길이 % 4 == 1
        assertNull(Base64Url.decodeCanonical("7Ke")) // 남는 비트가 0이 아님
    }

    @Test
    fun percentDecodingFollowsRfc3986() {
        assertEquals("a.b", Percent.decode("a%2Eb"))
        assertEquals("a+b", Percent.decode("a+b"))
        assertEquals("한", Percent.decode("%ED%95%9C"))
        assertEquals("한x", Percent.decode("한x"))
        assertNull(Percent.decode("%"))
        assertNull(Percent.decode("%4"))
        assertNull(Percent.decode("%ZZ"))
        assertNull(Percent.decode("%FF"))
        assertEquals("%ED%95%9C", Percent.encode("한"))
        assertEquals("a-b_c.d~", Percent.encode("a-b_c.d~"))
        assertEquals("%2C%20", Percent.encode(", "))
    }
}
