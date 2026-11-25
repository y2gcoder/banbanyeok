package app.banbanyeok.server.app

import app.banbanyeok.server.room.TestDatabase
import app.banbanyeok.server.room.exposed.ConnectedDatabase
import io.kotest.core.config.AbstractProjectConfig
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import io.ktor.client.HttpClient
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class ProjectConfig : AbstractProjectConfig() {
    override suspend fun afterProject() = TestDatabase.stop()
}

private fun JsonElement.str(key: String) = jsonObject.getValue(key).jsonPrimitive.content

private fun parse(body: String): JsonElement = Json.parseToJsonElement(body)

/** 새로 숨길 수 없으므로(ADR-0007), ADR-0007 전에 숨긴 채 들어온 참가자는 DB 행을 직접 바꿔 만든다. */
private fun hideAsBefore(
    roomId: String,
    participantId: String,
) {
    TestDatabase.dataSource.connection.use { connection ->
        connection.prepareStatement("UPDATE participants SET hidden = true WHERE room_id = ? AND pid = ?").use {
            it.setString(1, roomId)
            it.setString(2, participantId)
            it.executeUpdate() shouldBe 1
        }
    }
}

/**
 * API 통합 테스트: 실제 조립(composition root) + Testcontainers Postgres(Liquibase 적용) + data/artifacts/dev 산출물.
 * 모든 응답을 contracts/openapi.yaml로 검증한다.
 */
