package app.banbanyeok.server.app

import app.banbanyeok.server.app.config.AppConfig
import app.banbanyeok.server.app.config.ArtifactStoreKind
import app.banbanyeok.server.app.config.ClientIpSourceKind
import app.banbanyeok.server.app.config.ConfigException
import app.banbanyeok.server.app.config.Profile
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain

private val prodEnv =
    mapOf(
        "APP_PROFILE" to "prod",
        "DATABASE_URL" to "jdbc:postgresql://db.example.internal:5432/banbanyeok",
        "DATABASE_USER" to "app",
        "DATABASE_PASSWORD" to "very-secret-database-password",
        "TOKEN_PEPPER" to "p".repeat(40),
        "ARTIFACT_GCS_BUCKET" to "banbanyeok-artifacts",
        "CORS_ALLOWED_ORIGINS" to "https://banbanyeok.example",
    )

class ConfigTest :
    DescribeSpec({
        describe("the local profile") {
            it("works with no environment at all and uses development defaults") {
                val config = AppConfig.load(emptyMap())
                config.profile shouldBe Profile.LOCAL
                config.port shouldBe 8080
                config.artifacts.kind shouldBe ArtifactStoreKind.LOCAL
                config.artifacts.localDir shouldBe "data/artifacts/dev"
                config.database.url shouldBe "jdbc:postgresql://127.0.0.1:5432/banbanyeok"
                config.corsOrigins shouldContain "http://localhost:3000"
                config.rateLimit.clientIp.kind shouldBe ClientIpSourceKind.PEER
            }

            it("lets environment variables override the defaults") {
                val config =
                    AppConfig.load(
                        mapOf(
                            "SERVER_PORT" to "31234",
                            "DATABASE_URL" to "jdbc:postgresql://127.0.0.1:25432/banbanyeok",
                            "CORS_ALLOWED_ORIGINS" to "http://localhost:41000, http://127.0.0.1:41000",
                            "RATE_LIMIT_CLIENT_IP_SOURCE" to "header:CF-Connecting-IP",
                        ),
                    )
                config.port shouldBe 31234
                config.database.url shouldBe "jdbc:postgresql://127.0.0.1:25432/banbanyeok"
                config.corsOrigins shouldContainExactly listOf("http://localhost:41000", "http://127.0.0.1:41000")
                config.rateLimit.clientIp.header shouldBe "CF-Connecting-IP"
            }

            it("accepts the PORT variable Cloud Run sets") {
                AppConfig.load(mapOf("PORT" to "9090")).port shouldBe 9090
            }
        }

        describe("the prod profile") {
            it("loads when every required value is present") {
                val config = AppConfig.load(prodEnv)
                config.profile shouldBe Profile.PROD
                config.artifacts.kind shouldBe ArtifactStoreKind.GCS
                config.artifacts.gcsBucket shouldBe "banbanyeok-artifacts"
            }

            it("fails to start and names every missing required value") {
                val e = shouldThrow<ConfigException> { AppConfig.load(mapOf("APP_PROFILE" to "prod")) }
                listOf(
                    "DATABASE_URL",
                    "DATABASE_USER",
                    "DATABASE_PASSWORD",
                    "TOKEN_PEPPER",
                    "ARTIFACT_GCS_BUCKET",
                    "CORS_ALLOWED_ORIGINS",
                ).forEach { e.message shouldContain it }
            }

            it("refuses unsafe values without printing them") {
                val e =
                    shouldThrow<ConfigException> {
                        AppConfig.load(
                            prodEnv +
                                mapOf(
                                    "TOKEN_PEPPER" to "short-secret",
                                    "CORS_ALLOWED_ORIGINS" to "http://insecure.example",
                                    "ARTIFACT_STORE" to "local",
                                ),
                        )
                    }
                e.message shouldContain "TOKEN_PEPPER"
                e.message shouldContain "https"
                e.message shouldContain "ARTIFACT_STORE=local"
                e.message shouldNotContain "short-secret"
            }

            it("does not accept the local pepper default") {
                val e =
                    shouldThrow<ConfigException> {
                        AppConfig.load(prodEnv + ("TOKEN_PEPPER" to "local-development-pepper-never-use-in-production"))
                    }
                e.message shouldContain "로컬 기본값"
            }

            it("never prints secrets in toString") {
                val text = AppConfig.load(prodEnv + ("PROXY_SHARED_SECRET" to "q".repeat(40))).toString()
                text shouldNotContain "very-secret-database-password"
                text shouldNotContain "pppppppppp"
                text shouldNotContain "qqqqqqqqqq"
            }

            it("treats the proxy shared secret as optional but refuses a short one without printing it") {
                AppConfig
                    .load(prodEnv)
                    .rateLimit.clientIp.proxySecret shouldBe null
                AppConfig
                    .load(
                        prodEnv + ("PROXY_SHARED_SECRET" to "z".repeat(40)),
                    ).rateLimit.clientIp.proxySecret shouldBe
                    "z".repeat(40)
                val e =
                    shouldThrow<ConfigException> { AppConfig.load(prodEnv + ("PROXY_SHARED_SECRET" to "short-zzz")) }
                e.message shouldContain "PROXY_SHARED_SECRET"
                e.message shouldNotContain "short-zzz"
                AppConfig
                    .load(
                        prodEnv + ("PROXY_SHARED_SECRET" to "z".repeat(40)),
                    ).rateLimit.clientIp
                    .toString() shouldNotContain
                    "zzzz"
            }
        }

        describe("validation") {
            it("rejects malformed values") {
                val e =
                    shouldThrow<ConfigException> {
                        AppConfig.load(
                            mapOf(
                                "SERVER_PORT" to "http",
                                "APP_PROFILE" to "staging",
                                "DATABASE_URL" to "mysql://x",
                                "RATE_LIMIT_GENERAL_BURST" to "0",
                            ),
                        )
                    }
                e.problems.size shouldBe 4
            }
        }
    })
