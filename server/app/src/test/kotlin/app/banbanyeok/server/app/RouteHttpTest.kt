package app.banbanyeok.server.app

import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.app.http.ApiServices
import app.banbanyeok.server.app.http.apiJson
import app.banbanyeok.server.app.http.toDto
import app.banbanyeok.server.recommendation.OdTravelTimeProvider
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.codeNames
import app.banbanyeok.server.recommendation.route.RouteSource
import app.banbanyeok.server.recommendation.sampleOd
import app.banbanyeok.server.recommendation.sampleRouteGraph
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.FakeStationCatalog
import app.banbanyeok.server.room.FixedDrawRandom
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomFixture
import app.banbanyeok.server.room.RoomMode
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** 실제 dev 산출물(rg.bin 포함)로 조립한 무상태 추천. [routes]가 null을 주면 그래프가 준비되지 않은 서버다. */
private fun api(routes: RouteSource = DevArtifacts.routes): ApiServices {
    val mocks = MockedServices()
    val directory = DevArtifacts.directory
    return apiServices(
        mocks.anon,
        mocks.rooms,
        mocks.results,
        RecommendationService(directory.travel, directory, locations = directory, routes = routes),
        directory,
        DevArtifacts.published,
    )
}

private fun codeOf(name: String): String =
    DevArtifacts.directory.originCodes.first { DevArtifacts.directory.nameOf(it) == name }

private fun JsonObject.cards(): List<JsonObject> = getValue("candidates").jsonArray.map { it.jsonObject }

private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content

private fun request(origins: List<String>): String =
    buildJsonObject {
        put("origins", JsonArray(origins.map(::JsonPrimitive)))
        put("mode", "fair")
        put("timeSlot", "weekday-day")
    }.toString()

/** 방장 03v, 출발역을 숨긴 [hiddenOrigin], 31a. 장난감 행렬과 장난감 노선 그래프. [hidden]이 false면 대조군: 같은 사람이 출발역을 공개한다. */
internal class RouteRoom(
    hiddenOrigin: String,
    recommendation: RecommendationService? = null,
    private val date: java.time.LocalDate? = null,
    private val hidden: Boolean = true,
) {
    val fixture =
        RoomFixture(
            stations = FakeStationCatalog(meetingStations = setOf("03v", "130", "225", "31a", "4xz")),
            // 뽑기의 운: 처음 뽑기는 첫 대상, 다시 뽑기는 둘째 대상.
            drawRandom = FixedDrawRandom(0, 1),
        )
    val recommendation =
        recommendation ?: RecommendationService(
            OdTravelTimeProvider(sampleOd, "20261120.1", TimeSlot.ALL.associateWith { sampleOd }),
            codeNames,
            routes = { sampleRouteGraph() },
        )
    val results =
        RoomResultService(
            fixture.service,
            this.recommendation,
            testTimes,
        )
    val origin = hiddenOrigin
    lateinit var roomId: String
    lateinit var hiddenId: String
    lateinit var hiddenToken: String
    lateinit var managementToken: String
    lateinit var thirdToken: String
    lateinit var hostId: String
    lateinit var thirdId: String
    lateinit var hostToken: String

    suspend fun open(
        mode: RoomMode = RoomMode.FAIR,
        favorTarget: String? = null,
    ): RouteRoom {
        val created =
            fixture.service.create(
                CreateRoomCommand(mode, favorTarget, date, ParticipantInput("민수", "03v", false), null, null),
            )
        val hidden = fixture.service.join(created.roomId, ParticipantInput(null, origin, hidden), null)
        val third = fixture.service.join(created.roomId, ParticipantInput("지연", "31a", false), null)
        thirdToken = third.participantToken
        thirdId = third.participantId
        hostId = created.participantId
        managementToken = created.hostToken
        roomId = created.roomId
        hostToken = created.participantToken
        hiddenId = hidden.participantId
        hiddenToken = hidden.participantToken
        return this
    }

    suspend fun json(token: String?): JsonObject =
        apiJson
            .encodeToJsonElement(
                app.banbanyeok.server.app.http.ResultDto
                    .serializer(),
                results.result(roomId, token, null, null).toDto(DevArtifacts.directory),
            ).jsonObject
}

