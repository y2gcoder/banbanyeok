package app.banbanyeok.server.app.http

import app.banbanyeok.server.app.application.AppException
import app.banbanyeok.server.recommendation.RecommendationError
import app.banbanyeok.server.recommendation.RecommendationException
import app.banbanyeok.server.room.ErrorKind
import app.banbanyeok.server.room.RoomException
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.withCharset
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.install
import io.ktor.server.application.pluginOrNull
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.plugins.CannotTransformContentToTypeException
import io.ktor.server.plugins.PayloadTooLargeException
import io.ktor.server.plugins.UnsupportedMediaTypeException
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.path
import io.ktor.server.response.header
import io.ktor.server.response.respondText
import io.ktor.server.routing.HttpMethodRouteSelector
import io.ktor.server.routing.PathSegmentConstantRouteSelector
import io.ktor.server.routing.PathSegmentParameterRouteSelector
import io.ktor.server.routing.RoutingNode
import io.ktor.server.routing.RoutingRoot
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
    val problem = ProblemDto(ProblemTypes.typeUri(code), ProblemTypes.title(code), status.value, message, code)
    respondText(apiJson.encodeToString(ProblemDto.serializer(), problem), PROBLEM_JSON, status)
}

private val PROBLEM_JSON = ContentType("application", "problem+json").withCharset(Charsets.UTF_8)

/**
 * 모든 오류는 `application/problem+json`(`{type, title, status, detail, code}`)으로 돌려준다. 예상하지 못한 오류의 내용은
 * 응답에 싣지 않고 로그에만 남긴다.
 *
 * 라우트 밖에서 Ktor 플러그인이 본문 없이 끝내는 응답(CORS 403, 콘텐츠 협상 406, 경로·메서드 404·405)도 `status(...)`로 같은 형식에 맞춘다.
 * 응답은 `respondText`로 직접 직렬화한다. 콘텐츠 협상을 다시 거치지 않으므로 요청의 `Accept`가 무엇이든(예: 406의 원인인 `text/plain`)
 * 오류 본문은 항상 `application/problem+json`이다.
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
        // 요청의 Content-Type을 읽을 변환기가 없다(예: `text/plain`으로 보낸 JSON). 본문 문법 오류(400)와 다르다.
        exception<UnsupportedMediaTypeException> { call, _ -> call.respondUnsupportedMediaType() }
        exception<CannotTransformContentToTypeException> { call, _ -> call.respondUnsupportedMediaType() }
        exception<Throwable> { call, e ->
            logger.error("처리하지 못한 오류", e)
            call.respondError(HttpStatusCode.InternalServerError, "INTERNAL_ERROR", "서버 오류가 발생했습니다")
        }
        status(
            HttpStatusCode.NotFound,
        ) { call, _ -> call.respondError(HttpStatusCode.NotFound, "NOT_FOUND", "찾을 수 없습니다") }
        status(HttpStatusCode.MethodNotAllowed) { call, _ ->
            // RFC 9110 §15.5.6: 405는 이 경로가 지원하는 메서드를 `Allow`로 알려야 한다.
            val allowed = call.allowedMethods()
            if (allowed.isNotEmpty()) call.response.header(HttpHeaders.Allow, allowed.joinToString(", "))
            call.respondError(HttpStatusCode.MethodNotAllowed, "METHOD_NOT_ALLOWED", "허용되지 않는 메서드입니다")
        }
        // CORS 플러그인이 허용 목록에 없는 출처·메서드를 본문 없이 403으로 끝낸다. 요청의 출처·메서드 값은 싣지 않는다.
        // 방 권한 403(`FORBIDDEN`)은 라우트가 본문과 함께 답하므로 여기로 오지 않는다.
        status(HttpStatusCode.Forbidden) { call, _ ->
            call.respondError(HttpStatusCode.Forbidden, "CORS_REJECTED", "허용되지 않는 출처 또는 메서드의 요청입니다")
        }
        // 콘텐츠 협상이 `Accept`에 맞는 표현을 만들지 못했다. `Accept`가 오류 형식(application/problem+json)을 받아 주더라도
        // 성공 응답은 application/json뿐이라 같은 406이 난다.
        status(HttpStatusCode.NotAcceptable) { call, _ ->
            call.respondError(HttpStatusCode.NotAcceptable, "NOT_ACCEPTABLE", "요청한 응답 형식(Accept)으로 답할 수 없습니다")
        }
    }
}

private suspend fun ApplicationCall.respondUnsupportedMediaType() =
    respondError(
        HttpStatusCode.UnsupportedMediaType,
        "UNSUPPORTED_MEDIA_TYPE",
        "요청 본문의 Content-Type은 application/json이어야 합니다",
    )

/** 이 요청의 경로에서 라우트가 받는 메서드(405의 `Allow`). 경로 조각이 모두 맞는 끝 노드의 메서드 선택자를 모은다. */
private fun ApplicationCall.allowedMethods(): List<String> {
    val root = application.pluginOrNull(RoutingRoot) ?: return emptyList()
    val segments = request.path().split('/').filter { it.isNotEmpty() }
    return root
        .methodsFor(segments)
        .map { it.value }
        .distinct()
        .sorted()
}

private fun RoutingNode.methodsFor(segments: List<String>): List<HttpMethod> =
    when (val selector = selector) {
        is HttpMethodRouteSelector -> {
            if (segments.isEmpty()) listOf(selector.method) else emptyList()
        }

        is PathSegmentConstantRouteSelector -> {
            if (segments.firstOrNull() == selector.value) {
                children.flatMap { it.methodsFor(segments.drop(1)) }
            } else {
                emptyList()
            }
        }

        // `{param}`은 경로 조각 하나를 받는다. 남은 조각이 없으면 이 아래 메서드는 이 요청의 경로가 아니다.
        is PathSegmentParameterRouteSelector -> {
            if (segments.isNotEmpty()) children.flatMap { it.methodsFor(segments.drop(1)) } else emptyList()
        }

        else -> {
            children.flatMap { it.methodsFor(segments) }
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
