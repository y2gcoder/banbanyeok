package app.banbanyeok.server.app.http

import app.banbanyeok.server.app.config.AppConfig
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.application.hooks.ResponseSent
import io.ktor.server.application.install
import io.ktor.server.plugins.bodylimit.RequestBodyLimit
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import java.net.URI

val apiJson =
    Json {
        encodeDefaults = true
        explicitNulls = true
        ignoreUnknownKeys = true
    }

/**
 * 모든 응답에 보안 헤더를 붙이고, 개인 정보가 담긴 응답은 캐시하지 못하게 한다. 산출물(/manifest, /data)은 자기 캐시 정책을 쓴다.
 */
private val SecurityHeaders =
    createApplicationPlugin("SecurityHeaders") {
        onCall { call ->
            call.response.headers.append("X-Content-Type-Options", "nosniff")
            val path = call.request.path()
            val cacheable = path.startsWith("/v1/manifest") || path.startsWith("/v1/data/")
            if (!cacheable) call.response.headers.append(HttpHeaders.CacheControl, "no-store")
        }
    }

private val logger = LoggerFactory.getLogger("http")

private val ROOM_SEGMENT = Regex("/rooms/[^/]+")
private val PARTICIPANT_SEGMENT = Regex("/participants/[^/]+")

/** 방 ID와 참여자 ID는 링크와 같은 값이라 로그에 남기지 않는다. 토큰·쿼리는 애초에 기록하지 않는다. */
internal fun maskedPath(path: String): String =
    path.replace(ROOM_SEGMENT, "/rooms/{roomId}").replace(PARTICIPANT_SEGMENT, "/participants/{participantId}")

private val RequestLogging =
    createApplicationPlugin("RequestLogging") {
        on(ResponseSent) { call ->
            if (call.request.path() != "/healthz") {
                logger.info(
                    "{} {} -> {}",
                    call.request.httpMethod.value,
                    maskedPath(call.request.path()),
                    call.response.status()?.value,
                )
            }
        }
    }

private fun rateLimitPlugin(limiting: RateLimiting) =
    createApplicationPlugin("RateLimit") {
        onCall { call -> limiting.check(call.request.httpMethod.value, call.request.path(), call.request) }
    }

fun Application.installCommonPlugins(
    config: AppConfig,
    limiting: RateLimiting,
) {
    install(ContentNegotiation) { json(apiJson) }
    install(RequestBodyLimit) { bodyLimit { config.maxRequestBytes } }
    install(SecurityHeaders)
    install(rateLimitPlugin(limiting))
    install(RequestLogging)
    install(CORS) {
        config.corsOrigins.forEach { origin ->
            val uri = URI(origin)
            val host = if (uri.port == -1) uri.host else "${uri.host}:${uri.port}"
            allowHost(host, schemes = listOf(uri.scheme))
        }
        listOf(
            HttpMethod.Get,
            HttpMethod.Post,
            HttpMethod.Put,
            HttpMethod.Patch,
            HttpMethod.Delete,
        ).forEach(::allowMethod)
        listOf(
            HttpHeaders.Authorization,
            HttpHeaders.ContentType,
            "Idempotency-Key",
            HttpHeaders.IfNoneMatch,
        ).forEach(::allowHeader)
        exposeHeader(HttpHeaders.ETag)
        exposeHeader(HttpHeaders.RetryAfter)
        allowCredentials = false
        maxAgeInSeconds = CORS_MAX_AGE_SECONDS
    }
}

private const val CORS_MAX_AGE_SECONDS = 3600L
