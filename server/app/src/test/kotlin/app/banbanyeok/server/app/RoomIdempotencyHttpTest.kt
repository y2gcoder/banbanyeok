@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.app

import app.banbanyeok.server.app.application.DailyCounter
import app.banbanyeok.server.app.application.UsageStage
import app.banbanyeok.server.app.counter.BackgroundDailyCounter
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.HttpClient
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Clock

private const val ROOMS = "/v1/rooms"
private const val DRAW_ROOMS = "/v1/draw-rooms"
private const val HOST_INPUT = """{"mode":"fair","host":{"originCode":"03v"}}"""
private const val GUEST_INPUT = """{"originCode":"130"}"""

private fun withRoomApi(
    counter: DailyCounter = DailyCounter {},
    block: suspend HttpClient.() -> Unit,
) {
    val room = RouteRoom("130")
    testApplication {
        application {
            apiModule(
                testConfig(mapOf("RATE_LIMIT_ENABLED" to "false")),
                apiServices(
                    room.fixture.anonService,
                    room.fixture.service,
                    room.results,
                    room.recommendation,
                    DevArtifacts.directory,
                    counter = counter,
                ),
                room.fixture.clock,
            )
        }
        client.block()
    }
}

private suspend fun HttpClient.createRoom() =
    json(HttpMethod.Post, ROOMS, HOST_INPUT) { headers.append("Idempotency-Key", "create-room") }

private suspend fun HttpClient.joinRoom(path: String) =
    json(HttpMethod.Post, "$path/participants", GUEST_INPUT) { headers.append("Idempotency-Key", "join-room") }

private suspend fun HttpResponse.bodyObject() = Json.parseToJsonElement(bodyAsText()).jsonObject

