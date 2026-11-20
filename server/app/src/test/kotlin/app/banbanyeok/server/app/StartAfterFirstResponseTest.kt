package app.banbanyeok.server.app

import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.util.concurrent.atomic.AtomicInteger

class StartAfterFirstResponseTest :
    DescribeSpec({
        describe("the background start of the artifact checks") {
            it("does not run before a request, and runs exactly once after the first response however many follow") {
                val started = AtomicInteger()
                val services = MockedServices()
                testApplication {
                    application {
                        apiModule(testConfig(), services.api())
                        startAfterFirstResponse { started.incrementAndGet() }
                    }
                    startApplication()
                    started.get() shouldBe 0
                    client.json(HttpMethod.Get, "/v1/healthz").status shouldBe HttpStatusCode.OK
                    started.get() shouldBe 1
                    repeat(3) { client.json(HttpMethod.Get, "/v1/healthz").status shouldBe HttpStatusCode.OK }
                    started.get() shouldBe 1
                }
            }

            it("also starts after an error response, so a failing first request does not leave the checks unstarted") {
                val started = AtomicInteger()
                val services = MockedServices()
                testApplication {
                    application {
                        apiModule(testConfig(), services.api())
                        startAfterFirstResponse { started.incrementAndGet() }
                    }
                    client.json(HttpMethod.Get, "/v1/no-such-route").status shouldBe HttpStatusCode.NotFound
                    started.get() shouldBe 1
                }
            }
        }
    })
