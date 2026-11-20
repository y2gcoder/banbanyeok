package app.banbanyeok.server.app

import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.TimeBand
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
    return apiServices(
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
                    apiServices(
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

        describe("contracts/time-slots.json vectors with both a time and a band") {
            it("are accepted by the room service unless the vector names an apiError") {
                val vectors =
                    Json
                        .parseToJsonElement(
                            java.nio.file.Path
                                .of(System.getProperty("contracts.dir"), "time-slots.json")
                                .toFile()
                                .readText(),
                        ).jsonObject
                        .getValue("vectors")
                        .jsonArray
                        .map { it.jsonObject }
                        .filter { it["time"] !is kotlinx.serialization.json.JsonNull && it["band"] != null }
                vectors.size shouldNotBe 0
                vectors.forEach { vector ->
                    val fixture =
                        app.banbanyeok.server.room
                            .RoomFixture()
                    val command =
                        CreateRoomCommand(
                            mode = RoomMode.FAIR,
                            favorTarget = null,
                            meetingDate = null,
                            host =
                                app.banbanyeok.server.room
                                    .ParticipantInput("민수", "03v"),
                            expectedCount = null,
                            deviceToken = null,
                            meetingTime = LocalTime.parse(vector.getValue("time").jsonPrimitive.content),
                            meetingBand = TimeBand.parseOrNull(vector.getValue("band").jsonPrimitive.content),
                        )
                    val error = vector["apiError"]?.jsonPrimitive?.content
                    val result = runBlocking { runCatching { fixture.service.create(command) } }
                    io.kotest.assertions.withClue(vector.getValue("id").jsonPrimitive.content) {
                        (result.exceptionOrNull() as? app.banbanyeok.server.room.RoomException)?.error?.name shouldBe
                            error
                        result.isSuccess shouldBe (error == null)
                    }
                }
            }
        }

        describe("room meetingTime") {
            it("passes the meeting time on creation and returns it on the room") {
                withMockedApi { services ->
                    val command = slot<CreateRoomCommand>()
                    coEvery { services.rooms.create(capture(command)) } returns
                        CreatedRoom(
                            ROOM,
                            "host-tok",
                            "p00001",
                            "part-tok",
                            Instant.parse("2026-11-22T15:00:00Z"),
                            "0123456789abcdef",
                        )
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
                            "0123456789abcdef",
                            Instant.EPOCH,
                            LocalTime.of(19, 30),
                        )
                    val room = client.json(HttpMethod.Get, "/v1/rooms/$ROOM")
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/$ROOM", room)
                    room
                        .json()
                        .getValue("meetingTime")
                        .jsonPrimitive.content shouldBe "19:30"
                    // 참여 화면의 "○○ 기준으로 계산해요"가 쓰는 서버 문구(결과를 계산하기 전에도 있다).
                    val basis = room.json().basis()
                    basis.getValue("label").jsonPrimitive.content shouldBe "토요일 저녁"
                    basis.getValue("timeSlot").jsonPrimitive.content shouldBe "saturday-evening"
                    basis.getValue("requestedTimeSlot").jsonPrimitive.content shouldBe "saturday-evening"
                    basis.getValue("holidayName") shouldBe kotlinx.serialization.json.JsonNull
                }
            }

            it("states the room's basis without a meeting date or time as weekday daytime, and names a holiday") {
                withMockedApi { services ->
                    fun room(
                        date: String?,
                        time: LocalTime?,
                    ) = RoomView(
                        ROOM,
                        RoomMode.FAIR,
                        null,
                        false,
                        date?.let(LocalDate::parse),
                        Instant.parse("2026-11-22T15:00:00Z"),
                        "20261116.1",
                        emptyList(),
                        "0123456789abcdef",
                        Instant.EPOCH,
                        time,
                    )
                    coEvery { services.rooms.get(ROOM, null) } returns room(null, null)
                    val plain = client.json(HttpMethod.Get, "/v1/rooms/$ROOM")
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/$ROOM", plain)
                    plain
                        .json()
                        .basis()
                        .getValue("label")
                        .jsonPrimitive.content shouldBe "평일 낮"

                    // 2026-09-25(추석, 금요일) 낮: 서버가 공휴일로 정하고 이름을 준다.
                    coEvery { services.rooms.get(ROOM, null) } returns room("2026-09-25", LocalTime.of(12, 0))
                    val holidayRoom = client.json(HttpMethod.Get, "/v1/rooms/$ROOM")
                    val holiday = holidayRoom.json().basis()
                    holiday.getValue("label").jsonPrimitive.content shouldBe "일요일·공휴일 낮"
                    holiday.getValue("holidayName").jsonPrimitive.content shouldBe "추석"
                }
            }

            it("passes a band-only meeting and states its basis without inventing a time") {
                withMockedApi { services ->
                    val command = slot<CreateRoomCommand>()
                    coEvery { services.rooms.create(capture(command)) } returns
                        CreatedRoom(
                            ROOM,
                            "host-tok",
                            "p00001",
                            "part-tok",
                            Instant.parse("2026-11-22T15:00:00Z"),
                            "0123456789abcdef",
                        )
                    val body =
                        """{"mode":"fair","meetingDate":"2026-11-21","meetingBand":"evening",""" +
                            """"host":{"originCode":"$gangnam"}}"""
                    client.json(HttpMethod.Post, "/v1/rooms", body).status shouldBe HttpStatusCode.Created
                    command.captured.meetingBand shouldBe TimeBand.EVENING
                    command.captured.meetingTime shouldBe null
                    listOf("\"dusk\"", "\"Evening\"", "1", "true").forEach { bad ->
                        val response =
                            client.json(
                                HttpMethod.Post,
                                "/v1/rooms",
                                """{"mode":"fair","meetingBand":$bad,"host":{"originCode":"$gangnam"}}""",
                            )
                        response.status shouldBe HttpStatusCode.BadRequest
                        response
                            .json()
                            .getValue("code")
                            .jsonPrimitive.content shouldBe "INVALID_MEETING_BAND"
                    }

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
                            "0123456789abcdef",
                            Instant.EPOCH,
                            meetingTime = null,
                            meetingBand = TimeBand.NIGHT,
                        )
                    val room = client.json(HttpMethod.Get, "/v1/rooms/$ROOM")
                    OpenApiContract.assertValid(HttpMethod.Get, "/v1/rooms/$ROOM", room)
                    val json = room.json()
                    json.getValue("meetingTime") shouldBe kotlinx.serialization.json.JsonNull
                    json.getValue("meetingBand").jsonPrimitive.content shouldBe "night"
                    // 시간대만 고른 토요일 밤은 그날(토요일) 운행일의 밤이다(03:00 전 규칙은 시각이 있을 때만).
                    json
                        .basis()
                        .getValue("timeSlot")
                        .jsonPrimitive.content shouldBe "saturday-night"
                    json
                        .basis()
                        .getValue("label")
                        .jsonPrimitive.content shouldBe "토요일 밤"
                }
            }

            it("distinguishes a missing meetingBand from null in a patch") {
                withMockedApi { services ->
                    val patches = mutableListOf<RoomPatch>()
                    coEvery { services.rooms.updateRoom(ROOM, "host-tok", capture(patches)) } returns
                        RoomView(
                            ROOM,
                            RoomMode.FAIR,
                            null,
                            false,
                            null,
                            Instant.EPOCH,
                            "20261116.1",
                            emptyList(),
                            "0123456789abcdef",
                            Instant.EPOCH,
                        )
                    client.json(
                        HttpMethod.Patch,
                        "/v1/rooms/$ROOM",
                        """{"meetingBand":"morning"}""",
                        token = "host-tok",
                    )
                    client.json(HttpMethod.Patch, "/v1/rooms/$ROOM", """{"meetingBand":null}""", token = "host-tok")
                    client.json(HttpMethod.Patch, "/v1/rooms/$ROOM", """{"locked":false}""", token = "host-tok")
                    patches[0].meetingBand shouldBe Change.Set(TimeBand.MORNING)
                    patches[1].meetingBand shouldBe Change.Set(null)
                    patches[2].meetingBand shouldBe Change.Unchanged
                    val bad =
                        client.json(
                            HttpMethod.Patch,
                            "/v1/rooms/$ROOM",
                            """{"meetingBand":"noon"}""",
                            token = "host-tok",
                        )
                    bad.status shouldBe HttpStatusCode.BadRequest
                    bad
                        .json()
                        .getValue("code")
                        .jsonPrimitive.content shouldBe "INVALID_MEETING_BAND"
                }
            }

            it("distinguishes a missing meetingTime from null and rejects a malformed one") {
                withMockedApi { services ->
                    val patches = mutableListOf<RoomPatch>()
                    coEvery { services.rooms.updateRoom(ROOM, "host-tok", capture(patches)) } returns
                        RoomView(
                            ROOM,
                            RoomMode.FAIR,
                            null,
                            false,
                            null,
                            Instant.EPOCH,
                            "20261116.1",
                            emptyList(),
                            "0123456789abcdef",
                            Instant.EPOCH,
                        )
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