class RoomIdempotencyHttpTest :
    DescribeSpec({
        describe("daily usage") {
            it("responds to recommendations while the counter write is suspended") {
                val started = CompletableDeferred<Unit>()
                BackgroundDailyCounter(Clock.systemUTC(), UnconfinedTestDispatcher()) { _, _ ->
                    started.complete(Unit)
                    awaitCancellation()
                }.use { counter ->
                    withRoomApi(counter) {
                        val request = """{"origins":["03v","130"],"mode":"fair"}"""
                        withTimeout(3000) {
                            json(HttpMethod.Post, "/v1/recommend", request).status shouldBe HttpStatusCode.OK
                            started.await()
                            json(HttpMethod.Post, "/v1/recommend", request).status shouldBe HttpStatusCode.OK
                        }
                    }
                }
            }

            it("counts successful user requests once and excludes synthetic requests, replays and failures") {
                val stages = mutableListOf<UsageStage>()
                withRoomApi({ stages.add(it) }) {
                    val recommend = """{"origins":["03v","130"],"mode":"fair"}"""
                    json(HttpMethod.Post, "/v1/recommend", recommend) {
                        headers.append("X-Banbanyeok-Synthetic", "1")
                    }.status shouldBe HttpStatusCode.OK
                    json(HttpMethod.Post, "/v1/recommend", recommend).status shouldBe HttpStatusCode.OK
                    val created = createRoom().bodyObject()
                    createRoom().bodyObject() shouldBe created
                    val path = "$ROOMS/${created.getValue("roomId").jsonPrimitive.content}"
                    val joined = joinRoom(path).bodyObject()
                    joinRoom(path).bodyObject() shouldBe joined
                    (json(HttpMethod.Post, ROOMS, HOST_INPUT.replace("03v", "zzz")).status.value in 400..499) shouldBe
                        true
                    joinRoom("$ROOMS/missing").status shouldBe HttpStatusCode.NotFound
                    stages shouldBe listOf(UsageStage.RECOMMEND, UsageStage.CREATE_ROOM, UsageStage.JOIN_ROOM)
                }
            }
        }

        describe("room creation retries") {
            it("creates a new room with fresh credentials when the original room was deleted") {
                withRoomApi {
                    val created = createRoom()
                    created.status shouldBe HttpStatusCode.Created
                    val original = created.bodyObject()
                    val roomId = original.getValue("roomId").jsonPrimitive.content
                    val hostToken = original.getValue("hostToken").jsonPrimitive.content
                    json(HttpMethod.Delete, "$ROOMS/$roomId", token = hostToken).status shouldBe
                        HttpStatusCode.NoContent

                    val retried = createRoom()
                    retried.status shouldBe HttpStatusCode.Created
                    OpenApiContract.assertValid(HttpMethod.Post, ROOMS, retried)
                    val replacement = retried.bodyObject()
                    for (field in listOf("roomId", "hostToken", "participantId", "participantToken")) {
                        (replacement.getValue(field) != original.getValue(field)) shouldBe true
                    }
                    (createRoom().bodyObject() == replacement) shouldBe true
                }
            }
        }

        describe("creating a draw room with the other people already entered (#227)") {
            val body =
                """{"host":{"nickname":"지연","originCode":"130"},""" +
                    """"others":[{"nickname":"민수","originCode":"03v"},{"originCode":"225"}],"hostPosition":1}"""

            it("stores every row once, in input order, and a retry with the same key replays the same room") {
                withRoomApi {
                    val first =
                        json(HttpMethod.Post, DRAW_ROOMS, body) { headers.append("Idempotency-Key", "draw-room") }
                    first.status shouldBe HttpStatusCode.Created
                    OpenApiContract.assertValid(HttpMethod.Post, DRAW_ROOMS, first)
                    val retried =
                        json(HttpMethod.Post, DRAW_ROOMS, body) { headers.append("Idempotency-Key", "draw-room") }
                    (retried.bodyAsText() == first.bodyAsText()) shouldBe true
                    val path = "$ROOMS/${first.bodyObject().getValue("roomId").jsonPrimitive.content}"
                    val room = json(HttpMethod.Get, path)
                    OpenApiContract.assertValid(HttpMethod.Get, "$ROOMS/{roomId}", room)
                    val roomBody = room.bodyObject()
                    roomBody.getValue("locked").jsonPrimitive.content shouldBe "true"
                    roomBody.getValue("mode").jsonPrimitive.content shouldBe "favor"
                    roomBody
                        .getValue("favorDraw")
                        .jsonObject["round"]!!
                        .jsonPrimitive.content shouldBe "0"
                    roomBody.getValue("participants").jsonArray.map {
                        val p = it.jsonObject
                        listOf("label", "isHost", "enteredByHost").map { key -> p.getValue(key).jsonPrimitive.content }
                    } shouldBe
                        listOf(
                            listOf("민수", "false", "true"),
                            listOf("지연", "true", "false"),
                            listOf("참가자 3", "false", "true"),
                        )
                }
            }

            it("rejects a hidden row with the same key before replaying the earlier success") {
                withRoomApi {
                    json(
                        HttpMethod.Post,
                        DRAW_ROOMS,
                        body,
                    ) { headers.append("Idempotency-Key", "draw-room") }.status shouldBe
                        HttpStatusCode.Created
                    val hidden = body.replace("""{"originCode":"225"}""", """{"originCode":"225","hidden":true}""")
                    val retried =
                        json(HttpMethod.Post, DRAW_ROOMS, hidden) { headers.append("Idempotency-Key", "draw-room") }
                    retried.status shouldBe HttpStatusCode.BadRequest
                    retried
                        .bodyObject()
                        .getValue("code")
                        .jsonPrimitive.content shouldBe "HIDE_NOT_AVAILABLE"
                }
            }

            it("rejects a draw room without other rows: the plain room route makes that one") {
                withRoomApi {
                    val empty =
                        json(
                            HttpMethod.Post,
                            DRAW_ROOMS,
                            """{"host":{"originCode":"130"},"others":[],"hostPosition":0}""",
                        )
                    empty.status shouldBe HttpStatusCode.BadRequest
                    OpenApiContract.assertValid(HttpMethod.Post, DRAW_ROOMS, empty)
                    empty
                        .bodyObject()
                        .getValue("code")
                        .jsonPrimitive.content shouldBe "INVALID_OTHERS"
                }
            }

            it("keeps the plain room route as before: it has no other rows, so it ignores them like an old server") {
                withRoomApi {
                    val created =
                        json(
                            HttpMethod.Post,
                            ROOMS,
                            """{"mode":"favor","favorTarget":"draw",""" + body.drop(1),
                        )
                    created.status shouldBe HttpStatusCode.Created
                    val path = "$ROOMS/${created.bodyObject().getValue("roomId").jsonPrimitive.content}"
                    val room = json(HttpMethod.Get, path).bodyObject()
                    room.getValue("locked").jsonPrimitive.content shouldBe "false"
                    room.getValue("participants").jsonArray.size shouldBe 1
                }
            }
        }

        describe("room participation retries") {
            it("replays the successful response without adding another participant when the room is full") {
                withRoomApi {
                    val room =
                        json(
                            HttpMethod.Post,
                            ROOMS,
                            """{"mode":"fair","host":{"originCode":"03v"},"expectedCount":2}""",
                        ).bodyObject()
                    val path = "$ROOMS/${room.getValue("roomId").jsonPrimitive.content}"
                    val joined = joinRoom(path)
                    joined.status shouldBe HttpStatusCode.Created
                    val retried = joinRoom(path)
                    retried.status shouldBe HttpStatusCode.Created
                    (retried.bodyAsText() == joined.bodyAsText()) shouldBe true
                    json(HttpMethod.Get, path)
                        .bodyObject()
                        .getValue("participants")
                        .jsonArray.size shouldBe 2
                }
            }

            it("returns participant not found on every retry after the host removes the participant") {
                withRoomApi {
                    val room = createRoom().bodyObject()
                    val path = "$ROOMS/${room.getValue("roomId").jsonPrimitive.content}"
                    val joined = joinRoom(path)
                    joined.status shouldBe HttpStatusCode.Created
                    val participantId =
                        joined
                            .bodyObject()
                            .getValue("participantId")
                            .jsonPrimitive.content
                    val hostToken = room.getValue("hostToken").jsonPrimitive.content
                    json(HttpMethod.Delete, "$path/participants/$participantId", token = hostToken).status shouldBe
                        HttpStatusCode.NoContent

                    repeat(2) {
                        val retried = joinRoom(path)
                        retried.status shouldBe HttpStatusCode.NotFound
                        OpenApiContract.assertValid(HttpMethod.Post, "$ROOMS/{roomId}/participants", retried)
                        retried
                            .bodyObject()
                            .getValue("code")
                            .jsonPrimitive.content shouldBe "PARTICIPANT_NOT_FOUND"
                    }
                    json(HttpMethod.Get, path)
                        .bodyObject()
                        .getValue("participants")
                        .jsonArray.size shouldBe 1
                }
            }

            it("returns room locked on retry after the host closes participation") {
                withRoomApi {
                    val room = createRoom().bodyObject()
                    val path = "$ROOMS/${room.getValue("roomId").jsonPrimitive.content}"
                    joinRoom(path).status shouldBe HttpStatusCode.Created
                    val hostToken = room.getValue("hostToken").jsonPrimitive.content
                    json(HttpMethod.Patch, path, """{"locked":true}""", hostToken).status shouldBe HttpStatusCode.OK

                    val retried = joinRoom(path)
                    retried.status shouldBe HttpStatusCode.Conflict
                    OpenApiContract.assertValid(HttpMethod.Post, "$ROOMS/{roomId}/participants", retried)
                    retried
                        .bodyObject()
                        .getValue("code")
                        .jsonPrimitive.content shouldBe "ROOM_LOCKED"
                }
            }
        }
    })
