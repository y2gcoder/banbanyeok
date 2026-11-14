package app.banbanyeok.server.app

import app.banbanyeok.server.app.application.AppException
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.RecommendRequest
import app.banbanyeok.server.recommendation.RecommendationError
import app.banbanyeok.server.recommendation.RecommendationException
import app.banbanyeok.server.room.Change
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.CreatedRoom
import app.banbanyeok.server.room.ErrorKind
import app.banbanyeok.server.room.IssuedAnonUser
import app.banbanyeok.server.room.JoinedRoom
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.ParticipantView
import app.banbanyeok.server.room.RoomError
import app.banbanyeok.server.room.RoomException
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomPatch
import app.banbanyeok.server.room.RoomView
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.slot
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.time.LocalDate

private val expires = Instant.parse("2026-11-21T03:00:00Z")
private const val ROOM_ID = "abcdefghjk"
private val origin1 get() = DevArtifacts.origins.first()
private val origin2 get() = DevArtifacts.origins.last()

private fun view(vararg participants: ParticipantView) =
    RoomView(
        id = ROOM_ID,
        mode = RoomMode.FAIR,
        favorParticipantId = null,
        locked = false,
        meetingDate = null,
        expiresAt = expires,
        dataVersion = "20261112.6",
        participants = participants.toList(),
    )

private fun person(
    id: String = "p00001",
    origin: String? = origin1,
    hidden: Boolean = false,
    host: Boolean = true,
    self: Boolean = false,
) = ParticipantView(id, "민수", hidden, origin, host, self)

private fun errorCode(body: String) =
    Json
        .parseToJsonElement(body)
        .jsonObject["code"]!!
        .jsonPrimitive.content

