package app.banbanyeok.server.app.config

import app.banbanyeok.server.room.exposed.DatabaseSettings
import java.net.URI

enum class Profile { LOCAL, PROD }

enum class ArtifactStoreKind { LOCAL, GCS }

data class ArtifactConfig(
    val kind: ArtifactStoreKind,
    val localDir: String,
    val gcsBucket: String?,
    val gcsPrefix: String,
)

/** 한 종류의 요청에 대한 토큰 버킷: 버스트 크기와 초당 보충량. */
data class LimitSpec(
    val capacity: Int,
    val refillPerSecond: Double,
)

enum class ClientIpSourceKind { PEER, XFF_LAST, HEADER }

/**
 * 속도 제한 키로 쓸 클라이언트 IP의 출처. [kind]는 직접 연결(peer) 또는 신뢰할 프록시 체인에서 읽는 방법이고,
 * [proxySecret]이 있으면 웹 프록시(Cloudflare Worker)가 공유 비밀과 함께 넘긴 클라이언트 IP 헤더를 우선한다(비밀이 맞을 때만).
 */
data class ClientIpSource(
    val kind: ClientIpSourceKind,
    val header: String? = null,
    val proxySecret: String? = null,
) {
    // 공유 비밀이 로그에 찍히지 않게 한다.
    override fun toString(): String =
        "ClientIpSource(kind=$kind, header=$header, proxySecret=${if (proxySecret == null) "none" else "***"})"
}

data class RateLimitConfig(
    val enabled: Boolean,
    val general: LimitSpec,
    val write: LimitSpec,
    val creation: LimitSpec,
    val clientIp: ClientIpSource,
)

data class AppConfig(
    val profile: Profile,
    val port: Int,
    val database: DatabaseSettings,
    val tokenPepper: String,
    val artifacts: ArtifactConfig,
    val corsOrigins: List<String>,
    val rateLimit: RateLimitConfig,
    val maxRequestBytes: Long,
) {
    // 비밀값(DB 비밀번호, pepper)이 로그에 찍히지 않게 한다.
    override fun toString(): String =
        "AppConfig(profile=$profile, port=$port, database=$database, artifacts=${artifacts.kind}, cors=$corsOrigins)"

    companion object {
        fun load(env: Map<String, String> = System.getenv()): AppConfig = ConfigLoader(env).load()
    }
}

/** 설정이 올바르지 않다. 메시지에는 환경 변수 이름만 있고 값은 없다. */
class ConfigException(
    val problems: List<String>,
) : RuntimeException("설정 오류: " + problems.joinToString("; "))

/**
 * 환경 변수에서 타입 있는 설정을 읽는다. 기본은 local 프로필(개발용 기본값). `APP_PROFILE=prod`에서는 필수 값이 없으면
 * 모든 누락·오류를 모아 기동을 실패시킨다.
 */
