package app.banbanyeok.server.app

import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.delay

class WarmStartTest :
    DescribeSpec({
        describe("warmStartModule") {
            it("answers health checks before assembly finishes and holds other requests until it does") {
                val release = CompletableDeferred<Unit>()
                val services = MockedServices()
                testApplication {
                    application { warmStartModule(testConfig()) { release.await().let { services.api() } } }
                    // 준비 전: 건강 확인 두 경로는 바로 답한다.
                    client.json(HttpMethod.Get, "/healthz").bodyAsText() shouldBe "ok"
                    client.json(HttpMethod.Get, "/v1/healthz").status shouldBe HttpStatusCode.OK
                    // 준비 전: 데이터 요청은 대기한다.
                    val manifest = async { client.json(HttpMethod.Get, "/v1/manifest") }
                    delay(200)
                    manifest.isCompleted shouldBe false
                    // 준비 후: 대기하던 요청이 정상 응답을 받고 건강 확인은 계속 된다.
                    release.complete(Unit)
                    manifest.await().status shouldBe HttpStatusCode.OK
                    client.json(HttpMethod.Get, "/v1/manifest").status shouldBe HttpStatusCode.OK
                    client.json(HttpMethod.Get, "/healthz").status shouldBe HttpStatusCode.OK
                }
            }

            it("reports an error to waiting requests when assembly fails, while health stays up") {
                val fail = CompletableDeferred<Unit>()
                testApplication {
                    application {
                        warmStartModule(testConfig()) {
                            fail.await()
                            error("assembly failed")
                        }
                    }
                    val manifest = async { client.json(HttpMethod.Get, "/v1/manifest") }
                    delay(100)
                    fail.complete(Unit)
                    manifest.await().status shouldBe HttpStatusCode.InternalServerError
                    client.json(HttpMethod.Get, "/healthz").status shouldBe HttpStatusCode.OK
                }
            }
        }
    })
