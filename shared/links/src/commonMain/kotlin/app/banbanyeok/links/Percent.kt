package app.banbanyeok.links

private const val HEX_DIGITS = "0123456789ABCDEF"

/** RFC 3986 퍼센트 인코딩·디코딩. `+`는 공백으로 바꾸지 않는다(쿼리 폼 인코딩이 아니다). */
internal object Percent {
    /** unreserved(`A-Za-z0-9-._~`)만 그대로 두고 나머지는 UTF-8 바이트별 `%XX`(대문자)로 쓴다. */
    fun encode(text: String): String =
        buildString {
            for (byte in text.encodeToByteArray()) {
                val value = byte.toInt() and 0xFF
                val ch = value.toChar()
                if (value < 0x80 && (ch.isAsciiLetterOrDigit() || ch in "-._~")) {
                    append(ch)
                } else {
                    append('%').append(HEX_DIGITS[value shr 4]).append(HEX_DIGITS[value and 0xF])
                }
            }
        }

    /**
     * 퍼센트 이스케이프를 해석한다. 이스케이프가 잘못됐거나(`%ZZ`, 끝의 `%`) 이어진 이스케이프가
     * 올바른 UTF-8이 아니면 null. 이스케이프가 아닌 글자는 그대로 둔다.
     */
    fun decode(raw: String): String? {
        if ('%' !in raw) return raw
        val out = StringBuilder(raw.length)
        val run = ArrayList<Byte>()
        var i = 0
        while (i < raw.length) {
            val ch = raw[i]
            if (ch == '%') {
                if (i + 2 > raw.lastIndex) return null
                val hi = hexValue(raw[i + 1])
                val lo = hexValue(raw[i + 2])
                if (hi < 0 || lo < 0) return null
                run.add(((hi shl 4) or lo).toByte())
                i += 3
            } else {
                if (!flush(run, out)) return null
                out.append(ch)
                i++
            }
        }
        return if (flush(run, out)) out.toString() else null
    }

    private fun flush(
        run: MutableList<Byte>,
        out: StringBuilder,
    ): Boolean {
        if (run.isEmpty()) return true
        val text =
            try {
                run.toByteArray().decodeToString(throwOnInvalidSequence = true)
            } catch (_: CharacterCodingException) {
                return false
            }
        run.clear()
        out.append(text)
        return true
    }

    private fun hexValue(ch: Char): Int =
        when (ch) {
            in '0'..'9' -> ch - '0'
            in 'a'..'f' -> ch - 'a' + 10
            in 'A'..'F' -> ch - 'A' + 10
            else -> -1
        }

    private fun Char.isAsciiLetterOrDigit(): Boolean = this in 'a'..'z' || this in 'A'..'Z' || this in '0'..'9'
}
