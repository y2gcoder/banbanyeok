package app.banbanyeok.server.app

import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.recommendation.OdTravelTimeProvider
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.codeNames
import app.banbanyeok.server.recommendation.sampleOd
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.FakeStationCatalog
import app.banbanyeok.server.room.NewHiddenOrigins
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomFixture
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

private const val PARTICIPANT_PATH = "/v1/rooms/{roomId}/participants/{participantId}"

private val stations = FakeStationCatalog(meetingStations = setOf("03v", "130", "225", "31a", "4xz"))

/** 지금 서버(새 숨김 거절)로 [fixture]의 방을 HTTP로 다룬다. */
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

/** ADR-0007(#173): 새로 숨기는 요청은 명확한 오류로 거절하고, 이미 숨긴 사람은 유지하거나 풀 수만 있다. */
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

            it("lets someone who hid before keep it or show their origin, then not hide again") {
                val legacy = RoomFixture(stations = stations, newHidden = NewHiddenOrigins.LEGACY_FIXTURE)
                val created =
                    legacy.service.create(
                        CreateRoomCommand(RoomMode.FAIR, null, null, ParticipantInput("민수", "03v"), null, null),
                    )
                val hidden = legacy.service.join(created.roomId, ParticipantInput(null, "130", true), null)
                val path = "/v1/rooms/${created.roomId}/participants/${hidden.participantId}"
                withApi(RoomFixture(rooms = legacy.rooms, clock = legacy.clock, stations = stations)) {
                    for ((body, status) in listOf(
                        """{"nickname":"지연","originCode":"130","hidden":true}""" to 200,
                        """{"nickname":"지연","originCode":"130","hidden":false}""" to 200,
                        """{"nickname":"지연","originCode":"130","hidden":true}""" to 400,
                    )) {
                        withClue(body) {
                            val response = json(HttpMethod.Put, path, body, hidden.participantToken)
                            response.status.value shouldBe status
                            OpenApiContract.assertValid(HttpMethod.Put, PARTICIPANT_PATH, response)
                        }
                    }
                    val shown =
                        json(HttpMethod.Get, "/v1/rooms/${created.roomId}")
                            .body()
                            .getValue("participants")
                            .jsonArray[1]
                            .jsonObject
                    shown.getValue("hidden").jsonPrimitive.content shouldBe "false"
                    shown.getValue("originCode").jsonPrimitive.content shouldBe "130"
                }
            }
        }
    })