class ApiHttpTest :
    DescribeSpec({
        describe("anonymous users") {
            it("issues an anonymous user and matches the contract") {
                withMockedApi { services ->
                    coEvery { services.anon.issue() } returns IssuedAnonUser("u_abc", "device-token")
                    val response = client.json(HttpMethod.Post, "/v1/anon")
                    response.status shouldBe HttpStatusCode.Created
                    response.bodyAsText() shouldContain "device-token"
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/anon", response)
                    response.headers[HttpHeaders.CacheControl] shouldBe "no-store"
                }
            }
        }

        describe("creating a room") {
            val body =
                """{"mode":"fair","meetingDate":"2026-12-01","host":{"nickname":"민수","originCode":"$origin1"},""" +
                    """"expectedCount":3}"""

            it("passes the parsed command and the bearer device token to the service") {
                withMockedApi { services ->
                    val command = slot<CreateRoomCommand>()
                    coEvery { services.rooms.create(capture(command)) } returns
                        CreatedRoom(ROOM_ID, "host-tok", "p00001", "part-tok", expires)
                    val response = client.json(HttpMethod.Post, "/v1/rooms", body, token = "device-tok")
                    response.status shouldBe HttpStatusCode.Created
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/rooms", response)
                    command.captured.mode shouldBe RoomMode.FAIR
                    command.captured.meetingDate shouldBe LocalDate.parse("2026-12-01")
                    command.captured.expectedCount shouldBe 3
                    command.captured.deviceToken shouldBe "device-tok"
                    command.captured.host shouldBe ParticipantInput("민수", origin1, false)
                }
            }

            it("answers a retried request with the same Idempotency-Key from the first response") {
                withMockedApi { services ->
                    coEvery { services.rooms.create(any()) } returns
                        CreatedRoom(ROOM_ID, "host-tok", "p00001", "part-tok", expires)
                    val first =
                        client.json(
                            HttpMethod.Post,
                            "/v1/rooms",
                            body,
                        ) { headers.append("Idempotency-Key", "key-1") }
                    val second =
                        client.json(
                            HttpMethod.Post,
                            "/v1/rooms",
                            body,
                        ) { headers.append("Idempotency-Key", "key-1") }
                    second.status shouldBe HttpStatusCode.Created
                    second.bodyAsText() shouldBe first.bodyAsText()
                    coVerify(exactly = 1) { services.rooms.create(any()) }
                    val tooLong =
                        client.json(
                            HttpMethod.Post,
                            "/v1/rooms",
                            body,
                        ) { headers.append("Idempotency-Key", "k".repeat(65)) }
                    tooLong.status shouldBe HttpStatusCode.BadRequest
                    errorCode(tooLong.bodyAsText()) shouldBe "INVALID_IDEMPOTENCY_KEY"
                }
            }

            it("rejects a malformed body, a missing field and an unknown mode with a documented error") {
                withMockedApi {
                    val malformed = client.json(HttpMethod.Post, "/v1/rooms", "{not json")
                    malformed.status shouldBe HttpStatusCode.BadRequest
                    errorCode(malformed.bodyAsText()) shouldBe "INVALID_REQUEST"
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/rooms", malformed)

                    val missing = client.json(HttpMethod.Post, "/v1/rooms", """{"mode":"fair"}""")
                    missing.status shouldBe HttpStatusCode.BadRequest
                    errorCode(missing.bodyAsText()) shouldBe "INVALID_REQUEST"

                    val mode =
                        client.json(
                            HttpMethod.Post,
                            "/v1/rooms",
                            """{"mode":"loud","host":{"originCode":"$origin1"}}""",
                        )
                    errorCode(mode.bodyAsText()) shouldBe "INVALID_MODE"
                    val date =
                        client.json(
                            HttpMethod.Post,
                            "/v1/rooms",
                            """{"mode":"fair","meetingDate":"soon","host":{"originCode":"$origin1"}}""",
                        )
                    errorCode(date.bodyAsText()) shouldBe "INVALID_MEETING_DATE"
                }
            }
        }

        describe("reading a room") {
            it("returns the room with station names and passes an optional participant token") {
                withMockedApi { services ->
                    val token = slot<String?>()
                    coEvery { services.rooms.get(ROOM_ID, captureNullable(token)) } returns
                        view(person(), person("p00002", origin = null, hidden = true, host = false))
                    val response = client.json(HttpMethod.Get, "/v1/rooms/$ROOM_ID", token = "part-tok")
                    response.status shouldBe HttpStatusCode.OK
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/$ROOM_ID", response)
                    token.captured shouldBe "part-tok"
                    val participants =
                        Json
                            .parseToJsonElement(
                                response.bodyAsText(),
                            ).jsonObject["participants"]
                            .toString()
                    participants shouldContain "\"originCode\":null"
                    participants shouldContain "\"originName\":null"
                    response.headers[HttpHeaders.CacheControl] shouldBe "no-store"
                }
            }

            it("treats a missing or non-Bearer Authorization header as anonymous") {
                withMockedApi { services ->
                    val seen = mutableListOf<String?>()
                    coEvery { services.rooms.get(ROOM_ID, captureNullable(slot())) } answers {
                        seen += secondArg<String?>()
                        view(person())
                    }
                    client.json(HttpMethod.Get, "/v1/rooms/$ROOM_ID")
                    client.json(
                        HttpMethod.Get,
                        "/v1/rooms/$ROOM_ID",
                    ) { headers.append(HttpHeaders.Authorization, "Basic abc") }
                    client.json(
                        HttpMethod.Get,
                        "/v1/rooms/$ROOM_ID",
                    ) { headers.append(HttpHeaders.Authorization, "bearer lower-case") }
                    seen shouldBe listOf(null, null, "lower-case")
                }
            }

            it("maps a missing room to the documented 404 error body") {
                withMockedApi { services ->
                    coEvery { services.rooms.get(any(), any()) } throws
                        RoomException(RoomError.ROOM_NOT_FOUND, "방을 찾을 수 없습니다")
                    val response = client.json(HttpMethod.Get, "/v1/rooms/$ROOM_ID")
                    response.status shouldBe HttpStatusCode.NotFound
                    errorCode(response.bodyAsText()) shouldBe "ROOM_NOT_FOUND"
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/$ROOM_ID", response)
                }
            }
        }

        describe("authentication and errors") {
            it("answers 401 with WWW-Authenticate, 403, and 409 as documented") {
                withMockedApi { services ->
                    coEvery { services.rooms.delete(ROOM_ID, null) } throws
                        RoomException(RoomError.UNAUTHORIZED, "인증이 필요합니다")
                    val unauthorized = client.json(HttpMethod.Delete, "/v1/rooms/$ROOM_ID")
                    unauthorized.status shouldBe HttpStatusCode.Unauthorized
                    unauthorized.headers[HttpHeaders.WWWAuthenticate] shouldBe "Bearer"
                    OpenApiContract.assertValid(HttpMethod.Delete, "/v1/rooms/$ROOM_ID", unauthorized)

                    coEvery { services.rooms.delete(ROOM_ID, "wrong") } throws
                        RoomException(RoomError.FORBIDDEN, "방장만 할 수 있습니다")
                    val forbidden = client.json(HttpMethod.Delete, "/v1/rooms/$ROOM_ID", token = "wrong")
                    forbidden.status shouldBe HttpStatusCode.Forbidden
                    OpenApiContract.assertValid(HttpMethod.Delete, "/v1/rooms/$ROOM_ID", forbidden)

                    coEvery { services.rooms.join(ROOM_ID, any(), any()) } throws
                        RoomException(RoomError.ROOM_FULL, "방이 가득 찼습니다")
                    val full =
                        client.json(
                            HttpMethod.Post,
                            "/v1/rooms/$ROOM_ID/participants",
                            """{"originCode":"$origin1"}""",
                        )
                    full.status shouldBe HttpStatusCode.Conflict
                    errorCode(full.bodyAsText()) shouldBe "ROOM_FULL"
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/rooms/$ROOM_ID/participants", full)
                }
            }

            it("does not leak the message of an unexpected failure") {
                withMockedApi { services ->
                    coEvery { services.rooms.get(any(), any()) } throws
                        IllegalStateException("jdbc:postgresql://secret-host/db password=hunter2")
                    val response = client.json(HttpMethod.Get, "/v1/rooms/$ROOM_ID")
                    response.status shouldBe HttpStatusCode.InternalServerError
                    errorCode(response.bodyAsText()) shouldBe "INTERNAL_ERROR"
                    response.bodyAsText() shouldNotContain "hunter2"
                }
            }

            it("answers unknown routes with a JSON error") {
                withMockedApi {
                    val response = client.json(HttpMethod.Get, "/v1/nothing-here")
                    response.status shouldBe HttpStatusCode.NotFound
                    errorCode(response.bodyAsText()) shouldBe "NOT_FOUND"
                }
            }
        }

        describe("joining, editing and leaving") {
            it("joins with a device token and returns the participant token") {
                withMockedApi { services ->
                    val input = slot<ParticipantInput>()
                    coEvery { services.rooms.join(ROOM_ID, capture(input), "device-tok") } returns
                        JoinedRoom("p00002", "part-tok")
                    val response =
                        client.json(
                            HttpMethod.Post,
                            "/v1/rooms/$ROOM_ID/participants",
                            """{"nickname":"지연","originCode":"$origin2","hidden":true}""",
                            token = "device-tok",
                        )
                    response.status shouldBe HttpStatusCode.Created
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/rooms/$ROOM_ID/participants", response)
                    input.captured shouldBe ParticipantInput("지연", origin2, true)
                }
            }

            it("updates a participant and removes one with no content") {
                withMockedApi { services ->
                    coEvery { services.rooms.updateParticipant(ROOM_ID, "p00002", "part-tok", any()) } returns
                        person("p00002", origin2, hidden = true, host = false, self = true)
                    val path = "/v1/rooms/$ROOM_ID/participants/p00002"
                    val updated =
                        client.json(
                            HttpMethod.Put,
                            path,
                            """{"originCode":"$origin2","hidden":true}""",
                            token = "part-tok",
                        )
                    updated.status shouldBe HttpStatusCode.OK
                    OpenApiContract.assertValid(HttpMethod.Put, path, updated)

                    coEvery { services.rooms.removeParticipant(ROOM_ID, "p00002", "part-tok") } returns Unit
                    val removed = client.json(HttpMethod.Delete, path, token = "part-tok")
                    removed.status shouldBe HttpStatusCode.NoContent
                    removed.bodyAsText() shouldBe ""
                    OpenApiContract.assertValid(HttpMethod.Delete, path, removed)
                }
            }
        }

        describe("changing the room") {
            it("distinguishes a missing meetingDate from an explicit null") {
                withMockedApi { services ->
                    val patches = mutableListOf<RoomPatch>()
                    coEvery { services.rooms.updateRoom(ROOM_ID, "host-tok", capture(patches)) } returns view(person())
                    client.json(HttpMethod.Patch, "/v1/rooms/$ROOM_ID", """{"locked":true}""", token = "host-tok")
                    client.json(HttpMethod.Patch, "/v1/rooms/$ROOM_ID", """{"meetingDate":null}""", token = "host-tok")
                    client.json(
                        HttpMethod.Patch,
                        "/v1/rooms/$ROOM_ID",
                        """{"mode":"favor","favorTarget":"host","meetingDate":"2026-12-05"}""",
                        token = "host-tok",
                    )
                    patches[0] shouldBe RoomPatch(locked = true)
                    patches[1].meetingDate shouldBe Change.Set(null)
                    patches[2] shouldBe
                        RoomPatch(RoomMode.FAVOR, "host", null, Change.Set(LocalDate.parse("2026-12-05")))
                }
            }

            it("rejects a patch with wrongly typed fields") {
                withMockedApi {
                    val response =
                        client.json(
                            HttpMethod.Patch,
                            "/v1/rooms/$ROOM_ID",
                            """{"mode":1}""",
                            token = "host-tok",
                        )
                    response.status shouldBe HttpStatusCode.BadRequest
                    OpenApiContract.assertValid(HttpMethod.Patch, "/v1/rooms/$ROOM_ID", response)
                }
            }
        }

        describe("results") {
            it("passes mode and favor query parameters and rejects an unknown mode") {
                withMockedApi { services ->
                    coEvery { services.results.result(ROOM_ID, "part-tok", RecommendMode.FAVOR, "p00002") } throws
                        AppException(ErrorKind.CONFLICT, "NOT_ENOUGH_PARTICIPANTS", "참가자가 2명 이상이어야 합니다")
                    val conflict =
                        client.json(
                            HttpMethod.Get,
                            "/v1/rooms/$ROOM_ID/result?mode=favor&favor=p00002",
                            token = "part-tok",
                        )
                    conflict.status shouldBe HttpStatusCode.Conflict
                    errorCode(conflict.bodyAsText()) shouldBe "NOT_ENOUGH_PARTICIPANTS"
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/$ROOM_ID/result", conflict)

                    val bad = client.json(HttpMethod.Get, "/v1/rooms/$ROOM_ID/result?mode=loud")
                    bad.status shouldBe HttpStatusCode.BadRequest
                    errorCode(bad.bodyAsText()) shouldBe "INVALID_MODE"
                }
            }

            it("answers a stateless recommendation with participants identified by input index") {
                withMockedApi {
                    // 실제 추천 서비스를 쓴다: 이 테스트는 HTTP 모양과 계약을 확인한다.
                    val services = MockedServices()
                    val real =
                        app.banbanyeok.server.recommendation.RecommendationService(
                            DevArtifacts.directory.travel,
                            DevArtifacts.directory,
                        )
                    val api =
                        app.banbanyeok.server.app.http.ApiServices(
                            services.anon,
                            services.rooms,
                            services.results,
                            real,
                            DevArtifacts.directory,
                            DevArtifacts.published,
                        )
                    val body = """{"origins":["$origin1","$origin2"],"mode":"fair"}"""
                    io.ktor.server.testing.testApplication {
                        application { apiModule(testConfig(), api) }
                        val response = client.json(HttpMethod.Post, "/v1/recommend", body)
                        response.status shouldBe HttpStatusCode.OK
                        OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", response)
                        val participants =
                            Json
                                .parseToJsonElement(
                                    response.bodyAsText(),
                                ).jsonObject["participants"]
                                .toString()
                        participants shouldContain "\"participantId\":\"0\""
                        participants shouldContain "\"participantId\":\"1\""
                    }
                }
            }

            it("maps recommendation validation errors to 400") {
                withMockedApi { services ->
                    every { services.recommendation.recommend(any()) } throws
                        RecommendationException(RecommendationError.UNKNOWN_STATION, "알 수 없는 출발역이 있습니다")
                    val response =
                        client.json(
                            HttpMethod.Post,
                            "/v1/recommend",
                            """{"origins":["zzz","yyy"],"mode":"fair"}""",
                        )
                    response.status shouldBe HttpStatusCode.BadRequest
                    errorCode(response.bodyAsText()) shouldBe "INVALID_STATION"
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", response)
                }
            }

            it("passes the favor index as the favored person's id") {
                withMockedApi { services ->
                    val request = slot<RecommendRequest>()
                    every { services.recommendation.recommend(capture(request)) } throws
                        RecommendationException(RecommendationError.FAVOR_TARGET_UNKNOWN, "x")
                    client.json(
                        HttpMethod.Post,
                        "/v1/recommend",
                        """{"origins":["$origin1","$origin2"],"mode":"favor","favorIndex":1}""",
                    )
                    request.captured.favorId shouldBe "1"
                    request.captured.participants.map { it.id } shouldBe listOf("0", "1")
                }
            }
        }

        describe("published data") {
            it("serves the manifest with an ETag and answers a matching If-None-Match with 304") {
                withMockedApi {
                    val response = client.json(HttpMethod.Get, "/v1/manifest")
                    response.status shouldBe HttpStatusCode.OK
                    response.headers[HttpHeaders.CacheControl] shouldBe "public, max-age=60"
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/manifest", response)
                    val etag = response.headers[HttpHeaders.ETag]!!
                    val notModified =
                        client.json(
                            HttpMethod.Get,
                            "/v1/manifest",
                        ) { headers.append(HttpHeaders.IfNoneMatch, etag) }
                    notModified.status shouldBe HttpStatusCode.NotModified
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/manifest", notModified)
                }
            }

            it("serves immutable data files and a JSON 404 for unknown ones") {
                withMockedApi {
                    val version =
                        DevArtifacts.published.manifest.content
                            .decodeToString()
                            .substringAfter(
                                "\"dataVersion\": \"",
                            ).substringBefore('"')
                    val path = "/v1/data/$version/od.bin"
                    val file = client.json(HttpMethod.Get, path)
                    file.status shouldBe HttpStatusCode.OK
                    file.headers[HttpHeaders.CacheControl] shouldBe "public, max-age=31536000, immutable"
                    OpenApiContract.assertValid(HttpMethod.Get, path, file)
                    val missing = client.json(HttpMethod.Get, "/v1/data/$version/nothing.bin")
                    missing.status shouldBe HttpStatusCode.NotFound
                    errorCode(missing.bodyAsText()) shouldBe "NOT_FOUND"
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/data/$version/nothing.bin", missing)
                }
            }

            it("answers /healthz and /v1/healthz without touching any service") {
                withMockedApi {
                    listOf("/healthz", "/v1/healthz").forEach {
                        val response = client.json(HttpMethod.Get, it)
                        response.status shouldBe HttpStatusCode.OK
                        response.bodyAsText() shouldBe "ok"
                    }
                    OpenApiContract.assertValid(
                        HttpMethod.Get,
                        "/v1/healthz",
                        client.json(HttpMethod.Get, "/v1/healthz"),
                    )
                }
            }
        }
    })
