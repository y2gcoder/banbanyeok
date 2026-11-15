package app.banbanyeok.server.app

import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.app.application.BackgroundSlots
import app.banbanyeok.server.app.application.StationDirectory
import app.banbanyeok.server.app.http.ApiServices
import app.banbanyeok.server.artifact.ArtifactLoader
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.room.Change
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.CreatedRoom
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomPatch
import app.banbanyeok.server.room.RoomView
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import io.mockk.coEvery
import io.mockk.slot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

private const val ROOM = "abcdefghjk"

/** 실제 추천 서비스와 data/artifacts/dev(구분 12개)로 /recommend를 돌린다. */
private fun realApi(): ApiServices {
    val mocks = MockedServices()
    return ApiServices(
        mocks.anon,
        mocks.rooms,
        mocks.results,
        RecommendationService(DevArtifacts.directory.travel, DevArtifacts.directory),
        DevArtifacts.directory,
        DevArtifacts.published,
    )
}

private suspend fun HttpResponse.json(): JsonObject = Json.parseToJsonElement(bodyAsText()).jsonObject

private fun JsonObject.basis(): JsonObject = getValue("timeBasis").jsonObject

private fun JsonObject.firstMax(): Int =
    getValue("candidates")
        .jsonArray
        .first()
        .jsonObject
        .getValue("maxSeconds")
        .jsonPrimitive.content
        .toInt()

