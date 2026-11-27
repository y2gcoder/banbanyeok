package app.banbanyeok.server.app

import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.app.application.PreviewBasis
import app.banbanyeok.server.app.application.PreviewRoom
import app.banbanyeok.server.app.application.PreviewStation
import app.banbanyeok.server.app.application.PreviewTime
import app.banbanyeok.server.app.application.RoomPreview
import app.banbanyeok.server.app.application.RoomResult
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.RecommendParticipant
import app.banbanyeok.server.recommendation.RecommendRequest
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.time.TimeBasis
import app.banbanyeok.server.room.Decision
import app.banbanyeok.server.room.ParticipantView
import app.banbanyeok.server.room.RoomError
import app.banbanyeok.server.room.RoomException
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomView
import app.banbanyeok.server.room.ShareVersion
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.mockk.coEvery
import io.mockk.confirmVerified
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.time.Instant

private const val ROOM_ID = "abcdefghjk"
private val decidedAt = Instant.parse("2026-11-17T03:00:00Z")
private val station get() = DevArtifacts.origins.first()
private val otherStation get() = DevArtifacts.origins.last()

private fun room(
    version: Long,
    decision: Decision? = null,
) = RoomView(
    id = ROOM_ID,
    mode = RoomMode.FAIR,
    favorParticipantId = null,
    locked = false,
    meetingDate = null,
    expiresAt = Instant.parse("2026-11-24T03:00:00Z"),
    dataVersion = "20261112.6",
    participants =
        listOf(
            ParticipantView("p00001", "민수", station, isHost = true, isSelf = true),
            ParticipantView("p00002", null, otherStation, isHost = false, isSelf = false),
        ),
    roomHash = "0123456789abcdef",
    createdAt = Instant.parse("2026-11-17T00:00:00Z"),
    shareVersion = ShareVersion(version),
    decision = decision,
)

private val header =
    PreviewRoom(ROOM_ID, ShareVersion(5), 2, true, null, null, null, TimeBasis(TimeSlot.DEFAULT, "평일 낮"))
private val times = listOf(PreviewTime("민수", 600), PreviewTime("참가자 2", null))
private val previews =
    listOf(
        RoomPreview.Collecting(header.copy(participantCount = 1)),
        RoomPreview.Result(
            header,
            "20261112.6",
            PreviewBasis(RecommendMode.FAIR, null),
            PreviewStation(station, times),
        ),
        RoomPreview.Decided(
            header.copy(canJoin = false),
            "20261112.6",
            PreviewBasis(RecommendMode.FAVOR, "민수"),
            PreviewStation(otherStation, times),
            "참가자 2",
            decidedAt,
        ),
    )