private fun JsonObject.routeIds(): List<List<String>> =
    cards().map { card -> card.getValue("routes").jsonArray.map { it.jsonObject.text("participantId") } }

class RouteHttpTest :
    DescribeSpec({
        describe("POST /v1/recommend routes (#120)") {
            it("gives every travelling person a route to every candidate, from the origin to the station") {
                testApplication {
                    application { apiModule(testConfig(), api()) }
                    val origins = listOf(codeOf("을지로입구"), codeOf("숙대입구"), codeOf("잠실"))
                    val response = client.json(HttpMethod.Post, "/v1/recommend", request(origins))
                    response.status shouldBe HttpStatusCode.OK
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", response)
                    val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
                    val ids = body.getValue("participants").jsonArray.map { it.jsonObject.text("participantId") }
                    body.cards().forEach { card ->
                        val station = card.text("stationCode")
                        val routes = card.getValue("routes").jsonArray.map { it.jsonObject }
                        routes.map { it.text("participantId") } shouldBe
                            ids.filterIndexed { i, _ -> origins[i] != station }
                        routes.forEach { route ->
                            val legs = route.getValue("legs").jsonArray.map { it.jsonObject }
                            val origin = origins[ids.indexOf(route.text("participantId"))]
                            legs
                                .first()
                                .getValue("from")
                                .jsonObject
                                .text("stationCode") shouldBe origin
                            legs
                                .last()
                                .getValue("to")
                                .jsonObject
                                .text("stationCode") shouldBe station
                            legs.zipWithNext().forEach { (a, b) -> a.getValue("to") shouldBe b.getValue("from") }
                        }
                    }
                }
            }

            it("has no routes key while the route graph is not ready, and the rest of the answer is the same") {
                val origins = listOf(codeOf("을지로입구"), codeOf("잠실"))
                val with = Json.parseToJsonElement(recommend(api(), origins)).jsonObject
                val without = recommend(api(routes = { null }), origins)
                without shouldNotContain "\"routes\""
                val stripped =
                    JsonObject(with + ("candidates" to JsonArray(with.cards().map { JsonObject(it - "routes") })))
                stripped shouldBe Json.parseToJsonElement(without).jsonObject
            }
        }

        describe("routes in a room's result") {
            it("give the hidden participant's route to that participant only") {
                runTest {
                    val room = RouteRoom("225").open()
                    room.json(null).routeIds().forEach { (room.hiddenId in it) shouldBe false }
                    room.json(room.hostToken).routeIds().forEach { (room.hiddenId in it) shouldBe false }
                    val own = room.json(room.hiddenToken)
                    own.cards().zip(own.routeIds()).forEach { (card, ids) ->
                        (room.hiddenId in ids) shouldBe (card.text("stationCode") != "225")
                    }
                }
            }

            it("serialize the same routes for others whatever station the hidden participant comes from") {
                runTest {
                    val one = RouteRoom("225").open().json(null)
                    val other = RouteRoom("130").open().json(null)

                    fun JsonObject.byStation() =
                        cards().associate {
                            it.text("stationCode") to
                                it.getValue("routes").toString()
                        }
                    val shared = one.byStation().keys.intersect(other.byStation().keys)
                    shared.isNotEmpty() shouldBe true
                    shared.forEach { one.byStation().getValue(it) shouldBe other.byStation().getValue(it) }
                }
            }
        }
    })

/** [services]로 띄운 서버의 무상태 추천 응답 본문. */
private fun recommend(
    services: ApiServices,
    origins: List<String>,
): String {
    var text = ""
    testApplication {
        application { apiModule(testConfig(), services) }
        text = client.json(HttpMethod.Post, "/v1/recommend", request(origins)).bodyAsText()
    }
    return text
}
