package app.banbanyeok.server.app.http

import app.banbanyeok.server.app.application.AppException
import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.app.application.StationDirectory
import app.banbanyeok.server.artifact.PublishedArtifacts
import app.banbanyeok.server.recommendation.RecommendParticipant
import app.banbanyeok.server.recommendation.RecommendRequest
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.room.AnonUserService
import app.banbanyeok.server.room.ErrorKind
import app.banbanyeok.server.room.Outcome
import app.banbanyeok.server.room.OutcomeKind
import app.banbanyeok.server.room.RoomService
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.header
import io.ktor.server.request.receive
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.serializer

fun Route.apiRoutes(
    services: ApiServices,
    idempotency: IdempotencyCache,
) {
    // Cloud Run 점검과 웹의 서버 깨우기용. 계약에서는 /v1/healthz로 문서화돼 있고 루트 경로는 같은 응답이다.
    get("/healthz") { call.respondText("ok", ContentType.Text.Plain) }
    route("/v1") {
        get("/healthz") { call.respondText("ok", ContentType.Text.Plain) }
        anonRoutes(services)
        roomRoutes(services, idempotency)
        resultRoutes(services)
        dataRoutes(services)
    }
}

private fun Route.anonRoutes(services: ApiServices) {
    post("/anon") {
        val issued = services.anonUsers.issue()
        call.respond(HttpStatusCode.Created, AnonCreatedDto(issued.anonUserId, issued.deviceToken))
    }
}

private fun Route.roomRoutes(
    services: ApiServices,
    idempotency: IdempotencyCache,
) {
    post("/rooms") {
        call.respondCreated(idempotency) {
            val created = services.rooms.create(call.receive<RoomCreateRequestDto>().toCommand(call.bearerToken()))
            RoomCreatedDto(
                created.roomId,
                created.hostToken,
                created.participantId,
                created.participantToken,
                created.expiresAt.toString(),
            )
        }
    }
    route("/rooms/{roomId}") {
        get { call.respond(services.rooms.get(call.roomId(), call.bearerToken()).toDto(services.directory)) }
        patch {
            val patch = call.receive<JsonObject>().toRoomPatch()
            call.respond(services.rooms.updateRoom(call.roomId(), call.bearerToken(), patch).toDto(services.directory))
        }
        delete {
            services.rooms.delete(call.roomId(), call.bearerToken())
            call.respond(HttpStatusCode.NoContent)
        }
        participantRoutes(services, idempotency)
    }
}

private fun Route.participantRoutes(
    services: ApiServices,
    idempotency: IdempotencyCache,
) {
    route("/participants") {
        post {
            call.respondCreated(idempotency) {
                val input = call.receive<ParticipantInputDto>().toInput()
                val joined = services.rooms.join(call.roomId(), input, call.bearerToken())
                JoinedDto(joined.participantId, joined.participantToken)
            }
        }
        route("/{participantId}") {
            put {
                val input = call.receive<ParticipantInputDto>().toInput()
                val updated =
                    services.rooms.updateParticipant(call.roomId(), call.participantId(), call.bearerToken(), input)
                call.respond(updated.toDto(services.directory))
            }
            delete {
                services.rooms.removeParticipant(call.roomId(), call.participantId(), call.bearerToken())
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
    post("/outcome") {
        val body = call.receive<OutcomeRequestDto>()
        val kind =
            OutcomeKind.entries.firstOrNull { it.name.lowercase() == body.outcome }
                ?: throw AppException(
                    ErrorKind.INVALID,
                    "INVALID_OUTCOME",
                    "outcome은 top1, top3, other, none 중 하나여야 합니다",
                )
        services.rooms.recordOutcome(call.roomId(), call.bearerToken(), Outcome(kind, body.stationCode))
        call.respond(HttpStatusCode.NoContent)
    }
}

private fun Route.resultRoutes(services: ApiServices) {
    get("/rooms/{roomId}/result") {
        val mode = call.request.queryParameters["mode"]?.let(::requireRecommendMode)
        val result =
            services.results.result(
                call.roomId(),
                call.bearerToken(),
                mode,
                call.request.queryParameters["favor"],
            )
        call.respond(result.toDto(services.directory))
    }
    post("/recommend") {
        val body = call.receive<RecommendRequestDto>()
        val people = body.origins.mapIndexed { index, code -> RecommendParticipant(index.toString(), null, code) }
        val request = RecommendRequest(people, requireRecommendMode(body.mode), body.favorIndex?.toString())
        call.respond(services.recommendation.recommend(request).toStatelessDto(body.origins, services.directory))
    }
}

private fun Route.dataRoutes(services: ApiServices) {
    get("/manifest") {
        val manifest = services.published.manifest
        call.response.header(HttpHeaders.ETag, manifest.etag)
        call.response.header(HttpHeaders.CacheControl, "public, max-age=60")
        if (call.request
                .header(HttpHeaders.IfNoneMatch)
                ?.split(',')
                ?.any { it.trim() == manifest.etag } == true
        ) {
            call.respond(HttpStatusCode.NotModified)
        } else {
            call.respondBytes(manifest.content, ContentType.Application.Json)
        }
    }
    get("/data/{version}/{file}") {
        val version = requireNotNull(call.parameters["version"])
        val file = services.published.dataFile(version, requireNotNull(call.parameters["file"]))
        if (file == null) {
            call.respondError(HttpStatusCode.NotFound, "NOT_FOUND", "찾을 수 없습니다")
        } else {
            call.response.header(HttpHeaders.ETag, file.etag)
            call.response.header(HttpHeaders.CacheControl, "public, max-age=31536000, immutable")
            call.respondBytes(file.content, ContentType.parse(file.contentType))
        }
    }
}

private fun ApplicationCall.roomId(): String = requireNotNull(parameters["roomId"])

private fun ApplicationCall.participantId(): String = requireNotNull(parameters["participantId"])

private const val MAX_IDEMPOTENCY_KEY = 64

/**
 * 201로 응답하는 변경 요청. `Idempotency-Key`가 있으면 같은 키·메서드·경로의 재시도에 처음 응답을 그대로 돌려준다(성공 응답만 저장).
 */
private suspend inline fun <reified T : Any> ApplicationCall.respondCreated(
    cache: IdempotencyCache,
    produce: () -> T,
) {
    val key = request.header("Idempotency-Key")
    if (key == null) {
        respond(HttpStatusCode.Created, produce())
        return
    }
    if (key.isBlank() || key.length > MAX_IDEMPOTENCY_KEY) {
        throw AppException(
            ErrorKind.INVALID,
            "INVALID_IDEMPOTENCY_KEY",
            "Idempotency-Key는 1~${MAX_IDEMPOTENCY_KEY}자여야 합니다",
        )
    }
    val scoped = "${request.local.method.value} ${request.local.uri} $key"
    val body =
        cache.find(scoped)?.body
            ?: apiJson.encodeToString(serializer<T>(), produce()).also { cache.store(scoped, StoredResponse(it)) }
    respondText(body, ContentType.Application.Json, HttpStatusCode.Created)
}
