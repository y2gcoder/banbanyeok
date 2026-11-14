package app.banbanyeok.links

import app.banbanyeok.schema.StationCode

/** 추천 기준. 링크에서는 `m=f` / `m=q` / `m=p<i>`. */
public sealed interface LinkMode {
    /** 공평(`f`). */
    public data object Fair : LinkMode

    /** 빨리(`q`). */
    public data object Fast : LinkMode

    /** 배려(`p<index>`). [index]는 `origins` 안의 0부터 시작하는 위치(0..3). */
    public data class Favor(
        val index: Int,
    ) : LinkMode
}

/**
 * `/s` 링크가 담는 상태. 생성 시 규칙을 검증하며 어기면 [IllegalArgumentException]이다
 * (디코더는 먼저 [LinkErrorCode]로 걸러 내므로 디코딩 결과는 항상 유효하다).
 *
 * @property origins 출발역 2~4개(입력 순서 = A, B, C, D). 같은 역이 반복돼도 된다.
 * @property nicknames 별칭. null이면 별칭 없음. 있으면 길이가 [origins]와 같고, 별칭 없는 사람은 null(또는 빈 문자열).
 */
public data class ShareLink(
    val origins: List<StationCode>,
    val mode: LinkMode,
    val nicknames: List<String?>? = null,
) {
    init {
        require(origins.size in MIN_ORIGINS..MAX_ORIGINS) { "출발역은 $MIN_ORIGINS~${MAX_ORIGINS}개여야 합니다: ${origins.size}" }
        if (mode is LinkMode.Favor) {
            require(mode.index in origins.indices) { "배려 대상 위치가 범위 밖입니다: ${mode.index}" }
        }
        if (nicknames != null) {
            require(nicknames.size == origins.size) { "별칭 개수가 출발역 개수와 다릅니다" }
            for (name in nicknames) {
                if (name == null) continue
                require(NicknameRules.isWellFormed(name)) { "별칭에 짝 없는 서로게이트가 있습니다" }
                require(NicknameRules.codePointCount(name) <= NicknameRules.MAX_CODE_POINTS) {
                    "별칭은 코드포인트 ${NicknameRules.MAX_CODE_POINTS}자 이하여야 합니다"
                }
            }
        }
    }

    public companion object {
        public const val MIN_ORIGINS: Int = 2
        public const val MAX_ORIGINS: Int = 4
    }
}

/** 디코더가 보고하는 오류 코드. 이름은 contracts/data-format.md §7과 같다. 검사 순서는 `v`→`o`→`m`→`n`. */
public enum class LinkErrorCode {
    MALFORMED_QUERY,
    MISSING_PARAM,
    DUPLICATE_PARAM,
    UNSUPPORTED_VERSION,
    BAD_ORIGIN_COUNT,
    BAD_STATION_CODE,
    BAD_MODE,
    FAVOR_INDEX_OUT_OF_RANGE,
    BAD_NICKNAMES,
}

/** [ShareLinkCodec.decodeQuery]의 결과. 오류는 하나만 보고한다. */
public sealed interface LinkDecoding {
    public data class Success(
        val link: ShareLink,
    ) : LinkDecoding

    public data class Failure(
        val code: LinkErrorCode,
    ) : LinkDecoding

    public fun getOrNull(): ShareLink? = (this as? Success)?.link
}
