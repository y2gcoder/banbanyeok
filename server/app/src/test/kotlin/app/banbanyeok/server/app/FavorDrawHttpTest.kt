package app.banbanyeok.server.app

import app.banbanyeok.server.room.RoomMode
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.HttpClient
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private const val DRAW_PATH = "/v1/rooms/{roomId}/favor-draw"

private suspend fun RouteRoom.withApi(block: suspend HttpClient.() -> Unit) {
    val room = this
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
            )
        }
        client.block()
    }
}

private suspend fun HttpClient.draw(
    room: RouteRoom,
    round: Int,
    token: String? = room.managementToken,
    key: String? = null,
    generation: Int = 0,
): HttpResponse =
    json(
        HttpMethod.Post,
        "/v1/rooms/${room.roomId}/favor-draw",
        """{"generation":$generation,"round":$round}""",
        token,
    ) {
        key?.let { headers.append("Idempotency-Key", it) }
    }

private suspend fun HttpResponse.body(): JsonObject = Json.parseToJsonElement(bodyAsText()).jsonObject

private fun JsonObject.code(): String = getValue("code").jsonPrimitive.content

/** 순위에 쓰이는 칸만(공유 번호처럼 방마다 다른 칸은 뺀다). */
private fun JsonObject.ranking(): JsonObject =
    JsonObject(listOf("mode", "baselineStationCode", "status", "candidates").associateWith(::getValue))

/** 방장 03v, 130(공개), 31a가 있는 방. 운은 처음 뽑기에 첫 대상, 다시 뽑기에 둘째 대상이다. */
private suspend fun drawRoom(): RouteRoom = RouteRoom("130").open(RoomMode.FAVOR, "draw")

