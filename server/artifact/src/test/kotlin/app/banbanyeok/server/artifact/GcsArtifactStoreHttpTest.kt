@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.artifact

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger

/** 응답 규칙을 코드로 주는 아주 작은 HTTP 서버(GCS API 흉내와 메타데이터 서버 흉내). */
private fun fakeServer(handler: (HttpExchange) -> Unit): HttpServer =
    HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0).apply {
        createContext("/") { exchange ->
            handler(exchange)
            exchange.close()
        }
        start()
    }

private fun HttpExchange.reply(
    status: Int,
    body: String = "",
    headers: Map<String, String> = emptyMap(),
) {
    headers.forEach { (k, v) -> responseHeaders.add(k, v) }
    val bytes = body.toByteArray()
    sendResponseHeaders(status, if (bytes.isEmpty()) -1 else bytes.size.toLong())
    if (bytes.isNotEmpty()) responseBody.use { it.write(bytes) }
}

class GcsArtifactStoreHttpTest :
    DescribeSpec({
        val key = ArtifactKey("manifest.json")

        fun store(
            gcs: HttpServer,
            metadata: HttpServer? = null,
        ) = GcsArtifactStore(
            bucket = "b",
            ioDispatcher = UnconfinedTestDispatcher(),
            endpoint = "http://127.0.0.1:${gcs.address.port}",
            tokens = metadata?.let { MetadataTokenProvider("127.0.0.1:${it.address.port}") },
        )

        describe("reading") {
            it("fails when the response has no generation header instead of treating it as ABSENT") {
                val gcs = fakeServer { it.reply(200, "x") }
                try {
                    val e = shouldThrow<IllegalStateException> { store(gcs).get(key) }
                    e.message.orEmpty() shouldContain "x-goog-generation"
                } finally {
                    gcs.stop(0)
                }
            }

            it("retries 429 and 408 but not other client errors") {
                val calls = AtomicInteger()
                val codes = listOf(429, 408)
                val gcs =
                    fakeServer {
                        val n = calls.getAndIncrement()
                        if (n <
                            codes.size
                        ) {
                            it.reply(codes[n])
                        } else {
                            it.reply(200, "ok", mapOf("x-goog-generation" to "7"))
                        }
                    }
                try {
                    store(gcs).get(key).shouldNotBeNull().version shouldBe ArtifactVersion("7")
                    calls.get() shouldBe 3
                } finally {
                    gcs.stop(0)
                }
                val badCalls = AtomicInteger()
                val bad = fakeServer { badCalls.incrementAndGet().let { _ -> it.reply(403, "no") } }
                try {
                    shouldThrow<IOException> { store(bad).get(key) }
                    badCalls.get() shouldBe 1
                } finally {
                    bad.stop(0)
                }
            }

            it("drops the cached token on 401 and retries once with a fresh one") {
                val tokenCalls = AtomicInteger()
                val metadata =
                    fakeServer {
                        it.reply(
                            200,
                            """{"access_token":"t${tokenCalls.incrementAndGet()}","expires_in":3600}""",
                        )
                    }
                val seen = mutableListOf<String?>()
                val gcs =
                    fakeServer {
                        seen += it.requestHeaders.getFirst("Authorization")
                        if (seen.size == 1) it.reply(401) else it.reply(200, "ok", mapOf("x-goog-generation" to "1"))
                    }
                try {
                    store(gcs, metadata).get(key).shouldNotBeNull()
                    seen shouldBe listOf("Bearer t1", "Bearer t2")
                    tokenCalls.get() shouldBe 2
                } finally {
                    gcs.stop(0)
                    metadata.stop(0)
                }
            }

            it("gives up after a single token refresh when 401 persists") {
                val tokenCalls = AtomicInteger()
                val metadata =
                    fakeServer {
                        it.reply(
                            200,
                            """{"access_token":"t${tokenCalls.incrementAndGet()}","expires_in":3600}""",
                        )
                    }
                val gcs = fakeServer { it.reply(401) }
                try {
                    shouldThrow<IOException> { store(gcs, metadata).get(key) }
                    tokenCalls.get() shouldBe 2
                } finally {
                    gcs.stop(0)
                    metadata.stop(0)
                }
            }
        }
    })
