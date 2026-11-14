package app.banbanyeok.links

import app.banbanyeok.schema.StationCode

/**
 * 공유 URL `/s` 코덱. 웹(TypeScript)·앱이 각자 구현하는 같은 규칙의 Kotlin 구현이다.
 * 규칙: contracts/data-format.md §7, 테스트 벡터: contracts/golden/link-vectors.json.
 *
 * 정규형 쿼리는 `v=1&o=03v.130&m=f&n=<별칭>` 순서이며 `A-Za-z0-9-_.=&`만 쓰므로 퍼센트 인코딩이 필요 없다.
 * 별칭은 UTF-8 → base64url(패딩 없음)이고 `.`으로 잇는다.
 */
public object ShareLinkCodec {
    public const val PATH: String = "/s"
    public const val VERSION: String = "1"

    private const val ORIGIN_SEPARATOR = '.'
    private const val NICKNAME_SEPARATOR = '.'
    private val KNOWN_KEYS = setOf("v", "o", "m", "n")

    /** 정규형 쿼리 문자열(앞의 `?` 없음). */
    public fun encodeQuery(link: ShareLink): String =
        buildString {
            append("v=").append(VERSION)
            append("&o=").append(link.origins.joinToString(ORIGIN_SEPARATOR.toString()))
            append("&m=").append(
                when (val mode = link.mode) {
                    LinkMode.Fair -> "f"
                    LinkMode.Fast -> "q"
                    is LinkMode.Favor -> "p${mode.index}"
                },
            )
            val nicknames = link.nicknames
            if (nicknames != null && nicknames.any { !it.isNullOrEmpty() }) {
                append("&n=").append(
                    nicknames.joinToString(
                        NICKNAME_SEPARATOR.toString(),
                    ) { Base64Url.encode((it ?: "").encodeToByteArray()) },
                )
            }
        }

    /** `/s?...` 형태의 경로+쿼리. */
    public fun encodePath(link: ShareLink): String = "$PATH?${encodeQuery(link)}"

    /** 사이트 주소(`https://example.com`, 끝의 `/`는 있어도 된다)에 붙인 완전한 URL. */
    public fun encodeUrl(
        siteOrigin: String,
        link: ShareLink,
    ): String = siteOrigin.trimEnd('/') + encodePath(link)

    /** URL(또는 경로)에서 `?`와 `#` 사이를 꺼내 [decodeQuery]로 해석한다. `?`가 없으면 빈 쿼리로 본다. */
    public fun decodeUrl(url: String): LinkDecoding {
        val withoutFragment = url.substringBefore('#')
        val query = if ('?' in withoutFragment) withoutFragment.substringAfter('?') else ""
        return decodeQuery(query)
    }

    /**
     * 쿼리 문자열(앞의 `?` 없음)을 해석한다. 순서 무관, 알 수 없는 키는 무시, 값은 먼저 퍼센트 디코딩한다.
     * 오류는 첫 번째 하나만 [LinkDecoding.Failure]로 돌려준다.
     */
    public fun decodeQuery(query: String): LinkDecoding {
        val values = HashMap<String, String>()
        parseValues(query, values)?.let { return fail(it) }
        val version = values["v"]
        val originsText = values["o"]
        val modeText = values["m"]
        if (version == null || originsText == null || modeText == null) return fail(LinkErrorCode.MISSING_PARAM)
        if (version != VERSION) return fail(LinkErrorCode.UNSUPPORTED_VERSION)

        return decodeContent(originsText, modeText, values["n"])
    }

    private fun decodeContent(
        originsText: String,
        modeText: String,
        nicknameText: String?,
    ): LinkDecoding {
        val originTexts = originsText.split(ORIGIN_SEPARATOR)
        if (originTexts.size !in
            ShareLink.MIN_ORIGINS..ShareLink.MAX_ORIGINS
        ) {
            return fail(LinkErrorCode.BAD_ORIGIN_COUNT)
        }
        val origins = originTexts.map { StationCode.parseOrNull(it) ?: return fail(LinkErrorCode.BAD_STATION_CODE) }

        val mode = decodeMode(modeText, origins.size) ?: return fail(modeError(modeText))

        return decodeWithNicknames(origins, mode, nicknameText)
    }

    private fun decodeWithNicknames(
        origins: List<StationCode>,
        mode: LinkMode,
        nicknameText: String?,
    ): LinkDecoding {
        val nicknames =
            if (nicknameText == null) {
                null
            } else {
                decodeNicknames(nicknameText, origins.size) ?: return fail(LinkErrorCode.BAD_NICKNAMES)
            }
        return LinkDecoding.Success(ShareLink(origins, mode, nicknames))
    }

    private fun parseValues(
        query: String,
        values: MutableMap<String, String>,
    ): LinkErrorCode? {
        if (query.isNotEmpty()) {
            for (pair in query.split('&')) {
                val separator = pair.indexOf('=')
                val key = if (separator < 0) pair else pair.substring(0, separator)
                if (key !in KNOWN_KEYS) continue
                if (key in values) return LinkErrorCode.DUPLICATE_PARAM
                val raw = if (separator < 0) "" else pair.substring(separator + 1)
                values[key] = Percent.decode(raw) ?: return LinkErrorCode.MALFORMED_QUERY
            }
        }
        return null
    }

    private fun decodeMode(
        text: String,
        originCount: Int,
    ): LinkMode? =
        when {
            text == "f" -> LinkMode.Fair
            text == "q" -> LinkMode.Fast
            isFavor(text) -> (text[1] - '0').takeIf { it < originCount }?.let { LinkMode.Favor(it) }
            else -> null
        }

    private fun modeError(text: String): LinkErrorCode =
        if (isFavor(text)) LinkErrorCode.FAVOR_INDEX_OUT_OF_RANGE else LinkErrorCode.BAD_MODE

    private fun isFavor(text: String): Boolean = text.length == 2 && text[0] == 'p' && text[1] in '0'..'3'

    /** null이면 `BAD_NICKNAMES`. 정규형은 별칭이 하나도 없으면 `n`을 생략하므로 전부 빈 세그먼트도 거부한다. */
    private fun decodeNicknames(
        text: String,
        originCount: Int,
    ): List<String?>? {
        val segments = text.split(NICKNAME_SEPARATOR)
        if (segments.size != originCount) return null
        val names =
            segments.map { segment ->
                if (segment.isEmpty()) {
                    null
                } else {
                    decodeNickname(segment) ?: return null
                }
            }
        return if (names.all { it == null }) null else names
    }

    private fun decodeNickname(segment: String): String? {
        val bytes = Base64Url.decodeCanonical(segment) ?: return null
        val name =
            try {
                bytes.decodeToString(throwOnInvalidSequence = true)
            } catch (_: CharacterCodingException) {
                return null
            }
        return name.takeIf { NicknameRules.codePointCount(it) <= NicknameRules.MAX_CODE_POINTS }
    }

    private fun fail(code: LinkErrorCode): LinkDecoding = LinkDecoding.Failure(code)
}