private fun body(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

private fun code(text: String) = body(text).getValue("code").jsonPrimitive.content

class ShareHttpTest :
    DescribeSpec({
        val path = "/v1/rooms/$ROOM_ID/decision"

        describe("PUT /rooms/{roomId}/decision") {
            it("decides with the station and the version the screen saw, and answers the room") {
                withMockedApi { services ->
                    coEvery { services.rooms.decide(ROOM_ID, "part-tok", station, ShareVersion(3)) } returns
                        room(4, Decision(station, "p00001", decidedAt))
                    val response =
                        client.json(HttpMethod.Put, path, """{"stationCode":"$station","seenVersion":3}""", "part-tok")
                    response.status shouldBe HttpStatusCode.OK
                    OpenApiContract.assertValid(HttpMethod.Put, path, response)
                    val json = body(response.bodyAsText())
                    json.getValue("shareVersion").jsonPrimitive.long shouldBe 4
                    val decision = json.getValue("decision").jsonObject
                    decision.getValue("decidedBy").jsonPrimitive.content shouldBe "p00001"
                    decision.getValue("stationName").jsonPrimitive.content shouldBe
                        DevArtifacts.directory.nameOf(station)
                }
            }

            it("undoes with a null station") {
                withMockedApi { services ->
                    coEvery { services.rooms.decide(ROOM_ID, "part-tok", null, ShareVersion(4)) } returns room(5)
                    val response =
                        client.json(
                            HttpMethod.Put,
                            path,
                            """{"stationCode":null,"seenVersion":4}""",
                            "part-tok",
                        )
                    response.status shouldBe HttpStatusCode.OK
                    OpenApiContract.assertValid(HttpMethod.Put, path, response)
                    response.bodyAsText().contains("\"decision\":null") shouldBe true
                }
            }

            it("rejects a body without both keys or with a negative version before calling the service") {
                withMockedApi { services ->
                    for (bad in listOf(
                        """{"seenVersion":4}""",
                        """{"stationCode":null}""",
                        """{"stationCode":null,"seenVersion":-1}""",
                    )) {
                        val response = client.json(HttpMethod.Put, path, bad, "part-tok")
                        response.status shouldBe HttpStatusCode.BadRequest
                        code(response.bodyAsText()) shouldBe "INVALID_REQUEST"
                        OpenApiContract.assertValid(HttpMethod.Put, path, response)
                    }
                    confirmVerified(services.rooms)
                }
            }

            it("answers a stale screen and a lone participant with documented 409s") {
                withMockedApi { services ->
                    for (error in listOf(RoomError.ROOM_CHANGED, RoomError.NOT_ENOUGH_PARTICIPANTS)) {
                        coEvery { services.rooms.decide(ROOM_ID, "part-tok", station, ShareVersion(1)) } throws
                            RoomException(error, "x")
                        val response =
                            client.json(
                                HttpMethod.Put,
                                path,
                                """{"stationCode":"$station","seenVersion":1}""",
                                "part-tok",
                            )
                        response.status shouldBe HttpStatusCode.Conflict
                        code(response.bodyAsText()) shouldBe error.name
                        OpenApiContract.assertValid(HttpMethod.Put, path, response)
                    }
                }
            }
        }

        describe("GET /rooms/{roomId}/preview") {
            val previewPath = "/v1/rooms/$ROOM_ID/preview"

            it("answers every stage in the documented shape, with no origin field and no caching") {
                for (preview in previews) {
                    withMockedApi { services ->
                        coEvery { services.results.preview(ROOM_ID) } returns preview
                        val response = client.json(HttpMethod.Get, previewPath, token = "part-tok")
                        response.status shouldBe HttpStatusCode.OK
                        OpenApiContract.assertValid(HttpMethod.Get, previewPath, response)
                        response.headers[HttpHeaders.CacheControl] shouldBe "no-store"
                        val text = response.bodyAsText()
                        text shouldNotContain "origin"
                        body(text).getValue("stage").jsonPrimitive.content shouldBe
                            preview::class.simpleName!!.lowercase()
                    }
                }
            }

            it("maps a room whose stations left the data to the documented 409") {
                withMockedApi { services ->
                    coEvery { services.results.preview(ROOM_ID) } throws
                        app.banbanyeok.server.app.application.AppException(
                            app.banbanyeok.server.room.ErrorKind.CONFLICT,
                            "STATION_UNAVAILABLE",
                            "x",
                        )
                    val response = client.json(HttpMethod.Get, previewPath)
                    response.status shouldBe HttpStatusCode.Conflict
                    OpenApiContract.assertValid(HttpMethod.Get, previewPath, response)
                }
            }
        }

        describe("share versions on rooms and results") {
            it("puts the version a room result was computed from on the result") {
                withMockedApi { services ->
                    val people = room(7).participants
                    val request =
                        RecommendRequest(
                            listOf(
                                RecommendParticipant("p00001", "민수", station),
                                RecommendParticipant("p00002", null, otherStation),
                            ),
                            RecommendMode.FAIR,
                        )
                    val recommendation =
                        RecommendationService(
                            DevArtifacts.directory.travel,
                            DevArtifacts.directory,
                        ).evaluate(request)
                            .recommendation
                    coEvery { services.results.result(ROOM_ID, null, null, null) } returns
                        RoomResult(recommendation, people, ShareVersion(7))
                    val response = client.json(HttpMethod.Get, "/v1/rooms/$ROOM_ID/result")
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/$ROOM_ID/result", response)
                    body(response.bodyAsText()).getValue("shareVersion").jsonPrimitive.long shouldBe 7
                }
            }
        }
    })
