package app.banbanyeok.server.room

import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldMatch
import io.kotest.matchers.string.shouldNotContain
import java.util.HexFormat
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class TokenAndIdTest :
    DescribeSpec({
        describe("ids and tokens") {
            val ids = SecureRandomIdGenerator()

            it("generates ids in the documented formats") {
                repeat(200) {
                    ids.roomId() shouldMatch Regex("^[0-9a-hjkmnp-tv-z]{10}$")
                    ids.participantId() shouldMatch Regex("^[0-9a-hjkmnp-tv-z]{6}$")
                    ids.anonUserId() shouldMatch Regex("^u_[0-9a-hjkmnp-tv-z]{26}$")
                    ids.token() shouldMatch Regex("^[A-Za-z0-9_-]{43}$")
                }
            }

            it("never repeats a token in a thousand draws") {
                List(1000) { ids.token() }.toSet().size shouldBe 1000
            }
        }

        describe("token hashing") {
            it("is deterministic per pepper and different across peppers and tokens") {
                val a = TokenService("pepper-a-pepper-a-pepper-a-0000".toByteArray(), SequentialIdGenerator())
                val b = TokenService("pepper-b-pepper-b-pepper-b-0000".toByteArray(), SequentialIdGenerator())
                a.hash("token") shouldBe a.hash("token")
                (a.hash("token") == b.hash("token")) shouldBe false
                (a.hash("token") == a.hash("token2")) shouldBe false
                a.hash("token").bytes.size shouldBe 32
            }

            it("derives a short keyed room hash that does not reveal the room id") {
                val a = TokenService("pepper-a-pepper-a-pepper-a-0000".toByteArray(), SequentialIdGenerator())
                val b = TokenService("pepper-b-pepper-b-pepper-b-0000".toByteArray(), SequentialIdGenerator())
                val roomId = "qt7yvmsht3"
                a.roomHash(roomId) shouldMatch Regex("^[0-9a-f]{16}$")
                a.roomHash(roomId) shouldBe a.roomHash(roomId)
                a.roomHash(roomId) shouldNotContain roomId
                (a.roomHash(roomId) == a.roomHash("qt7yvmsht4")) shouldBe false
                // 키(pepper)가 다르면 다른 값: 키 없이 방 ID를 대입해 맞출 수 없다.
                (a.roomHash(roomId) == b.roomHash(roomId)) shouldBe false
                // 토큰 해시와 키가 나뉜다: 같은 문자열의 토큰 해시 앞부분과 다르다.
                val tokenPrefix = HexFormat.of().formatHex(a.hash(roomId).bytes, 0, 8)
                (a.roomHash(roomId) == tokenPrefix) shouldBe false
                // 하위 키 유도 규칙 고정: HMAC(HMAC(pepper, "banbanyeok/room_hash/v1"), 방 ID)의 앞 8바이트.
                val pepper = "pepper-a-pepper-a-pepper-a-0000".toByteArray()
                val roomKey = hmac(pepper, "banbanyeok/room_hash/v1")
                a.roomHash(roomId) shouldBe HexFormat.of().formatHex(hmac(roomKey, roomId), 0, 8)
            }

            it("does not print the hash") {
                TokenService("pepper-a-pepper-a-pepper-a-0000".toByteArray(), SequentialIdGenerator())
                    .hash("secret")
                    .toString() shouldBe "TokenHash(***)"
            }
        }
    })

private fun hmac(
    key: ByteArray,
    input: String,
): ByteArray =
    Mac
        .getInstance("HmacSHA256")
        .apply { init(SecretKeySpec(key, "HmacSHA256")) }
        .doFinal(input.toByteArray(Charsets.UTF_8))
