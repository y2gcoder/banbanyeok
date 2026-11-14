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
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class ProjectConfig : AbstractProjectConfig() {
    override suspend fun afterProject() = TestDatabase.stop()
}

private fun JsonElement.str(key: String) = jsonObject.getValue(key).jsonPrimitive.content

private fun parse(body: String): JsonElement = Json.parseToJsonElement(body)

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
                        config = testConfig(mapOf("RATE_LIMIT_ENABLED" to "false")),
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

                    val friend =
                        parse(
                            api
                                .call(
                                    HttpMethod.Post,
                                    "$room/participants",
                                    """{"nickname":"지연","originCode":"$b","hidden":true}""",
                                    expected = HttpStatusCode.Created,
                                ).bodyAsText(),
                        )
                    val friendToken = friend.str("participantToken")

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
                                    """{"origins":["${origins[1]}","${origins[2]}","${origins[3]}"],"mode":"favor","favorIndex":2}""",
                                    expected = HttpStatusCode.OK,
                                ).bodyAsText(),
                        )
                    recommend.str("mode") shouldBe "favor"
                    val manifest = api.call(HttpMethod.Get, "/v1/manifest", expected = HttpStatusCode.OK).bodyAsText()
                    val version = parse(manifest).str("dataVersion")
                    api.call(HttpMethod.Get, "/v1/data/$version/stations.json", expected = HttpStatusCode.OK)
                    api.call(HttpMethod.Get, "/v1/healthz", expected = HttpStatusCode.OK)
                }
            }
        }
    })
