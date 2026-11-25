package app.banbanyeok.server.app

import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.HttpClient
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private const val ROOMS = "/v1/rooms"
private const val HOST_INPUT = """{"mode":"fair","host":{"originCode":"03v"}}"""
private const val GUEST_INPUT = """{"originCode":"130","hidden":true}"""

private fun withRoomApi(block: suspend HttpClient.() -> Unit) {
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
