package app.banbanyeok.links

/**
 * 별칭 규칙. 길이는 UTF-16 단위가 아니라 **유니코드 코드포인트** 수로 센다(이모지 하나 = 1).
 * shared:app-logic 등 다른 모듈도 이 규칙을 그대로 쓴다.
 */
public object NicknameRules {
    public const val MAX_CODE_POINTS: Int = 20

    /** 코드포인트 수. 짝이 맞는 서로게이트 쌍은 1로, 짝 없는 서로게이트는 각각 1로 센다. */
    public fun codePointCount(text: String): Int {
        var count = 0
        var i = 0
        while (i < text.length) {
            if (text[i].isHighSurrogate() && i + 1 < text.length && text[i + 1].isLowSurrogate()) i++
            i++
            count++
        }
        return count
    }

    /** 짝 없는 서로게이트가 없다(= UTF-8로 손실 없이 인코딩된다). */
    public fun isWellFormed(text: String): Boolean {
        var i = 0
        while (i < text.length) {
            val ch = text[i]
            if (ch.isHighSurrogate()) {
                if (i + 1 >= text.length || !text[i + 1].isLowSurrogate()) return false
                i++
            } else if (ch.isLowSurrogate()) {
                return false
            }
            i++
        }
        return true
    }
}
