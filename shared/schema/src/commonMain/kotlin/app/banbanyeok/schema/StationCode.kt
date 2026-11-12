package app.banbanyeok.schema

import kotlin.jvm.JvmInline

/**
 * 역 코드: 소문자·숫자 base32(i, l, o, u 제외) 3자. 15비트 정수(0..32767)와 일대일이다.
 * 문자열 사전순 = 값 오름차순이므로 JVM·JS 어디서든 정렬이 같다. 형식은 contracts/data-format.md §2.
 */
@JvmInline
public value class StationCode private constructor(public val value: Int) {
    /** 3자 문자열 표기. */
    override fun toString(): String = buildString(LENGTH) {
        append(ALPHABET[(value shr 10) and 31])
        append(ALPHABET[(value shr 5) and 31])
        append(ALPHABET[value and 31])
    }

    public companion object {
        public const val ALPHABET: String = "0123456789abcdefghjkmnpqrstvwxyz"
        public const val LENGTH: Int = 3
        public const val CAPACITY: Int = 32768

        public fun ofValue(value: Int): StationCode {
            schemaCheck(value in 0 until CAPACITY) { "역 코드 값은 0..${CAPACITY - 1} 이어야 합니다: $value" }
            return StationCode(value)
        }

        /** 정규형(소문자 3자)만 받는다. 아니면 [SchemaException]. */
        public fun parse(text: String): StationCode = parseOrNull(text) ?: schemaFail("올바른 역 코드가 아닙니다: '$text'")

        public fun parseOrNull(text: String): StationCode? {
            if (text.length != LENGTH) return null
            var value = 0
            for (ch in text) {
                val digit = ALPHABET.indexOf(ch)
                if (digit < 0) return null
                value = (value shl 5) or digit
            }
            return StationCode(value)
        }
    }
}
