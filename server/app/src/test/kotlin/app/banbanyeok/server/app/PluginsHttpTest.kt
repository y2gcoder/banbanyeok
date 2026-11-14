package app.banbanyeok.server.app

import app.banbanyeok.server.app.http.maskedPath
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.mockk.coEvery
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private const val ROOM = "/v1/rooms/abcdefghjk"

class PluginsHttpTest :
    DescribeSpec({
        describe("CORS") {
            val config = testConfig(mapOf("CORS_ALLOWED_ORIGINS" to "https://web.example,http://localhost:3000"))

            it("allows only the configured web origins") {
                withMockedApi(config) {
                    val allowed =
                        client.json(
                            HttpMethod.Get,
                            "/v1/manifest",
                        ) { headers.append(HttpHeaders.Origin, "https://web.example") }
                    allowed.headers[HttpHeaders.AccessControlAllowOrigin] shouldBe "https://web.example"
                    val local =
                        client.json(
                            HttpMethod.Get,
                            "/v1/manifest",
                        ) { headers.append(HttpHeaders.Origin, "http://localhost:3000") }
                    local.headers[HttpHeaders.AccessControlAllowOrigin] shouldBe "http://localhost:3000"
                    val other =
                        client.json(
                            HttpMethod.Get,
                            "/v1/manifest",
                        ) { headers.append(HttpHeaders.Origin, "https://evil.example") }
                    other.headers[HttpHeaders.AccessControlAllowOrigin] shouldBe null
                    other.status shouldBe HttpStatusCode.Forbidden
                }
            }

            it("answers a preflight for the Authorization and Idempotency-Key headers") {
                withMockedApi(config) {
                    val response =
                        client.json(HttpMethod.Options, "/v1/rooms") {
                            headers.append(HttpHeaders.Origin, "https://web.example")
                            headers.append(HttpHeaders.AccessControlRequestMethod, "POST")
                            headers.append(
                                HttpHeaders.AccessControlRequestHeaders,
                                "authorization, content-type, idempotency-key",
                            )
                        }
                    response.status shouldBe HttpStatusCode.OK
                    response.headers[HttpHeaders.AccessControlAllowOrigin] shouldBe "https://web.example"
                    response.headers[HttpHeaders.AccessControlAllowHeaders] shouldContain "Idempotency-Key"
                }
            }
        }

        describe("request size") {
            it("rejects a body over the limit with 413 and a JSON error") {
                withMockedApi(testConfig(mapOf("MAX_REQUEST_BYTES" to "2048"))) {
                    val huge = """{"mode":"fair","host":{"nickname":"${"x".repeat(5000)}","originCode":"aaa"}}"""
                    val response = client.json(HttpMethod.Post, "/v1/rooms", huge)
                    response.status shouldBe HttpStatusCode.PayloadTooLarge
                    Json
                        .parseToJsonElement(response.bodyAsText())
                        .jsonObject["code"]!!
                        .jsonPrimitive.content shouldBe
                        "PAYLOAD_TOO_LARGE"
                }
            }
        }

        describe("rate limiting") {
            it("answers 429 with Retry-After once a client exceeds the burst") {
                val config =
                    testConfig(mapOf("RATE_LIMIT_GENERAL_BURST" to "3", "RATE_LIMIT_GENERAL_PER_MINUTE" to "1"))
                withMockedApi(config) {
                    repeat(3) { client.json(HttpMethod.Get, "/v1/manifest").status shouldBe HttpStatusCode.OK }
                    val limited = client.json(HttpMethod.Get, "/v1/manifest")
                    limited.status shouldBe HttpStatusCode.TooManyRequests
                    (limited.headers[HttpHeaders.RetryAfter]!!.toLong() > 0) shouldBe true
                    Json
                        .parseToJsonElement(limited.bodyAsText())
                        .jsonObject["code"]!!
                        .jsonPrimitive.content shouldBe
                        "RATE_LIMITED"
                    client.json(HttpMethod.Get, "/healthz").status shouldBe HttpStatusCode.OK
                }
            }

            it("limits room creation separately from other writes") {
                val config = testConfig(mapOf("RATE_LIMIT_CREATE_BURST" to "2", "RATE_LIMIT_CREATE_PER_DAY" to "1"))
                withMockedApi(config) { services ->
                    coEvery { services.anon.issue() } returns
                        app.banbanyeok.server.room
                            .IssuedAnonUser("u_x", "t")
                    repeat(2) { client.json(HttpMethod.Post, "/v1/anon").status shouldBe HttpStatusCode.Created }
                    client.json(HttpMethod.Post, "/v1/anon").status shouldBe HttpStatusCode.TooManyRequests
                    client.json(HttpMethod.Get, "/v1/manifest").status shouldBe HttpStatusCode.OK
                }
            }

            it("keys clients by the configured forwarded header") {
                val config =
                    testConfig(
                        mapOf(
                            "RATE_LIMIT_GENERAL_BURST" to "1",
                            "RATE_LIMIT_GENERAL_PER_MINUTE" to "1",
                            "RATE_LIMIT_CLIENT_IP_SOURCE" to "header:CF-Connecting-IP",
                        ),
                    )
                withMockedApi(config) {
                    suspend fun hit(ip: String) =
                        client.json(HttpMethod.Get, "/v1/manifest") { headers.append("CF-Connecting-IP", ip) }.status
                    hit("203.0.113.1") shouldBe HttpStatusCode.OK
                    hit("203.0.113.1") shouldBe HttpStatusCode.TooManyRequests
                    hit("203.0.113.2") shouldBe HttpStatusCode.OK
                }
            }
        }

        describe("response headers") {
            it("never caches room and recommendation responses but lets the manifest be cached") {
                withMockedApi { services ->
                    coEvery { services.rooms.get(any(), any()) } throws
                        app.banbanyeok.server.room.RoomException(
                            app.banbanyeok.server.room.RoomError.ROOM_NOT_FOUND,
                            "x",
                        )
                    client.json(HttpMethod.Get, ROOM).headers[HttpHeaders.CacheControl] shouldBe "no-store"
                    client.json(HttpMethod.Get, ROOM).headers["X-Content-Type-Options"] shouldBe "nosniff"
                    client.json(HttpMethod.Get, "/v1/manifest").headers[HttpHeaders.CacheControl] shouldBe
                        "public, max-age=60"
                }
            }
        }

        describe("request logging") {
            it("masks room and participant ids in logged paths and never includes a query") {
                maskedPath("/v1/rooms/abcdefghjk/participants/xyz123") shouldBe
                    "/v1/rooms/{roomId}/participants/{participantId}"
                maskedPath("/v1/rooms/abcdefghjk/result") shouldNotContain "abcdefghjk"
                maskedPath("/v1/manifest") shouldBe "/v1/manifest"
            }
        }
    })
