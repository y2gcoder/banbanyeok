package app.banbanyeok.server.app

import app.banbanyeok.server.app.config.LimitSpec
import app.banbanyeok.server.app.http.IdempotencyCache
import app.banbanyeok.server.app.http.StoredResponse
import app.banbanyeok.server.app.http.TokenBucketLimiter
import app.banbanyeok.server.room.MutableClock
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.time.Duration

class RateLimitingTest :
    DescribeSpec({
        describe("token bucket") {
            it("allows a burst, refuses the next request with a retry time, and refills over time") {
                val clock = MutableClock()
                val limiter = TokenBucketLimiter(LimitSpec(capacity = 3, refillPerSecond = 0.5), clock)
                repeat(3) { limiter.tryAcquire("a").shouldBeNull() }
                limiter.tryAcquire("a") shouldBe 2L
                clock.advance(Duration.ofSeconds(2))
                limiter.tryAcquire("a").shouldBeNull()
                limiter.tryAcquire("a").shouldNotBeNull()
            }

            it("keeps a separate bucket per client") {
                val limiter = TokenBucketLimiter(LimitSpec(1, 0.001), MutableClock())
                limiter.tryAcquire("a").shouldBeNull()
                limiter.tryAcquire("a").shouldNotBeNull()
                limiter.tryAcquire("b").shouldBeNull()
            }

            it("never holds more than the burst size however long it idles") {
                val clock = MutableClock()
                val limiter = TokenBucketLimiter(LimitSpec(2, 1.0), clock)
                clock.advance(Duration.ofDays(1))
                limiter.tryAcquire("a").shouldBeNull()
                limiter.tryAcquire("a").shouldBeNull()
                limiter.tryAcquire("a").shouldNotBeNull()
            }
        }

        describe("idempotency cache") {
            it("returns the stored response until it expires and keeps the cache bounded") {
                val clock = MutableClock()
                val cache = IdempotencyCache(clock, Duration.ofMinutes(10), maxEntries = 2)
                cache.store("k1", StoredResponse("one"))
                cache.find("k1")?.body shouldBe "one"
                clock.advance(Duration.ofMinutes(11))
                cache.find("k1").shouldBeNull()
                cache.store("k2", StoredResponse("two"))
                cache.store("k3", StoredResponse("three"))
                cache.store("k4", StoredResponse("four"))
                cache.find("k2").shouldBeNull()
                cache.find("k4")?.body shouldBe "four"
            }
        }
    })
