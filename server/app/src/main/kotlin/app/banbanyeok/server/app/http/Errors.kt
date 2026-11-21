package app.banbanyeok.server.app.http

import app.banbanyeok.server.app.application.AppException
import app.banbanyeok.server.recommendation.RecommendationError
import app.banbanyeok.server.recommendation.RecommendationException
import app.banbanyeok.server.room.ErrorKind
import app.banbanyeok.server.room.RoomException
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.withCharset
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.install
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.plugins.PayloadTooLargeException
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.header
import io.ktor.server.response.respondText
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
    val problem = ProblemDto(ProblemTypes.typeUri(code), ProblemTypes.title(code), status.value, message, code, message)
    respondText(apiJson.encodeToString(ProblemDto.serializer(), problem), PROBLEM_JSON, status)
}

private val PROBLEM_JSON = ContentType("application", "problem+json").withCharset(Charsets.UTF_8)

/**
 * 모든 오류는 `application/problem+json`(`{type, title, status, detail, code, message}`)으로 돌려준다. 예상하지 못한 오류의 내용은
 * 응답에 싣지 않고 로그에만 남긴다.
 */
fun Application.installErrorHandling() {
    install(StatusPages) {
        exception<RoomException> {
            call,
            e,
            ->
            call.respondError(e.error.kind.status(), e.error.name, e.message.orEmpty())
        }
        exception<AppException> { call, e -> call.respondError(e.kind.status(), e.code, e.message.orEmpty()) }
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

// RecommendationError → 응답. 경로마다 표가 따로 있고 같은 오류에도 일부러 다른 코드를 쓴다. 두 표는 여기에서만 정한다.
// 라우트는 추천을 부르는 곳을 아래 래퍼 중 하나로 감싼다. 감싸지 않은 RecommendationException은 처리하지 못한 오류(500)다.

/** 무상태 `/v1/recommend`: 입력이 잘못된 것이라 모두 400이고, 메시지는 추천 모듈이 만든 것을 그대로 쓴다. */
internal inline fun <T> statelessRecommendationErrors(block: () -> T): T =
    try {
        block()
    } catch (e: RecommendationException) {
        throw e.asStatelessError()
    }

internal fun RecommendationException.asStatelessError(): AppException =
    AppException(ErrorKind.INVALID, statelessCode(error), message.orEmpty(), this)

private fun statelessCode(error: RecommendationError): String =
    when (error) {
        RecommendationError.PEOPLE_COUNT -> "INVALID_PEOPLE_COUNT"
        RecommendationError.INVALID_NICKNAME -> "INVALID_NICKNAME"
        RecommendationError.UNKNOWN_STATION -> "INVALID_STATION"
        RecommendationError.FAVOR_TARGET_REQUIRED -> "FAVOR_TARGET_REQUIRED"
        RecommendationError.FAVOR_TARGET_UNKNOWN -> "FAVOR_TARGET_UNKNOWN"
    }

/**
 * 방 결과·미리보기: 저장된 방의 상태와 맞지 않는 것이라 상태가 오류마다 다르고 메시지는 고정이다. 저장된 출발역이 지금 데이터에 없는 것은
 * 입력 오류가 아니라 충돌(`STATION_UNAVAILABLE` 409)이다(무상태의 `INVALID_STATION` 400과 일부러 다르다).
 */
internal inline fun <T> roomRecommendationErrors(block: () -> T): T =
    try {
        block()
    } catch (e: RecommendationException) {
        throw e.asRoomError()
    }

internal fun RecommendationException.asRoomError(): AppException =
    when (error) {
        RecommendationError.UNKNOWN_STATION -> {
            AppException(ErrorKind.CONFLICT, "STATION_UNAVAILABLE", "참가자의 출발역이 현재 데이터에 없습니다", this)
        }

        RecommendationError.PEOPLE_COUNT -> {
            AppException(ErrorKind.CONFLICT, "NOT_ENOUGH_PARTICIPANTS", "참가자가 2명 이상이어야 합니다", this)
        }

        RecommendationError.INVALID_NICKNAME -> {
            AppException(ErrorKind.INVALID, "INVALID_NICKNAME", "별칭이 올바르지 않습니다", this)
        }

        RecommendationError.FAVOR_TARGET_REQUIRED -> {
            AppException(ErrorKind.INVALID, "FAVOR_TARGET_REQUIRED", "우대 대상이 필요합니다", this)
        }

        RecommendationError.FAVOR_TARGET_UNKNOWN -> {
            AppException(ErrorKind.INVALID, "FAVOR_TARGET_UNKNOWN", "우대 대상이 참가자에 없습니다", this)
        }
    }