internal class ConfigLoader(
    private val env: Map<String, String>,
) {
    private val problems = mutableListOf<String>()
    private val prod = profileOf() == Profile.PROD

    fun load(): AppConfig {
        val config =
            AppConfig(
                profile = if (prod) Profile.PROD else Profile.LOCAL,
                port = port(),
                database = database(),
                tokenPepper = tokenPepper(),
                artifacts = artifacts(),
                corsOrigins = corsOrigins(),
                rateLimit = rateLimit(),
                maxRequestBytes = long("MAX_REQUEST_BYTES", DEFAULT_MAX_REQUEST_BYTES, 1024L..MAX_REQUEST_BYTES_LIMIT),
            )
        if (problems.isNotEmpty()) throw ConfigException(problems.toList())
        return config
    }

    private fun profileOf(): Profile =
        when (env["APP_PROFILE"]?.lowercase()) {
            null, "", "local" -> {
                Profile.LOCAL
            }

            "prod", "production" -> {
                Profile.PROD
            }

            else -> {
                problems += "APP_PROFILE은 local 또는 prod여야 합니다"
                Profile.LOCAL
            }
        }

    private fun port(): Int =
        int("SERVER_PORT", env["PORT"]?.toIntOrNull() ?: DEFAULT_PORT, 1..MAX_PORT, alias = "PORT")

    private fun database(): DatabaseSettings {
        val url = required("DATABASE_URL", "jdbc:postgresql://127.0.0.1:5432/banbanyeok")
        val user = required("DATABASE_USER", "local")
        val password = required("DATABASE_PASSWORD", "local-development-only")
        if (url != null && !url.startsWith("jdbc:postgresql:")) problems += "DATABASE_URL은 jdbc:postgresql: 로 시작해야 합니다"
        return DatabaseSettings(
            url.orEmpty(),
            user.orEmpty(),
            password.orEmpty(),
            int("DATABASE_POOL_SIZE", DEFAULT_POOL_SIZE, 1..MAX_POOL_SIZE),
        )
    }

    private fun tokenPepper(): String {
        val pepper = required("TOKEN_PEPPER", LOCAL_PEPPER).orEmpty()
        if (prod && pepper.isNotEmpty() && pepper.length < MIN_PEPPER_LENGTH) {
            problems += "TOKEN_PEPPER는 운영에서 $MIN_PEPPER_LENGTH 자 이상이어야 합니다"
        }
        if (prod && pepper == LOCAL_PEPPER) problems += "TOKEN_PEPPER에 로컬 기본값을 쓸 수 없습니다"
        return pepper
    }

    private fun artifacts(): ArtifactConfig {
        val kind =
            when (env["ARTIFACT_STORE"]?.lowercase()) {
                null, "" -> {
                    if (prod) ArtifactStoreKind.GCS else ArtifactStoreKind.LOCAL
                }

                "local" -> {
                    ArtifactStoreKind.LOCAL
                }

                "gcs" -> {
                    ArtifactStoreKind.GCS
                }

                else -> {
                    problems += "ARTIFACT_STORE는 local 또는 gcs여야 합니다"
                    ArtifactStoreKind.LOCAL
                }
            }
        if (prod && kind == ArtifactStoreKind.LOCAL) problems += "ARTIFACT_STORE=local은 운영에서 쓸 수 없습니다"
        val bucket =
            if (kind ==
                ArtifactStoreKind.GCS
            ) {
                required("ARTIFACT_GCS_BUCKET", null)
            } else {
                env["ARTIFACT_GCS_BUCKET"]
            }
        return ArtifactConfig(
            kind = kind,
            localDir = env["ARTIFACT_LOCAL_DIR"]?.takeIf { it.isNotBlank() } ?: "data/artifacts/dev",
            gcsBucket = bucket,
            gcsPrefix = env["ARTIFACT_GCS_PREFIX"].orEmpty(),
        )
    }

    private fun corsOrigins(): List<String> {
        val raw =
            if (prod) {
                required("CORS_ALLOWED_ORIGINS", null)
            } else {
                env["CORS_ALLOWED_ORIGINS"]
                    ?: DEFAULT_LOCAL_ORIGINS
            }
        val origins =
            raw
                .orEmpty()
                .split(',')
                .map { it.trim() }
                .filter { it.isNotEmpty() }
        origins.forEach { origin ->
            val uri = runCatching { URI(origin) }.getOrNull()
            val valid =
                uri?.scheme in setOf("http", "https") && uri?.host != null && (uri.path.isNullOrEmpty()) &&
                    uri.query == null
            if (!valid) problems += "CORS_ALLOWED_ORIGINS에 올바르지 않은 오리진이 있습니다(스킴://호스트[:포트]만)"
            if (prod && uri?.scheme != "https") problems += "CORS_ALLOWED_ORIGINS는 운영에서 https여야 합니다"
        }
        return origins
    }

    private fun rateLimit(): RateLimitConfig =
        RateLimitConfig(
            enabled = env["RATE_LIMIT_ENABLED"]?.lowercase() != "false",
            general =
                LimitSpec(
                    int("RATE_LIMIT_GENERAL_BURST", 60, 1..MAX_BURST),
                    perMinute("RATE_LIMIT_GENERAL_PER_MINUTE", 60.0),
                ),
            write =
                LimitSpec(
                    int("RATE_LIMIT_WRITE_BURST", 20, 1..MAX_BURST),
                    perMinute("RATE_LIMIT_WRITE_PER_MINUTE", 20.0),
                ),
            creation =
                LimitSpec(
                    int("RATE_LIMIT_CREATE_BURST", 10, 1..MAX_BURST),
                    perMinute("RATE_LIMIT_CREATE_PER_DAY", 50.0, MINUTES_PER_DAY),
                ),
            clientIp = clientIpSource(),
        )

    private fun clientIpSource(): ClientIpSource {
        val raw = env["RATE_LIMIT_CLIENT_IP_SOURCE"]?.trim().orEmpty().ifEmpty { "peer" }
        val secret = proxySecret()
        return when {
            raw == "peer" -> {
                ClientIpSource(ClientIpSourceKind.PEER, proxySecret = secret)
            }

            raw == "xff-last" -> {
                ClientIpSource(ClientIpSourceKind.XFF_LAST, proxySecret = secret)
            }

            raw.startsWith("header:") && raw.length > "header:".length -> {
                ClientIpSource(ClientIpSourceKind.HEADER, raw.removePrefix("header:"), secret)
            }

            else -> {
                problems += "RATE_LIMIT_CLIENT_IP_SOURCE는 peer, xff-last, header:<이름> 중 하나여야 합니다"
                ClientIpSource(ClientIpSourceKind.PEER, proxySecret = secret)
            }
        }
    }

    /** 선택. 없으면 프록시 헤더를 무시한다(로컬). 있으면 추측되지 않을 만큼 길어야 한다. */
    private fun proxySecret(): String? {
        val secret = env["PROXY_SHARED_SECRET"]?.takeIf { it.isNotBlank() } ?: return null
        if (secret.length < MIN_PROXY_SECRET_LENGTH) {
            problems += "PROXY_SHARED_SECRET는 $MIN_PROXY_SECRET_LENGTH 자 이상이어야 합니다"
        }
        return secret
    }

    /** 분당(또는 [perMinutes]분당) 횟수를 초당 보충량으로 바꾼다. */
    private fun perMinute(
        name: String,
        default: Double,
        perMinutes: Int = 1,
    ): Double {
        val value = env[name]?.toDoubleOrNull()
        if (env[name] != null && (value == null || value <= 0)) problems += "$name 은 0보다 큰 수여야 합니다"
        return (value?.takeIf { it > 0 } ?: default) / (perMinutes * SECONDS_PER_MINUTE)
    }

    private fun required(
        name: String,
        localDefault: String?,
    ): String? {
        val value = env[name]?.takeIf { it.isNotBlank() }
        if (value != null) return value
        if (prod || localDefault == null) {
            problems += "필수 설정이 없습니다: $name"
            return null
        }
        return localDefault
    }

    private fun int(
        name: String,
        default: Int,
        range: IntRange,
        alias: String? = null,
    ): Int {
        val raw = env[name] ?: alias?.let { env[it] }
        val value = raw?.toIntOrNull()
        if (raw != null &&
            (value == null || value !in range)
        ) {
            problems += "$name 은 ${range.first}..${range.last} 정수여야 합니다"
        }
        return value?.takeIf { it in range } ?: default
    }

    private fun long(
        name: String,
        default: Long,
        range: LongRange,
    ): Long {
        val raw = env[name]
        val value = raw?.toLongOrNull()
        if (raw != null &&
            (value == null || value !in range)
        ) {
            problems += "$name 은 ${range.first}..${range.last} 정수여야 합니다"
        }
        return value?.takeIf { it in range } ?: default
    }

    private companion object {
        const val DEFAULT_PORT = 8080
        const val MAX_PORT = 65535
        const val DEFAULT_POOL_SIZE = 4
        const val MAX_POOL_SIZE = 50
        const val MAX_BURST = 10_000
        const val MIN_PEPPER_LENGTH = 32
        const val MIN_PROXY_SECRET_LENGTH = 32
        const val MINUTES_PER_DAY = 1440
        const val SECONDS_PER_MINUTE = 60
        const val DEFAULT_MAX_REQUEST_BYTES = 16L * 1024
        const val MAX_REQUEST_BYTES_LIMIT = 1024L * 1024
        const val LOCAL_PEPPER = "local-development-pepper-never-use-in-production"
        const val DEFAULT_LOCAL_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
    }
}
