package app.banbanyeok.applogic

internal enum class Josa(val withFinal: String, val withoutFinal: String) {
    EUN_NEUN("은", "는"),
    I_GA("이", "가"),
    WA_GWA("과", "와"),
}

/**
 * 한국어 조사 선택. 마지막으로 **읽히는** 글자(한글 음절, 영문, 숫자)의 받침으로 정한다.
 * 끝의 기호·이모지(`🎂`, `)`)는 건너뛴다. 읽을 글자가 하나도 없으면 받침 없음으로 본다.
 */
internal object Korean {
    private const val HANGUL_BASE = 0xAC00
    private const val HANGUL_LAST = 0xD7A3
    private const val JONGSEONG_COUNT = 28

    // 영문 글자 이름(엘·엠·엔·알)과 숫자 이름(영·일·삼·육·칠·팔)이 받침으로 끝난다.
    private const val LATIN_WITH_FINAL = "LMNR"
    private const val DIGITS_WITH_FINAL = "013678"

    fun attach(word: String, josa: Josa): String = word + if (hasFinalConsonant(word)) josa.withFinal else josa.withoutFinal

    fun hasFinalConsonant(word: String): Boolean {
        for (index in word.indices.reversed()) {
            val ch = word[index]
            val code = ch.code
            when {
                code in HANGUL_BASE..HANGUL_LAST -> return (code - HANGUL_BASE) % JONGSEONG_COUNT != 0
                ch in 'a'..'z' || ch in 'A'..'Z' -> return ch.uppercaseChar() in LATIN_WITH_FINAL
                ch in '0'..'9' -> return ch in DIGITS_WITH_FINAL
            }
        }
        return false
    }
}
