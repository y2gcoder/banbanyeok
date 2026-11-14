package app.banbanyeok.server.artifact

import com.sun.net.httpserver.HttpServer
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.atomic.AtomicInteger

private class SteppingClock(
    var now: Instant = Instant.parse("2026-11-14T00:00:00Z"),
) : Clock() {
    override fun getZone(): java.time.ZoneId = ZoneOffset.UTC

    override fun withZone(zone: java.time.ZoneId?): Clock = this

    override fun instant(): Instant = now
}

class MetadataTokenProviderTest :
    DescribeSpec({
        fun server(
            status: Int,
            body: String,
            calls: AtomicInteger,
            flavors: MutableList<String?>,
        ): HttpServer =
            HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0).apply {
                createContext("/computeMetadata/v1/instance/service-accounts/default/token") { exchange ->
                    calls.incrementAndGet()
                    flavors += exchange.requestHeaders.getFirst("Metadata-Flavor")
                    val bytes = body.toByteArray()
                    exchange.sendResponseHeaders(status, bytes.size.toLong())
                    exchange.responseBody.use { it.write(bytes) }
                }
                start()
            }

        describe("token") {
            it("sends the metadata flavor header and reuses the token until shortly before it expires") {
                val calls = AtomicInteger()
                val flavors = mutableListOf<String?>()
                val http =
                    server(200, """{"access_token":"tok-1","expires_in":3600,"token_type":"Bearer"}""", calls, flavors)
                try {
                    val clock = SteppingClock()
                    val provider = MetadataTokenProvider("127.0.0.1:${http.address.port}", clock)
                    provider.token() shouldBe "tok-1"
                    provider.token() shouldBe "tok-1"
                    calls.get() shouldBe 1
                    flavors.single() shouldBe "Google"
                    clock.now = clock.now.plusSeconds(3600 - 61)
                    provider.token() shouldBe "tok-1"
                    calls.get() shouldBe 1
                    clock.now = clock.now.plusSeconds(2)
                    provider.token() shouldBe "tok-1"
                    calls.get() shouldBe 2
                } finally {
                    http.stop(0)
                }
            }

            it("fails without echoing any response body when the server refuses") {
                val http = server(403, """{"access_token":"must-not-leak"}""", AtomicInteger(), mutableListOf())
                try {
                    val e = shouldThrow<IOException> { MetadataTokenProvider("127.0.0.1:${http.address.port}").token() }
                    e.message.orEmpty() shouldNotContain "must-not-leak"
                } finally {
                    http.stop(0)
                }
            }
        }
    })
