package app.banbanyeok.links

import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.TimeSlot

/**
 * 공유 URL `/s` 코덱. 웹(TypeScript)·앱이 각자 구현하는 같은 규칙의 Kotlin 구현이다.
 * 규칙: contracts/data-format.md §7, 테스트 벡터: contracts/golden/link-vectors.json.
 *
 * 정규형 쿼리는 `v=2&o=03v.130&m=f&t=weekday-day&n=<별칭>` 순서이며 `A-Za-z0-9-_.=&`만 쓰므로 퍼센트 인코딩이 필요 없다.
 * 별칭은 UTF-8 → base64url(패딩 없음)이고 `.`으로 잇는다. `t`는 구분 id(contracts/time-slots.json)다.
 * 구분이 생기기 전의 링크(`v=1`)는 계속 읽으며 평일 낮([TimeSlot.DEFAULT])으로 본다.
 */
public object ShareLinkCodec {
    public const val PATH: String = "/s"
    public const val VERSION: String = "2"

    /** `t`가 없던 옛 링크의 버전. */
    public const val LEGACY_VERSION: String = "1"

    private const val ORIGIN_SEPARATOR = '.'
    private const val NICKNAME_SEPARATOR = '.'
    private val KNOWN_KEYS = setOf("v", "o", "m", "n")
    private const val SLOT_KEY = "t"

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
            append("&t=").append(link.timeSlot.id)
            val nicknames = link.nicknames
            if (nicknames != null && nicknames.any { !it.isNullOrEmpty() }) {
                append("&n=").append(
                    nicknames.joinToString(
                        NICKNAME_SEPARATOR.toString(),
                    ) { Base64Url.encode(it.orEmpty().encodeToByteArray()) },
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
        val rawSlots = mutableListOf<String>()
        parseValues(query, values, rawSlots)?.let { return fail(it) }
        val version = values["v"]
        val originsText = values["o"]
        val modeText = values["m"]
        // v=1에는 t가 없다: 있어도 알 수 없는 키처럼 **읽지 않고**(중복·깨진 인코딩도 오류가 아니다) 평일 낮으로 읽는다.
        val slot = if (version == LEGACY_VERSION) SlotRead(TimeSlot.DEFAULT.id) else readSlot(rawSlots)
        return when {
            version == null || originsText == null || modeText == null -> fail(LinkErrorCode.MISSING_PARAM)
            version != VERSION && version != LEGACY_VERSION -> fail(LinkErrorCode.UNSUPPORTED_VERSION)
            slot.text == null -> fail(slot.error ?: LinkErrorCode.MISSING_PARAM)
            else -> decodeContent(originsText, modeText, slot.text, values["n"])
        }
    }

    private class SlotRead(
        val text: String?,
        val error: LinkErrorCode? = null,
    )

    /** v=2의 `t`: 꼭 하나, 퍼센트 디코딩. */
    private fun readSlot(raw: List<String>): SlotRead =
        when (raw.size) {
            0 -> SlotRead(null, LinkErrorCode.MISSING_PARAM)
            1 -> Percent.decode(raw.single())?.let { SlotRead(it) } ?: SlotRead(null, LinkErrorCode.MALFORMED_QUERY)
            else -> SlotRead(null, LinkErrorCode.DUPLICATE_PARAM)
        }

    private fun decodeContent(
        originsText: String,
        modeText: String,
        slotText: String,
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
        val slot = TimeSlot.parseOrNull(slotText) ?: return fail(LinkErrorCode.BAD_TIME_SLOT)

        return decodeWithNicknames(origins, mode, slot, nicknameText)
    }

    private fun decodeWithNicknames(
        origins: List<StationCode>,
        mode: LinkMode,
        slot: TimeSlot,
        nicknameText: String?,
    ): LinkDecoding {
        val nicknames =
            if (nicknameText == null) {
                null
            } else {
                decodeNicknames(nicknameText, origins.size) ?: return fail(LinkErrorCode.BAD_NICKNAMES)
            }
        return LinkDecoding.Success(ShareLink(origins, mode, nicknames, slot))
    }

    private fun parseValues(
        query: String,
        values: MutableMap<String, String>,
        rawSlots: MutableList<String>,
    ): LinkErrorCode? {
        if (query.isNotEmpty()) {
            for (pair in query.split('&')) {
                val separator = pair.indexOf('=')
                val key = if (separator < 0) pair else pair.substring(0, separator)
                val raw = if (separator < 0) "" else pair.substring(separator + 1)
                when {
                    // t는 버전을 안 뒤에 읽는다(v=1이면 읽지 않는다).
                    key == SLOT_KEY -> rawSlots.add(raw)

                    key !in KNOWN_KEYS -> Unit

                    key in values -> return LinkErrorCode.DUPLICATE_PARAM

                    else -> values[key] = Percent.decode(raw) ?: return LinkErrorCode.MALFORMED_QUERY
                }
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