class FavorDrawHttpTest :
    DescribeSpec({
        describe("POST /v1/rooms/{roomId}/favor-draw (#172)") {
            it("lets the host draw once and redraw once, and every viewer gets the same stored result") {
                val room = drawRoom()
                room.withApi {
                    val drawn = draw(room, 1)
                    drawn.status.value shouldBe 200
                    OpenApiContract.assertValid(HttpMethod.Post, DRAW_PATH, drawn)
                    val draw = drawn.body().getValue("favorDraw").jsonObject
                    draw.getValue("round").jsonPrimitive.content shouldBe "1"
                    draw.getValue("winner").jsonPrimitive.content shouldBe room.hostId
                    for (token in listOf(
                        null,
                        room.managementToken,
                        room.hostToken,
                        room.guestToken,
                        room.thirdToken,
                    )) {
                        val seen = json(HttpMethod.Get, "/v1/rooms/${room.roomId}", token = token)
                        OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/{roomId}", seen)
                        val body = seen.body()
                        withClue("token=$token") {
                            body.getValue("favorDraw") shouldBe draw
                            body.getValue("favorTarget").jsonPrimitive.content shouldBe room.hostId
                        }
                    }
                    val redrawn = draw(room, 2).body().getValue("favorDraw").jsonObject
                    redrawn.getValue("round").jsonPrimitive.content shouldBe "2"
                    redrawn.getValue("winner").jsonPrimitive.content shouldBe room.guestId
                    val limit = draw(room, 3)
                    limit.status.value shouldBe 409
                    OpenApiContract.assertValid(HttpMethod.Post, DRAW_PATH, limit)
                    limit.body().code() shouldBe "DRAW_LIMIT_REACHED"
                    json(HttpMethod.Get, "/v1/rooms/${room.roomId}").body().getValue("favorDraw") shouldBe redrawn
                }
            }

            it("answers a retry with the same result, by Idempotency-Key and by round, without drawing again") {
                val room = drawRoom()
                room.withApi {
                    val first = draw(room, 1, key = "draw-1").bodyAsText()
                    draw(room, 1, key = "draw-1").bodyAsText() shouldBe first
                    // 다른 인스턴스로 간 재시도(키 캐시가 없다): 같은 회차라 바꾸지 않고 지금 방을 돌려준다.
                    draw(room, 1, key = "draw-1-elsewhere").bodyAsText() shouldBe first
                    draw(room, 1).bodyAsText() shouldBe first
                }
            }

            it("checks the host on every retry and answers with the room as it is now (no response cache)") {
                val room = drawRoom()
                room.withApi {
                    draw(room, 1, key = "same-key").status.value shouldBe 200
                    // 같은 키라도 방장이 아니면 거절한다(응답을 캐시해 두지 않는다).
                    draw(room, 1, token = room.thirdToken, key = "same-key").status.value shouldBe 403
                    // 그사이 방이 바뀌면(이름 변경) 같은 키의 재시도도 지금 방을 받는다.
                    room.fixture.service.updateParticipant(
                        room.roomId,
                        room.thirdId,
                        room.thirdToken,
                        app.banbanyeok.server.room
                            .ParticipantInput("지연이", "31a"),
                    )
                    val retried = draw(room, 1, key = "same-key").bodyAsText()
                    retried shouldBe json(HttpMethod.Get, "/v1/rooms/${room.roomId}").bodyAsText()
                    draw(room, 1, key = "").body().code() shouldBe "INVALID_IDEMPOTENCY_KEY"
                }
            }

            it("does not draw again for a retry sent before the winner left, and draws in the new generation") {
                val room = drawRoom()
                room.withApi {
                    draw(room, 1)
                        .body()
                        .getValue("favorTarget")
                        .jsonPrimitive.content shouldBe room.hostId
                    room.fixture.service.removeParticipant(room.roomId, room.hostId, room.managementToken)
                    val reset = json(HttpMethod.Get, "/v1/rooms/${room.roomId}").body().getValue("favorDraw").jsonObject
                    reset.getValue("generation").jsonPrimitive.content shouldBe "1"
                    reset.getValue("round").jsonPrimitive.content shouldBe "0"
                    for (round in listOf(1, 2)) {
                        val stale = draw(room, round, key = "before-reset")
                        stale.status.value shouldBe 409
                        stale.body().code() shouldBe "ROOM_CHANGED"
                    }
                    val again = draw(room, 1, generation = 1)
                    again.status.value shouldBe 200
                    again
                        .body()
                        .getValue("favorDraw")
                        .jsonObject
                        .getValue("generation")
                        .jsonPrimitive.content shouldBe
                        "1"
                }
            }

            it("rejects anyone but the host and a bad round") {
                val room = drawRoom()
                room.withApi {
                    for (token in listOf(room.hostToken, room.thirdToken)) {
                        val forbidden = draw(room, 1, token)
                        forbidden.status.value shouldBe 403
                        OpenApiContract.assertValid(HttpMethod.Post, DRAW_PATH, forbidden)
                    }
                    draw(room, 1, token = null).status.value shouldBe 401
                    draw(room, 1, token = "not-a-token").status.value shouldBe 401
                    draw(room, 0).body().code() shouldBe "INVALID_REQUEST"
                    draw(room, 1, generation = -1).body().code() shouldBe "INVALID_REQUEST"
                    draw(room, 2).body().code() shouldBe "ROOM_CHANGED"
                    json(HttpMethod.Get, "/v1/rooms/${room.roomId}")
                        .body()
                        .getValue("favorDraw")
                        .jsonObject
                        .getValue("round")
                        .jsonPrimitive.content shouldBe "0"
                }
            }

            it("keeps no trace of a candidate who left: only an anonymous slot stays in the draw (#176)") {
                val room = drawRoom()
                room.withApi {
                    draw(room, 1).status.value shouldBe 200
                    // 당첨자(방장)가 아닌 지연(thirdId)이 나간다.
                    room.fixture.service.removeParticipant(room.roomId, room.thirdId, room.thirdToken)
                    for (token in listOf(null, room.managementToken, room.hostToken, room.guestToken)) {
                        val path = "/v1/rooms/${room.roomId}"
                        for (endpoint in listOf("", "/preview", "/result")) {
                            withClue("token=$token endpoint=$endpoint") {
                                json(
                                    HttpMethod.Get,
                                    path + endpoint,
                                    token = token,
                                ).bodyAsText().contains(room.thirdId) shouldBe
                                    false
                            }
                        }
                    }
                    val draw = json(HttpMethod.Get, "/v1/rooms/${room.roomId}").body().getValue("favorDraw").jsonObject
                    draw.getValue("candidates").jsonArray.map { it.jsonPrimitive.content } shouldBe
                        listOf(room.hostId, room.guestId, "~2")
                    OpenApiContract.assertValid(
                        HttpMethod.Get,
                        "/v1/rooms/{roomId}",
                        json(HttpMethod.Get, "/v1/rooms/${room.roomId}"),
                    )
                }
            }

            it("refuses a room made without the draw and a room with fewer than two candidates") {
                val plain = RouteRoom("130").open(RoomMode.FAVOR, "host")
                plain.withApi { draw(plain, 1).body().code() shouldBe "DRAW_NOT_AVAILABLE" }
                val room = RouteRoom("130").open(RoomMode.FAVOR, "draw")
                room.fixture.service.removeParticipant(room.roomId, room.thirdId, room.managementToken)
                room.fixture.service.removeParticipant(room.roomId, room.guestId, room.managementToken)
                room.withApi {
                    val tooFew = draw(room, 1)
                    tooFew.status.value shouldBe 409
                    tooFew.body().code() shouldBe "NOT_ENOUGH_DRAW_CANDIDATES"
                }
            }
        }

        describe("results and the preview of a draw room") {
            it("are fair before the draw and favor the winner after it, with the draw round on the preview") {
                val room = drawRoom()
                room.withApi {
                    val path = "/v1/rooms/${room.roomId}"
                    json(HttpMethod.Get, "$path/result")
                        .body()
                        .getValue("mode")
                        .jsonPrimitive.content shouldBe "fair"
                    val before = json(HttpMethod.Get, "$path/preview")
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/{roomId}/preview", before)
                    before.body().getValue("basis").toString() shouldBe """{"mode":"fair","favorLabel":null}"""
                    draw(room, 1)
                    json(HttpMethod.Get, "$path/result")
                        .body()
                        .getValue("mode")
                        .jsonPrimitive.content shouldBe "favor"
                    val after = json(HttpMethod.Get, "$path/preview")
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/{roomId}/preview", after)
                    after.body().getValue("basis").toString() shouldBe
                        """{"mode":"favor","favorLabel":"민수","drawRound":1}"""
                }
            }

            it("rank every tab exactly like a room whose favor target was set directly (#148)") {
                val drawn = drawRoom()
                val plain = RouteRoom("130").open(RoomMode.FAVOR, "host")
                val tabs =
                    listOf("?mode=fair", "?mode=fast") +
                        listOf(plain.hostId, plain.guestId, plain.thirdId).map { "?mode=favor&favor=$it" }
                val expected = mutableMapOf<String, JsonObject>()
                plain.withApi {
                    for (tab in tabs + "") {
                        expected[tab] =
                            json(HttpMethod.Get, "/v1/rooms/${plain.roomId}/result$tab").body().ranking()
                    }
                }
                drawn.withApi {
                    val path = "/v1/rooms/${drawn.roomId}/result"
                    for (tab in tabs) {
                        withClue("before the draw $tab") {
                            json(HttpMethod.Get, path + tab).body().ranking() shouldBe
                                expected[tab]
                        }
                    }
                    withClue("before the draw, default") {
                        json(HttpMethod.Get, path).body().ranking() shouldBe expected.getValue("?mode=fair")
                    }
                    draw(drawn, 1)
                        .body()
                        .getValue("favorTarget")
                        .jsonPrimitive.content shouldBe drawn.hostId
                    for (tab in tabs) {
                        withClue("after the draw $tab") {
                            json(HttpMethod.Get, path + tab).body().ranking() shouldBe
                                expected[tab]
                        }
                    }
                    withClue("after the draw, default") {
                        // 당첨자(방장) 쪽: 방장을 직접 고른 방의 기본 결과와 같다.
                        json(HttpMethod.Get, path).body().ranking() shouldBe expected.getValue("")
                    }
                    json(HttpMethod.Get, path)
                        .body()
                        .getValue("candidates")
                        .jsonArray
                        .isNotEmpty() shouldBe true
                }
            }
        }
    })
