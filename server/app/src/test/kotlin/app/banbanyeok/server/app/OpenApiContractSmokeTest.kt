package app.banbanyeok.server.app

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.ktor.http.HttpMethod

private const val PROBLEM =
    """{"type":"https://banbanyeok.app/problems/rate-limited","title":"요청이 너무 많음","status":429,""" +
        """"detail":"d","code":"RATE_LIMITED","message":"d"}"""

class OpenApiContractSmokeTest :
    DescribeSpec({
        describe("the contract validator") {
            it("accepts a documented response") {
                OpenApiContract.assertValid(
                    HttpMethod.Post,
                    "/v1/anon",
                    201,
                    "application/json",
                    """{"anonUserId":"u_x","deviceToken":"t"}""",
                )
            }

            it("rejects a body that violates the schema and an undocumented status") {
                shouldThrow<AssertionError> {
                    OpenApiContract.assertValid(
                        HttpMethod.Post,
                        "/v1/anon",
                        201,
                        "application/json",
                        """{"anonUserId":"u_x"}""",
                    )
                }
                shouldThrow<AssertionError> {
                    OpenApiContract.assertValid(
                        HttpMethod.Post,
                        "/v1/anon",
                        418,
                        "application/problem+json",
                        PROBLEM,
                    )
                }
            }

            it("accepts an error only as application/problem+json with every Problem field") {
                OpenApiContract.assertValid(HttpMethod.Post, "/v1/anon", 429, "application/problem+json", PROBLEM)
                // 옛 형식: Content-Type도 본문도 계약과 다르다.
                shouldThrow<AssertionError> {
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/anon", 429, "application/json", PROBLEM)
                }
                shouldThrow<AssertionError> {
                    OpenApiContract.assertValid(
                        HttpMethod.Post,
                        "/v1/anon",
                        429,
                        "application/problem+json",
                        """{"code":"RATE_LIMITED","message":"y"}""",
                    )
                }
            }
        }
    })
