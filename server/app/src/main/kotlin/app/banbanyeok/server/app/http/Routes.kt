package app.banbanyeok.server.app.http

import app.banbanyeok.server.app.application.AppException
import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.room.AnonUserService
import app.banbanyeok.server.room.ErrorKind
import app.banbanyeok.server.room.Outcome
import app.banbanyeok.server.room.OutcomeKind
import app.banbanyeok.server.room.RoomService
import app.banbanyeok.server.room.RoomView
import app.banbanyeok.server.room.ShareVersion
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
    anonEnabled: Boolean = false,
) {
    // Cloud Run 점검과 웹의 서버 깨우기용. 계약에서는 /v1/healthz로 문서화돼 있고 루트 경로는 같은 응답이다.
    get("/healthz") { call.respondText("ok", ContentType.Text.Plain) }
    route("/v1") {
        get("/healthz") { call.respondText("ok", ContentType.Text.Plain) }
        // 익명 사용자 발급은 앱이 방 기능을 내놓을 때까지 닫아 둔다(ANON_ENABLED, 기본 끔). 닫으면 등록하지 않아 404다.
        if (anonEnabled) anonRoutes(services)
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

private fun Route.roomCreationRoute(
    rooms: RoomService,
    idempotency: IdempotencyCache,
) {
    post("/rooms") {
        // 본문은 재생보다 먼저 읽고 숨김 규칙을 본다: 같은 키의 재시도라도 숨긴 본문에 숨기지 않은 성공을 재생하지 않는다(ADR-0007).
        val command = call.receive<RoomCreateRequestDto>().toCommand(call.bearerToken())
        rooms.checkNewParticipant(command.host)
        call.respondCreated<RoomCreatedDto>(idempotency, replay = { cached ->
            val expiresAt =
                rooms.creationReplayExpiry(
                    cached.roomId,
                    cached.hostToken,
                    cached.participantId,
                    cached.participantToken,
                )
            expiresAt?.let { cached.copy(expiresAt = it.toString()) }
        }) {
            val created = rooms.create(command)
            RoomCreatedDto(
                created.roomId,
                created.hostToken,
                created.participantId,
                created.participantToken,
                created.expiresAt.toString(),
                created.roomHash,
            )
        }
    }
}

private fun Route.roomRoutes(
    services: ApiServices,
    idempotency: IdempotencyCache,
) {
    roomCreationRoute(services.rooms, idempotency)
    route("/rooms/{roomId}") {
        get { call.respondRoom(services, services.rooms.get(call.roomId(), call.bearerToken())) }
        patch {
            val patch = call.receive<JsonObject>().toRoomPatch()
            call.respondRoom(services, services.rooms.updateRoom(call.roomId(), call.bearerToken(), patch))
        }
        delete {
            services.rooms.delete(call.roomId(), call.bearerToken())
            call.respond(HttpStatusCode.NoContent)
        }
        put("/decision") {
            val body = call.receive<DecisionRequestDto>()
            if (body.seenVersion < 0) {
                throw AppException(ErrorKind.INVALID, "INVALID_REQUEST", "seenVersion은 0 이상이어야 합니다")
            }
            val room =
                services.rooms.decide(
                    call.roomId(),
                    call.bearerToken(),
                    body.stationCode,
                    ShareVersion(body.seenVersion),
                )
            call.respondRoom(services, room)
        }
        // 멱등은 방의 세대·회차로 한다(인스턴스와 상관없음). 메모리 응답 캐시를 쓰지 않으므로 재시도도 늘 방장 확인을 지나고 지금 방을 받는다.
        post("/favor-draw") {
            call.request.header("Idempotency-Key")?.let(::requireIdempotencyKey)
            val body = call.receive<FavorDrawRequestDto>()
            if (body.round < 1 || body.generation < 0) {
                throw AppException(ErrorKind.INVALID, "INVALID_REQUEST", "generation은 0 이상, round는 1 이상이어야 합니다")
            }
            call.respondRoom(
                services,
                services.rooms.drawFavor(call.roomId(), call.bearerToken(), body.generation, body.round),
            )
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
            // 방 만들기와 같다: 재생보다 먼저 숨김 규칙을 본다(ADR-0007).
            val input = call.receive<ParticipantInputDto>().toInput()
            services.rooms.checkNewParticipant(input)
            call.respondCreated<JoinedDto>(idempotency, replay = { cached ->
                services.rooms.checkJoinReplay(
                    call.roomId(),
                    cached.participantId,
                    cached.participantToken,
                    input.originCode,
                )
                cached
            }) {
                val joined = services.rooms.join(call.roomId(), input, call.bearerToken())
                JoinedDto(joined.participantId, joined.participantToken)
            }
        }
        route("/{participantId}") {
            put {
                val input = call.receive<ParticipantInputDto>().toInput()
                val updated =
                    services.rooms.updateParticipant(call.roomId(), call.participantId(), call.bearerToken(), input)
                // 표시 이름은 방 전체(순번·같은 역 번호)로 정해지므로 방을 다시 읽어 그 사람의 항목을 돌려준다.
                val room = services.rooms.get(call.roomId(), call.bearerToken())
                call.respond(room.participantDtos(services.stations).first { it.participantId == updated.id })
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
            roomRecommendationErrors {
                services.results.result(
                    call.roomId(),
                    call.bearerToken(),
                    mode,
                    call.request.queryParameters["favor"],
                )
            }
        call.respond(result.toDto(services.stations))
    }
    // 토큰을 읽지 않는다. 미리보기는 누가 묻든 같은 값이어야 한다(본인이 숨긴 출발역도 가린다).
    get("/rooms/{roomId}/preview") {
        val preview: RoomPreviewDto =
            roomRecommendationErrors { services.results.preview(call.roomId()) }.toDto(services.stations)
        call.respond(preview)
    }
    post("/recommend") {
        val request = call.receive<RecommendRequestDto>().toStatelessRequest()
        val result = statelessRecommendationErrors { services.stateless.recommend(request) }
        call.respond(result.toDto(services.stations))
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

private suspend fun ApplicationCall.respondRoom(
    services: ApiServices,
    room: RoomView,
) = respond(room.toDto(services.stations, services.times.resolve(room.meetingDate, room.meetingTime, room.meetingBand)))

private fun ApplicationCall.roomId(): String = requireNotNull(parameters["roomId"])

private fun ApplicationCall.participantId(): String = requireNotNull(parameters["participantId"])

private const val MAX_IDEMPOTENCY_KEY = 64

/**
 * 201로 응답하는 변경 요청. 같은 키·메서드·URI의 재시도는 [replay]로 현재 상태를 확인한다.
 */
private suspend inline fun <reified T : Any> ApplicationCall.respondCreated(
    cache: IdempotencyCache,
    crossinline replay: suspend (T) -> T?,
    crossinline produce: suspend () -> T,
) {
    val key = request.header("Idempotency-Key")
    if (key == null) {
        respond(HttpStatusCode.Created, produce())
        return
    }
    requireIdempotencyKey(key)
    val scoped = "${request.local.method.value} ${request.local.uri} $key"
    val codec = serializer<T>()
    val body =
        cache.resolve(scoped, replay = { encoded ->
            val cached = apiJson.decodeFromString(codec, encoded)
            replay(cached)?.let { if (it == cached) encoded else apiJson.encodeToString(codec, it) }
        }) {
            apiJson.encodeToString(codec, produce())
        }
    respondText(body, ContentType.Application.Json, HttpStatusCode.Created)
}

private fun requireIdempotencyKey(key: String) {
    if (key.isBlank() || key.length > MAX_IDEMPOTENCY_KEY) {
        throw AppException(
            ErrorKind.INVALID,
            "INVALID_IDEMPOTENCY_KEY",
            "Idempotency-Key는 1~${MAX_IDEMPOTENCY_KEY}자여야 합니다",
        )
    }
}
