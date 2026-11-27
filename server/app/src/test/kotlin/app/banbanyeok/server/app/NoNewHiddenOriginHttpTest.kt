package app.banbanyeok.server.app

import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.recommendation.OdTravelTimeProvider
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.codeNames
import app.banbanyeok.server.recommendation.sampleOd
import app.banbanyeok.server.room.FakeStationCatalog
import app.banbanyeok.server.room.RoomFixture
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

private const val PARTICIPANT_PATH = "/v1/rooms/{roomId}/participants/{participantId}"

private val stations = FakeStationCatalog(meetingStations = setOf("03v", "130", "225", "31a", "4xz"))

/** [fixture]의 방을 HTTP로 다룬다. */
private fun withApi(
    fixture: RoomFixture,
    block: suspend HttpClient.() -> Unit,
) {
    val recommendation = RecommendationService(OdTravelTimeProvider(sampleOd, "20261112.1"), codeNames)
    testApplication {
        application {
            apiModule(
                testConfig(mapOf("RATE_LIMIT_ENABLED" to "false")),
                apiServices(
                    fixture.anonService,
                    fixture.service,
                    RoomResultService(fixture.service, recommendation, testTimes),
                    recommendation,
                    DevArtifacts.directory,
                ),
                fixture.clock,
            )
        }
        client.block()
    }
}

private suspend fun HttpResponse.body(): JsonObject = Json.parseToJsonElement(bodyAsText()).jsonObject

private suspend fun HttpResponse.shouldBeHideNotAvailable(
    method: HttpMethod,
    contractPath: String,
) {
    status.value shouldBe 400
    OpenApiContract.assertValid(method, contractPath, this)
    body().getValue("code").jsonPrimitive.content shouldBe "HIDE_NOT_AVAILABLE"
}

/**
 * ADR-0007(#173, #182): 숨기는 요청은 누구의 것이든 명확한 오류로 거절한다. 옛 화면이 늘 보내는 `hidden: false`는 받는다.
 * 응답의 `hidden`은 계약의 호환 필드라 늘 false다.
 */
class NoNewHiddenOriginHttpTest :
    DescribeSpec({
        describe("no new hidden origins (ADR-0007)") {
            it("refuses a hidden host, a hidden join and starting to hide, and changes nothing") {
                val fixture = RoomFixture(stations = stations)
                withApi(fixture) {
                    json(HttpMethod.Post, "/v1/rooms", """{"mode":"fair","host":{"originCode":"03v","hidden":true}}""")
                        .shouldBeHideNotAvailable(HttpMethod.Post, "/v1/rooms")
                    val created =
                        json(
                            HttpMethod.Post,
                            "/v1/rooms",
                            """{"mode":"fair","host":{"originCode":"03v"}}""",
                        ).body()
                    val roomId = created.getValue("roomId").jsonPrimitive.content
                    val hostId = created.getValue("participantId").jsonPrimitive.content
                    val hostToken = created.getValue("participantToken").jsonPrimitive.content
                    json(HttpMethod.Post, "/v1/rooms/$roomId/participants", """{"originCode":"130","hidden":true}""")
                        .shouldBeHideNotAvailable(HttpMethod.Post, "/v1/rooms/{roomId}/participants")
                    json(
                        HttpMethod.Put,
                        "/v1/rooms/$roomId/participants/$hostId",
                        """{"nickname":"민수","originCode":"225","hidden":true}""",
                        hostToken,
                    ).shouldBeHideNotAvailable(HttpMethod.Put, PARTICIPANT_PATH)
                    val participants =
                        json(
                            HttpMethod.Get,
                            "/v1/rooms/$roomId",
                        ).body().getValue("participants").jsonArray
                    participants.size shouldBe 1
                    participants[0].jsonObject.run {
                        getValue("hidden").jsonPrimitive.content shouldBe "false"
                        getValue("originCode").jsonPrimitive.content shouldBe "03v"
                    }
                }
            }

            it("does not replay a public success for a hidden body sent with the same Idempotency-Key") {
                val fixture = RoomFixture(stations = stations)
                withApi(fixture) {
                    val key: io.ktor.client.request.HttpRequestBuilder.() -> Unit = {
                        headers.append("Idempotency-Key", "same-key")
                    }
                    val created =
                        json(
                            HttpMethod.Post,
                            "/v1/rooms",
                            """{"mode":"fair","host":{"originCode":"03v"}}""",
                            configure = key,
                        )
                    created.status.value shouldBe 201
                    json(
                        HttpMethod.Post,
                        "/v1/rooms",
                        """{"mode":"fair","host":{"originCode":"03v","hidden":true}}""",
                        configure = key,
                    ).shouldBeHideNotAvailable(HttpMethod.Post, "/v1/rooms")
                    val roomId =
                        created
                            .body()
                            .getValue("roomId")
                            .jsonPrimitive.content
                    val path = "/v1/rooms/$roomId/participants"
                    json(HttpMethod.Post, path, """{"originCode":"130"}""", configure = key).status.value shouldBe 201
                    json(HttpMethod.Post, path, """{"originCode":"130","hidden":true}""", configure = key)
                        .shouldBeHideNotAvailable(HttpMethod.Post, "/v1/rooms/{roomId}/participants")
                    val participants =
                        json(
                            HttpMethod.Get,
                            "/v1/rooms/$roomId",
                        ).body().getValue("participants").jsonArray
                    participants.map {
                        it.jsonObject
                            .getValue("hidden")
                            .jsonPrimitive.content
                    } shouldBe
                        listOf("false", "false")
                }
            }

            it(
                "takes hidden=false from an old screen on every write, and refuses keeping a hide while changing nothing",
            ) {
                val fixture = RoomFixture(stations = stations)
                withApi(fixture) {
                    val created =
                        json(
                            HttpMethod.Post,
                            "/v1/rooms",
                            """{"mode":"fair","host":{"originCode":"03v","hidden":false}}""",
                        )
                    created.status.value shouldBe 201
                    val roomId =
                        created
                            .body()
                            .getValue("roomId")
                            .jsonPrimitive.content
                    val joined =
                        json(
                            HttpMethod.Post,
                            "/v1/rooms/$roomId/participants",
                            """{"originCode":"130","hidden":false}""",
                        ).body()
                    val path = "/v1/rooms/$roomId/participants/${joined.getValue(
                        "participantId",
                    ).jsonPrimitive.content}"
                    val token = joined.getValue("participantToken").jsonPrimitive.content
                    val shown =
                        json(HttpMethod.Put, path, """{"nickname":"지연","originCode":"130","hidden":false}""", token)
                    shown.status.value shouldBe 200
                    OpenApiContract.assertValid(HttpMethod.Put, PARTICIPANT_PATH, shown)
                    // 옛 화면의 '계속 숨기기'도 새로 숨기는 것과 같이 거절한다. 이 서버에는 숨긴 사람이 없다.
                    json(HttpMethod.Put, path, """{"nickname":"수진","originCode":"225","hidden":true}""", token)
                        .shouldBeHideNotAvailable(HttpMethod.Put, PARTICIPANT_PATH)
                    val participant =
                        json(HttpMethod.Get, "/v1/rooms/$roomId")
                            .body()
                            .getValue("participants")
                            .jsonArray[1]
                            .jsonObject
                    participant.getValue("hidden").jsonPrimitive.content shouldBe "false"
                    participant.getValue("nickname").jsonPrimitive.content shouldBe "지연"
                    participant.getValue("originCode").jsonPrimitive.content shouldBe "130"
                }
            }
        }
    })
