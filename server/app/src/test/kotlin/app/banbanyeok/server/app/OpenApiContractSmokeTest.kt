package app.banbanyeok.server.app

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.ktor.http.HttpMethod

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
                        "application/json",
                        """{"code":"X","message":"y"}""",
                    )
                }
            }
        }
    })
