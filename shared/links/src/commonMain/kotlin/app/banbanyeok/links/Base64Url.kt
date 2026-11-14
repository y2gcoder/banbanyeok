package app.banbanyeok.links

private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

/** base64url(RFC 4648 §5) 중 패딩 `=` 없는 정규형만 다룬다. 표준 알파벳(`+`, `/`)과 패딩은 받지 않는다. */
internal object Base64Url {
    fun encode(bytes: ByteArray): String =
        buildString((bytes.size * 4 + 2) / 3) {
            var acc = 0
            var bits = 0
            for (byte in bytes) {
                acc = (acc shl 8) or (byte.toInt() and 0xFF)
                bits += 8
                while (bits >= 6) {
                    bits -= 6
                    append(ALPHABET[(acc shr bits) and 63])
                }
                acc = acc and ((1 shl bits) - 1)
            }
            if (bits > 0) append(ALPHABET[(acc shl (6 - bits)) and 63])
        }

    /** 정규형이 아니면 null: 알파벳 밖 글자, 길이 % 4 == 1, 남는 비트가 0이 아님. */
    fun decodeCanonical(text: String): ByteArray? {
        if (text.length % 4 == 1) return null
        val out = ArrayList<Byte>(text.length * 3 / 4)
        var acc = 0
        var bits = 0
        for (ch in text) {
            val value = ALPHABET.indexOf(ch)
            if (value < 0) return null
            acc = (acc shl 6) or value
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.add(((acc shr bits) and 0xFF).toByte())
                acc = acc and ((1 shl bits) - 1)
            }
        }
        if (acc != 0) return null
        return out.toByteArray()
    }
}
