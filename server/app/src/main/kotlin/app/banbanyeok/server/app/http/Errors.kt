package app.banbanyeok.server.app.http

import app.banbanyeok.server.app.application.AppException
import app.banbanyeok.server.recommendation.RecommendationError
import app.banbanyeok.server.recommendation.RecommendationException
import app.banbanyeok.server.room.ErrorKind
import app.banbanyeok.server.room.RoomException
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.install
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.plugins.PayloadTooLargeException
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.header
import io.ktor.server.response.respond
import kotlinx.serialization.SerializationException
import org.slf4j.LoggerFactory

private val logger = LoggerFactory.getLogger("errors")

fun ErrorKind.status(): HttpStatusCode =
    when (this) {
        ErrorKind.INVALID -> HttpStatusCode.BadRequest
        ErrorKind.UNAUTHENTICATED -> HttpStatusCode.Unauthorized
        ErrorKind.FORBIDDEN -> HttpStatusCode.Forbidden
        ErrorKind.NOT_FOUND -> HttpStatusCode.NotFound
        ErrorKind.CONFLICT -> HttpStatusCode.Conflict
    }

suspend fun ApplicationCall.respondError(
    status: HttpStatusCode,
    code: String,
    message: String,
) {
    if (status == HttpStatusCode.Unauthorized) response.header(HttpHeaders.WWWAuthenticate, "Bearer")
    respond(status, ErrorDto(code, message))
}

/** 모든 오류는 `{code, message}`로 돌려준다. 예상하지 못한 오류의 내용은 응답에 싣지 않고 로그에만 남긴다. */
fun Application.installErrorHandling() {
    install(StatusPages) {
        exception<RoomException> {
            call,
            e,
            ->
            call.respondError(e.error.kind.status(), e.error.name, e.message.orEmpty())
        }
        exception<AppException> { call, e -> call.respondError(e.kind.status(), e.code, e.message.orEmpty()) }
        exception<RecommendationException> {
            call,
            e,
            ->
            call.respondError(HttpStatusCode.BadRequest, e.error.code(), e.message.orEmpty())
        }
        exception<RateLimitedException> { call, e ->
            call.response.header(HttpHeaders.RetryAfter, e.retryAfterSeconds.toString())
            call.respondError(HttpStatusCode.TooManyRequests, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 뒤에 다시 시도해 주세요")
        }
        exception<PayloadTooLargeException> { call, _ ->
            call.respondError(HttpStatusCode.PayloadTooLarge, "PAYLOAD_TOO_LARGE", "요청이 너무 큽니다")
        }
        exception<BadRequestException> {
            call,
            _,
            ->
            call.respondError(HttpStatusCode.BadRequest, "INVALID_REQUEST", "요청 형식이 올바르지 않습니다")
        }
        exception<SerializationException> { call, _ ->
            call.respondError(HttpStatusCode.BadRequest, "INVALID_REQUEST", "요청 형식이 올바르지 않습니다")
        }
        exception<Throwable> { call, e ->
            logger.error("처리하지 못한 오류", e)
            call.respondError(HttpStatusCode.InternalServerError, "INTERNAL_ERROR", "서버 오류가 발생했습니다")
        }
        status(
            HttpStatusCode.NotFound,
        ) { call, _ -> call.respondError(HttpStatusCode.NotFound, "NOT_FOUND", "찾을 수 없습니다") }
        status(HttpStatusCode.MethodNotAllowed) { call, _ ->
            call.respondError(HttpStatusCode.MethodNotAllowed, "METHOD_NOT_ALLOWED", "허용되지 않는 메서드입니다")
        }
    }
}

private fun RecommendationError.code(): String =
    when (this) {
        RecommendationError.PEOPLE_COUNT -> "INVALID_PEOPLE_COUNT"
        RecommendationError.UNKNOWN_STATION -> "INVALID_STATION"
        RecommendationError.FAVOR_TARGET_REQUIRED -> "FAVOR_TARGET_REQUIRED"
        RecommendationError.FAVOR_TARGET_UNKNOWN -> "FAVOR_TARGET_UNKNOWN"
    }
