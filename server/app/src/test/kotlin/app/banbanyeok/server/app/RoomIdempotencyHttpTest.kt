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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Clock

private const val ROOMS = "/v1/rooms"
private const val DRAW_ROOMS = "/v1/draw-rooms"
private const val RECOVERY_KEY = "recovery-key-of-the-creating-browser-0001"
private const val HOST_INPUT = """{"mode":"fair","host":{"originCode":"03v"}}"""
private const val GUEST_INPUT = """{"originCode":"130"}"""

private fun withRoomApi(
    counter: DailyCounter = DailyCounter {},
    room: RouteRoom = RouteRoom("130"),
    block: suspend HttpClient.() -> Unit,
) {
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
                    """"others":[{"nickname":"민수","originCode":"03v"},{"originCode":"225"}],"hostPosition":1,""" +
                    """"recoveryKey":"$RECOVERY_KEY"}"""

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
                            """{"host":{"originCode":"130"},"others":[],"hostPosition":0,"recoveryKey":"$RECOVERY_KEY"}""",
                        )
                    empty.status shouldBe HttpStatusCode.BadRequest
                    OpenApiContract.assertValid(HttpMethod.Post, DRAW_ROOMS, empty)
                    empty
                        .bodyObject()
                        .getValue("code")
                        .jsonPrimitive.content shouldBe "INVALID_OTHERS"
                }
            }

            it(
                "gives the creator the same room and the same tokens on another instance, counting one creation (#227)",
            ) {
                val shared = RouteRoom("130")
                val stages = mutableListOf<UsageStage>()
                lateinit var first: JsonObject
                withRoomApi(DailyCounter { stages += it }, shared) {
                    val created =
                        json(HttpMethod.Post, DRAW_ROOMS, body) { headers.append("Idempotency-Key", "draw-room") }
                    created.status shouldBe HttpStatusCode.Created
                    first = created.bodyObject()
                }
                // 응답을 잃은 기기가 다른 인스턴스(빈 재생 캐시)로 같은 키를 다시 보낸다.
                withRoomApi(DailyCounter { stages += it }, shared) {
                    val again =
                        json(HttpMethod.Post, DRAW_ROOMS, body) { headers.append("Idempotency-Key", "draw-room") }
                    again.status shouldBe HttpStatusCode.Created
                    OpenApiContract.assertValid(HttpMethod.Post, DRAW_ROOMS, again)
                    val second = again.bodyObject()

                    fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content
                    listOf("roomId", "participantId", "hostToken", "participantToken").forEach {
                        second.text(it) shouldBe first.text(it)
                    }
                    val path = "$ROOMS/${first.text("roomId")}"
                    json(HttpMethod.Get, path, token = second.text("participantToken"))
                        .bodyObject()
                        .getValue("participants")
                        .jsonArray
                        .map {
                            it.jsonObject
                                .getValue("isSelf")
                                .jsonPrimitive.content
                        } shouldBe
                        listOf("false", "true", "false")
                    json(HttpMethod.Delete, path, token = first.text("hostToken")).status shouldBe
                        HttpStatusCode.NoContent
                }
                stages.count { it == UsageStage.CREATE_ROOM } shouldBe 1
            }

            it("keeps names, times and origins out of the link preview before and after the draw and once decided") {
                withRoomApi {
                    val dated = body.replace(""""hostPosition":1""", """"hostPosition":1,"meetingDate":"2026-11-27"""")
                    val created = json(HttpMethod.Post, DRAW_ROOMS, dated).bodyObject()

                    fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content
                    val path = "$ROOMS/${created.text("roomId")}"
                    val personal =
                        json(HttpMethod.Get, path)
                            .bodyObject()
                            .getValue("participants")
                            .jsonArray
                            .mapNotNull { it.jsonObject["nickname"]?.jsonPrimitive?.contentOrNull }
                    personal shouldBe listOf("민수", "지연")
                    val before = json(HttpMethod.Get, "$path/preview")
                    json(
                        HttpMethod.Post,
                        "$path/favor-draw",
                        """{"generation":0,"round":1}""",
                        created.text("hostToken"),
                    ).status shouldBe HttpStatusCode.OK
                    val drawn = json(HttpMethod.Get, "$path/preview")
                    val station =
                        drawn
                            .bodyObject()
                            .getValue("station")
                            .jsonObject
                            .text("stationCode")
                    val seen = json(HttpMethod.Get, path).bodyObject().text("shareVersion")
                    json(
                        HttpMethod.Put,
                        "$path/decision",
                        """{"stationCode":"$station","seenVersion":$seen}""",
                        created.text("participantToken"),
                    ).status shouldBe HttpStatusCode.OK
                    val decided = json(HttpMethod.Get, "$path/preview")
                    listOf(before, drawn, decided).map { it.bodyObject().text("stage") } shouldBe
                        listOf("result", "result", "decided")
                    listOf(before, drawn, decided).forEach { response ->
                        OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/{roomId}/preview", response)
                        val text = response.bodyAsText()
                        personal.filter { it in text } shouldBe emptyList()
                        ("lastTrain" in text) shouldBe false
                        ("mapMiddle" in text) shouldBe false
                        val preview = response.bodyObject()
                        preview.getValue("room").jsonObject.text("enteredByHost") shouldBe "true"
                        preview.getValue("station").jsonObject.getValue("times").jsonArray.map {
                            it.jsonObject.text("label") to
                                it.jsonObject
                                    .getValue("seconds")
                                    .jsonPrimitive.contentOrNull
                        } shouldBe listOf("참가자 1" to null, "참가자 2" to null, "참가자 3" to null)
                    }
                    drawn
                        .bodyObject()
                        .getValue("basis")
                        .jsonObject
                        .text("drawRound") shouldBe "1"
                    decided.bodyObject().text("decidedBy") shouldBe "참가자 2"
                    json(HttpMethod.Get, "$path/result").bodyAsText().let { result ->
                        ("민수" in result) shouldBe true
                        Regex(""""seconds":\d+""").containsMatchIn(result) shouldBe true
                    }
                }
            }

            it("leaves the preview of a room where everyone entered themselves as before") {
                withRoomApi {
                    val created = createRoom().bodyObject()
                    val path = "$ROOMS/${created.getValue("roomId").jsonPrimitive.content}"
                    joinRoom(path)
                    val preview = json(HttpMethod.Get, "$path/preview").bodyObject()
                    ("enteredByHost" in preview.getValue("room").jsonObject) shouldBe false
                    preview
                        .getValue("station")
                        .jsonObject
                        .getValue("times")
                        .jsonArray
                        .none {
                            it.jsonObject
                                .getValue("label")
                                .jsonPrimitive.content
                                .startsWith("참가자")
                        } shouldBe true
                }
            }

            it("rejects a guessable recovery key before storing anything") {
                withRoomApi {
                    val weak = json(HttpMethod.Post, DRAW_ROOMS, body.replace(RECOVERY_KEY, "short"))
                    weak.status shouldBe HttpStatusCode.BadRequest
                    weak
                        .bodyObject()
                        .getValue("code")
                        .jsonPrimitive.content shouldBe "INVALID_REQUEST"
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