class ApiIntegrationTest :
    DescribeSpec({
        // 호출이 끝난 뒤에는 방 하나에 쓰는 도구(요청 보조)
        class Flow(
            val client: HttpClient,
        ) {
            suspend fun call(
                method: HttpMethod,
                path: String,
                body: String? = null,
                token: String? = null,
                contractPath: String = path.substringBefore('?'),
                expected: HttpStatusCode? = null,
            ): HttpResponse {
                val response = client.json(method, path, body, token)
                OpenApiContract.assertValid(method, contractPath, response)
                if (expected != null) response.status shouldBe expected
                return response
            }
        }

        fun integration(block: suspend ApplicationTestBuilder.(Flow, List<String>) -> Unit) {
            val components =
                runBlocking {
                    CompositionRoot.create(
                        // 앱용 익명 사용자 흐름(기기 토큰으로 방 만들기)도 검증하려고 켠다. 기본은 꺼져 있다(ConfigTest).
                        config = testConfig(mapOf("RATE_LIMIT_ENABLED" to "false", "ANON_ENABLED" to "true")),
                        store = DevArtifacts.store,
                        database = ConnectedDatabase(TestDatabase.dataSource, TestDatabase.database),
                    )
                }
            testApplication {
                application { apiModule(components.config, components.services, components.clock) }
                block(Flow(client), DevArtifacts.origins)
            }
        }

        describe("the core flow: create a room, join, set the origin, read the result") {
            it("works end to end against Postgres and every response matches the contract") {
                integration { api, origins ->
                    val (a, b, c) = Triple(origins[0], origins[origins.size / 2], origins.last())

                    val anon =
                        parse(api.call(HttpMethod.Post, "/v1/anon", expected = HttpStatusCode.Created).bodyAsText())
                    val device = anon.str("deviceToken")

                    val created =
                        parse(
                            api
                                .call(
                                    HttpMethod.Post,
                                    "/v1/rooms",
                                    """{"mode":"fair","host":{"nickname":"민수","originCode":"$a"},"expectedCount":3}""",
                                    token = device,
                                    expected = HttpStatusCode.Created,
                                ).bodyAsText(),
                        )
                    val roomId = created.str("roomId")
                    val hostToken = created.str("hostToken")
                    val room = "/v1/rooms/$roomId"

                    // 새로 숨기며 참여하는 요청은 받지 않는다(ADR-0007).
                    parse(
                        api
                            .call(
                                HttpMethod.Post,
                                "$room/participants",
                                """{"nickname":"지연","originCode":"$b","hidden":true}""",
                                expected = HttpStatusCode.BadRequest,
                            ).bodyAsText(),
                    ).str("code") shouldBe "HIDE_NOT_AVAILABLE"
                    val friend =
                        parse(
                            api
                                .call(
                                    HttpMethod.Post,
                                    "$room/participants",
                                    """{"nickname":"지연","originCode":"$b"}""",
                                    expected = HttpStatusCode.Created,
                                ).bodyAsText(),
                        )
                    val friendToken = friend.str("participantToken")
                    // 아직 남은 옛 방처럼, 이 친구는 숨긴 채 들어와 있다.
                    hideAsBefore(roomId, friend.str("participantId"))

                    // 출발역 입력(수정): 친구가 한 번 바꿨다가 숨김을 유지한 채 다시 맞춘다.
                    api.call(
                        HttpMethod.Put,
                        "$room/participants/${friend.str("participantId")}",
                        """{"nickname":"지연","originCode":"$c","hidden":true}""",
                        token = friendToken,
                        contractPath = "$room/participants/${friend.str("participantId")}",
                        expected = HttpStatusCode.OK,
                    )
                    api.call(
                        HttpMethod.Put,
                        "$room/participants/${friend.str("participantId")}",
                        """{"nickname":"지연","originCode":"$b","hidden":true}""",
                        token = friendToken,
                        expected = HttpStatusCode.OK,
                    )

                    // 익명 조회: 숨긴 출발역은 null, 본인 조회: 보인다.
                    val anonymousView = parse(api.call(HttpMethod.Get, room, expected = HttpStatusCode.OK).bodyAsText())
                    val hiddenOrigins =
                        anonymousView.jsonObject.getValue("participants").jsonArray.map {
                            it.jsonObject["originCode"]?.jsonPrimitive?.contentOrNull
                        }
                    hiddenOrigins shouldContainExactly listOf(a, null)
                    // 통계용 방 해시: 만들 때 받은 값과 같고, 방 ID 원문이 아니다.
                    val roomHash = anonymousView.str("roomHash")
                    roomHash shouldBe created.str("roomHash")
                    (roomHash == roomId || roomHash.contains(roomId)) shouldBe false
                    anonymousView.str("createdAt").isNotEmpty() shouldBe true
                    val selfView = parse(api.call(HttpMethod.Get, room, token = friendToken).bodyAsText())
                    selfView.jsonObject
                        .getValue("participants")
                        .jsonArray[1]
                        .str("originCode") shouldBe b

                    // 결과: 숨긴 참가자의 시간은 보이고 출발역은 가려진다.
                    val result = api.call(HttpMethod.Get, "$room/result", expected = HttpStatusCode.OK).bodyAsText()
                    val resultJson = parse(result)
                    resultJson.str("status") shouldBe "ok"
                    resultJson.jsonObject
                        .getValue("candidates")
                        .jsonArray.size shouldBe 3
                    resultJson.jsonObject
                        .getValue(
                            "candidates",
                        ).jsonArray
                        .first()
                        .jsonObject
                        .getValue("times")
                        .jsonArray.size shouldBe
                        2
                    result shouldNotContain "\"originCode\":\"$b\""

                    // 방장이 배려 모드로 바꾸면 우대 대상의 시간이 카드에 실린다.
                    api.call(
                        HttpMethod.Patch,
                        room,
                        """{"mode":"favor","favorTarget":"host"}""",
                        token = hostToken,
                        expected = HttpStatusCode.OK,
                    )
                    val favor =
                        parse(api.call(HttpMethod.Get, "$room/result", expected = HttpStatusCode.OK).bodyAsText())
                    favor.jsonObject
                        .getValue(
                            "candidates",
                        ).jsonArray
                        .first()
                        .jsonObject
                        .containsKey("favoredSeconds") shouldBe
                        true

                    // "실제로 어디서 만났나" 기록
                    api.call(
                        HttpMethod.Post,
                        "$room/outcome",
                        """{"outcome":"top1"}""",
                        token = friendToken,
                        contractPath = "$room/outcome",
                        expected = HttpStatusCode.NoContent,
                    )

                    // 삭제
                    api.call(HttpMethod.Delete, room, token = hostToken, expected = HttpStatusCode.NoContent)
                    api.call(HttpMethod.Get, room, expected = HttpStatusCode.NotFound)
                }
            }

            it("answers the documented error cases with the documented bodies") {
                integration { api, origins ->
                    val created =
                        parse(
                            api
                                .call(
                                    HttpMethod.Post,
                                    "/v1/rooms",
                                    """{"mode":"fast","host":{"originCode":"${origins[0]}"}}""",
                                    expected = HttpStatusCode.Created,
                                ).bodyAsText(),
                        )
                    val room = "/v1/rooms/${created.str("roomId")}"
                    api.call(HttpMethod.Get, "$room/result", expected = HttpStatusCode.Conflict)
                    api.call(
                        HttpMethod.Post,
                        "/v1/rooms",
                        """{"mode":"fast","host":{"originCode":"zzz"}}""",
                        contractPath = "/v1/rooms",
                        expected = HttpStatusCode.BadRequest,
                    )
                    api.call(HttpMethod.Get, "/v1/rooms/0000000000", expected = HttpStatusCode.NotFound)
                    api.call(
                        HttpMethod.Delete,
                        room,
                        token = created.str("participantToken"),
                        expected = HttpStatusCode.Forbidden,
                    )
                    api.call(HttpMethod.Delete, room, expected = HttpStatusCode.Unauthorized)
                    api.call(
                        HttpMethod.Delete,
                        room,
                        token = created.str("hostToken"),
                        expected = HttpStatusCode.NoContent,
                    )
                }
            }

            it("answers a stateless recommendation, the manifest and a data file") {
                integration { api, origins ->
                    val recommend =
                        parse(
                            api
                                .call(
                                    HttpMethod.Post,
                                    "/v1/recommend",
                                    """{"origins":["${origins[1]}","${origins[2]}","${origins[3]}"],""" +
                                        """"mode":"favor","favorIndex":2,"nicknames":["민수","지연",null]}""",
                                    expected = HttpStatusCode.OK,
                                ).bodyAsText(),
                        )
                    recommend.str("mode") shouldBe "favor"
                    recommend.jsonObject.getValue("participants").jsonArray.map {
                        it.jsonObject["nickname"]?.jsonPrimitive?.contentOrNull
                    } shouldContainExactly
                        listOf("민수", "지연", null)
                    val manifest = api.call(HttpMethod.Get, "/v1/manifest", expected = HttpStatusCode.OK).bodyAsText()
                    val version = parse(manifest).str("dataVersion")
                    api.call(HttpMethod.Get, "/v1/data/$version/stations.json", expected = HttpStatusCode.OK)
                    api.call(HttpMethod.Get, "/v1/healthz", expected = HttpStatusCode.OK)
                }
            }
        }

        describe("sharing a room and deciding the meeting station") {
            it("previews a favor room whose stored favor target already left by favoring the first participant") {
                integration { api, origins ->
                    val created =
                        parse(
                            api
                                .call(
                                    HttpMethod.Post,
                                    "/v1/rooms",
                                    """{"mode":"favor","favorTarget":"host","host":{"nickname":"민수","originCode":"${origins[0]}"}}""",
                                    expected = HttpStatusCode.Created,
                                ).bodyAsText(),
                        )
                    val roomId = created.str("roomId")
                    val room = "/v1/rooms/$roomId"
                    api.call(
                        HttpMethod.Post,
                        "$room/participants",
                        """{"nickname":"지연","originCode":"${origins.last()}"}""",
                        expected = HttpStatusCode.Created,
                    )
                    // 이 수정 전의 서버는 나간 사람을 우대 대상으로 저장할 수 있었다. 그 행이 남아 있다.
                    TestDatabase.dataSource.connection.use { connection ->
                        connection.prepareStatement("UPDATE rooms SET favor_pid = 'gone00' WHERE id = ?").use {
                            it.setString(1, roomId)
                            it.executeUpdate()
                        }
                    }
                    val view = parse(api.call(HttpMethod.Get, room, expected = HttpStatusCode.OK).bodyAsText())
                    view.jsonObject["favorTarget"] shouldBe JsonNull
                    val preview =
                        parse(api.call(HttpMethod.Get, "$room/preview", expected = HttpStatusCode.OK).bodyAsText())
                    preview.jsonObject
                        .getValue("basis")
                        .str("favorLabel") shouldBe "민수"
                }
            }

            it("moves the preview from invite to result to decided and refuses a decision from a stale screen") {
                integration { api, origins ->
                    val (a, b, c) = Triple(origins[0], origins[origins.size / 2], origins.last())
                    val created =
                        parse(
                            api
                                .call(
                                    HttpMethod.Post,
                                    "/v1/rooms",
                                    """{"mode":"fair","host":{"nickname":"민수","originCode":"$a"}}""",
                                    expected = HttpStatusCode.Created,
                                ).bodyAsText(),
                        )
                    val room = "/v1/rooms/${created.str("roomId")}"
                    val hostPart = created.str("participantToken")
                    val invite =
                        parse(api.call(HttpMethod.Get, "$room/preview", expected = HttpStatusCode.OK).bodyAsText())
                    invite.str("stage") shouldBe "collecting"

                    val friend =
                        parse(
                            api
                                .call(
                                    HttpMethod.Post,
                                    "$room/participants",
                                    """{"originCode":"$b"}""",
                                    expected = HttpStatusCode.Created,
                                ).bodyAsText(),
                        )
                    val friendPart = friend.str("participantToken")
                    // ADR-0007 전에 숨긴 채 들어온 참가자(새로 숨길 수 없다).
                    hideAsBefore(created.str("roomId"), friend.str("participantId"))
                    // 숨긴 본인의 토큰을 보내도 미리보기에는 출발역이 없다.
                    val shown =
                        api.call(
                            HttpMethod.Get,
                            "$room/preview",
                            token = friendPart,
                            expected = HttpStatusCode.OK,
                        )
                    val result = parse(shown.bodyAsText())
                    result.str("stage") shouldBe "result"
                    shown.bodyAsText() shouldNotContain "\"$b\""
                    val labels =
                        result.jsonObject
                            .getValue("station")
                            .jsonObject
                            .getValue("times")
                            .jsonArray
                            .map { it.str("label") }
                    labels shouldContainExactly listOf("민수", "참가자 2")

                    val computed =
                        parse(api.call(HttpMethod.Get, "$room/result", expected = HttpStatusCode.OK).bodyAsText())
                    val seen = computed.str("shareVersion")
                    val second =
                        computed.jsonObject
                            .getValue("candidates")
                            .jsonArray[1]
                            .str("stationCode")
                    api.call(
                        HttpMethod.Put,
                        "$room/decision",
                        """{"stationCode":"$second","seenVersion":$seen}""",
                        token = friendPart,
                        expected = HttpStatusCode.OK,
                    )
                    val decided =
                        parse(api.call(HttpMethod.Get, "$room/preview", expected = HttpStatusCode.OK).bodyAsText())
                    decided.str("stage") shouldBe "decided"
                    decided.str("decidedBy") shouldBe "참가자 2"
                    decided.jsonObject
                        .getValue("station")
                        .str("stationCode") shouldBe second

                    // 정한 뒤 방장이 출발역을 바꾸면 정함이 풀리고, 그 전 화면에서 다시 정하면 409다.
                    val roomView = parse(api.call(HttpMethod.Get, room, token = hostPart).bodyAsText())
                    val beforeChange = roomView.str("shareVersion")
                    val hostId = created.str("participantId")
                    api.call(
                        HttpMethod.Put,
                        "$room/participants/$hostId",
                        """{"nickname":"민수","originCode":"$c"}""",
                        token = hostPart,
                        expected = HttpStatusCode.OK,
                    )
                    val stale =
                        api.call(
                            HttpMethod.Put,
                            "$room/decision",
                            """{"stationCode":"$second","seenVersion":$beforeChange}""",
                            token = hostPart,
                            expected = HttpStatusCode.Conflict,
                        )
                    parse(stale.bodyAsText()).str("code") shouldBe "ROOM_CHANGED"
                    val released = parse(api.call(HttpMethod.Get, room, expected = HttpStatusCode.OK).bodyAsText())
                    released.jsonObject["decision"] shouldBe JsonNull
                    api.call(
                        HttpMethod.Put,
                        "$room/decision",
                        """{"stationCode":null,"seenVersion":$beforeChange}""",
                        token = hostPart,
                        expected = HttpStatusCode.OK,
                    )
                }
            }
        }
    })