class TimeSlotHttpTest :
    DescribeSpec({
        val gangnam = DevArtifacts.directory.originCodes.first { DevArtifacts.directory.nameOf(it) == "강남" }
        val hongdae = DevArtifacts.directory.originCodes.first { DevArtifacts.directory.nameOf(it) == "홍대입구" }

        describe("POST /v1/recommend timeSlot") {
            it("defaults to weekday daytime, like old share links, and computes the requested slot") {
                testApplication {
                    application { apiModule(testConfig(), realApi()) }
                    val base = """{"origins":["$gangnam","$hongdae"],"mode":"fair""""
                    val plain = client.json(HttpMethod.Post, "/v1/recommend", "$base}")
                    plain.status shouldBe HttpStatusCode.OK
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", plain)
                    val weekday = plain.json()
                    weekday
                        .basis()
                        .getValue("timeSlot")
                        .jsonPrimitive.content shouldBe "weekday-day"
                    weekday
                        .basis()
                        .getValue("label")
                        .jsonPrimitive.content shouldBe "평일 낮"

                    val explicit = client.json(HttpMethod.Post, "/v1/recommend", """$base,"timeSlot":"weekday-day"}""")
                    explicit.json().getValue("candidates") shouldBe weekday.getValue("candidates")

                    val night = client.json(HttpMethod.Post, "/v1/recommend", """$base,"timeSlot":"saturday-night"}""")
                    night.status shouldBe HttpStatusCode.OK
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", night)
                    val saturday = night.json()
                    saturday
                        .basis()
                        .getValue("label")
                        .jsonPrimitive.content shouldBe "토요일 밤"
                    saturday
                        .basis()
                        .getValue("dayType")
                        .jsonPrimitive.content shouldBe "saturday"
                    saturday
                        .basis()
                        .getValue("band")
                        .jsonPrimitive.content shouldBe "night"
                    saturday.firstMax() shouldNotBe weekday.firstMax()
                    saturday
                        .basis()
                        .getValue("requestedTimeSlot")
                        .jsonPrimitive.content shouldBe "saturday-night"

                    val explicitNull = client.json(HttpMethod.Post, "/v1/recommend", """$base,"timeSlot":null}""")
                    explicitNull
                        .json()
                        .basis()
                        .getValue("timeSlot")
                        .jsonPrimitive.content shouldBe "weekday-day"
                }
            }

            it("rejects an unknown or non-string slot with the documented 400") {
                testApplication {
                    application { apiModule(testConfig(), realApi()) }
                    for (value in listOf("\"sunday-dawn\"", "5", "[\"weekday-day\"]")) {
                        val response =
                            client.json(
                                HttpMethod.Post,
                                "/v1/recommend",
                                """{"origins":["$gangnam","$hongdae"],"mode":"fair","timeSlot":$value}""",
                            )
                        response.status shouldBe HttpStatusCode.BadRequest
                        response
                            .json()
                            .getValue("code")
                            .jsonPrimitive.content shouldBe "INVALID_TIME_SLOT"
                        OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", response)
                    }
                }
            }

            it("answers 200 on the default slot when the slot matrices failed verification") {
                val loaded = runBlocking { ArtifactLoader(DevArtifacts.store).load() }
                val failed = CompletableDeferred<Map<TimeSlot, OdMatrix>>()
                failed.completeExceptionally(IllegalStateException("구분 행렬 검증 실패(테스트)"))
                val directory = StationDirectory(loaded.dataSet, BackgroundSlots(failed))
                val mocks = MockedServices()
                val api =
                    ApiServices(
                        mocks.anon,
                        mocks.rooms,
                        mocks.results,
                        RecommendationService(directory.travel, directory),
                        directory,
                        DevArtifacts.published,
                    )
                testApplication {
                    application { apiModule(testConfig(), api) }
                    val response =
                        client.json(
                            HttpMethod.Post,
                            "/v1/recommend",
                            """{"origins":["$gangnam","$hongdae"],"mode":"fair","timeSlot":"saturday-night"}""",
                        )
                    response.status shouldBe HttpStatusCode.OK
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", response)
                    val basis = response.json().basis()
                    basis.getValue("timeSlot").jsonPrimitive.content shouldBe "weekday-day"
                    basis.getValue("requestedTimeSlot").jsonPrimitive.content shouldBe "saturday-night"
                    basis.getValue("label").jsonPrimitive.content shouldBe "평일 낮"
                }
            }
        }

        describe("room meetingTime") {
            it("passes the meeting time on creation and returns it on the room") {
                withMockedApi { services ->
                    val command = slot<CreateRoomCommand>()
                    coEvery { services.rooms.create(capture(command)) } returns
                        CreatedRoom(ROOM, "host-tok", "p00001", "part-tok", Instant.parse("2026-11-22T15:00:00Z"))
                    val body =
                        """{"mode":"fair","meetingDate":"2026-11-21","meetingTime":"19:30",""" +
                            """"host":{"originCode":"$gangnam"}}"""
                    val created = client.json(HttpMethod.Post, "/v1/rooms", body)
                    created.status shouldBe HttpStatusCode.Created
                    command.captured.meetingTime shouldBe LocalTime.of(19, 30)
                    val notText =
                        client.json(
                            HttpMethod.Post,
                            "/v1/rooms",
                            """{"mode":"fair","meetingTime":1930,"host":{"originCode":"$gangnam"}}""",
                        )
                    notText.status shouldBe HttpStatusCode.BadRequest
                    notText
                        .json()
                        .getValue("code")
                        .jsonPrimitive.content shouldBe "INVALID_MEETING_TIME"

                    coEvery { services.rooms.get(ROOM, null) } returns
                        RoomView(
                            ROOM,
                            RoomMode.FAIR,
                            null,
                            false,
                            LocalDate.parse("2026-11-21"),
                            Instant.parse("2026-11-22T15:00:00Z"),
                            "20261116.1",
                            emptyList(),
                            LocalTime.of(19, 30),
                        )
                    val room = client.json(HttpMethod.Get, "/v1/rooms/$ROOM")
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/$ROOM", room)
                    room
                        .json()
                        .getValue("meetingTime")
                        .jsonPrimitive.content shouldBe "19:30"
                }
            }

            it("distinguishes a missing meetingTime from null and rejects a malformed one") {
                withMockedApi { services ->
                    val patches = mutableListOf<RoomPatch>()
                    coEvery { services.rooms.updateRoom(ROOM, "host-tok", capture(patches)) } returns
                        RoomView(ROOM, RoomMode.FAIR, null, false, null, Instant.EPOCH, "20261116.1", emptyList())
                    client.json(HttpMethod.Patch, "/v1/rooms/$ROOM", """{"meetingTime":"08:05"}""", token = "host-tok")
                    client.json(HttpMethod.Patch, "/v1/rooms/$ROOM", """{"meetingTime":null}""", token = "host-tok")
                    client.json(HttpMethod.Patch, "/v1/rooms/$ROOM", """{"locked":false}""", token = "host-tok")
                    patches[0].meetingTime shouldBe Change.Set(LocalTime.of(8, 5))
                    patches[1].meetingTime shouldBe Change.Set(null)
                    patches[2].meetingTime shouldBe Change.Unchanged
                    listOf("\"8:05\"", "\"24:00\"", "\"19:30:00\"", "1930", "true").forEach { bad ->
                        val response =
                            client.json(
                                HttpMethod.Patch,
                                "/v1/rooms/$ROOM",
                                """{"meetingTime":$bad}""",
                                token = "host-tok",
                            )
                        response.status shouldBe HttpStatusCode.BadRequest
                        response
                            .json()
                            .getValue("code")
                            .jsonPrimitive.content shouldBe "INVALID_MEETING_TIME"
                    }
                }
            }
        }
    })
