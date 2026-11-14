package app.banbanyeok.server.room

import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldMatch

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

            it("does not print the hash") {
                TokenService("pepper-a-pepper-a-pepper-a-0000".toByteArray(), SequentialIdGenerator())
                    .hash("secret")
                    .toString() shouldBe "TokenHash(***)"
            }
        }
    })
