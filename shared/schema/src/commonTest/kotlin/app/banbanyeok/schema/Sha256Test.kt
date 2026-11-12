package app.banbanyeok.schema

import kotlin.test.Test
import kotlin.test.assertEquals

class Sha256Test {
    @Test
    fun matchesFipsVectors() {
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", Sha256.hex(ByteArray(0)))
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", Sha256.hex("abc".encodeToByteArray()))
        assertEquals(
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
            Sha256.hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".encodeToByteArray()),
        )
    }

    @Test
    fun paddingBoundaries() {
        // 55/56/64바이트는 패딩이 블록 경계를 넘는 대표 길이다. 기대값은 python3 hashlib 결과.
        val expected = mapOf(
            55 to "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
            56 to "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
            64 to "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
        )
        for ((length, hash) in expected) {
            assertEquals(hash, Sha256.hex(ByteArray(length) { 'a'.code.toByte() }), "길이 $length")
        }
    }

    @Test
    fun millionAs() {
        assertEquals(
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
            Sha256.hex(ByteArray(1_000_000) { 'a'.code.toByte() }),
        )
    }
}
