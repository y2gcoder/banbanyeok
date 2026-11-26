@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.app

import app.banbanyeok.links.LinkDecoding
import app.banbanyeok.links.ShareLinkCodec
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.app.application.BackgroundLastTrains
import app.banbanyeok.server.app.application.BackgroundSlots
import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.app.application.StationDirectory
import app.banbanyeok.server.artifact.ArtifactLoader
import app.banbanyeok.server.artifact.LoadedArtifacts
import app.banbanyeok.server.artifact.LocalFileArtifactStore
import app.banbanyeok.server.artifact.PublishedArtifacts
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.room.Activity
import app.banbanyeok.server.room.Change
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.MutableClock
import app.banbanyeok.server.room.NewHiddenOrigins
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomError
import app.banbanyeok.server.room.RoomException
import app.banbanyeok.server.room.RoomFixture
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomPatch
import app.banbanyeok.server.room.RoomRepository
import app.banbanyeok.server.room.RoomService
import app.banbanyeok.server.room.aParticipant
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path
import java.time.Instant
import java.time.LocalDate
import kotlin.concurrent.thread
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeSource

class RegionalHttpTest :
    DescribeSpec({
        it("checks regions even when an old share link names two stations with the same name") {
            withRegionalApi {
                val link = ShareLinkCodec.decodeQuery("v=1&o=002.003&m=f") as LinkDecoding.Success
                val origins = link.link.origins.joinToString(",") { code -> "\"$code\"" }
                client.json(HttpMethod.Post, "/v1/recommend", recommend(origins)).assertRegionMismatch()
                val accepted = client.json(HttpMethod.Post, "/v1/recommend", recommend("\"001\",\"002\""))
                accepted.status shouldBe HttpStatusCode.OK
                accepted.objectBody().containsKey("missingServices") shouldBe false
            }
        }

        it("keeps Saturday recommendations on supported lines and reports unknown timetables") {
            withRegionalApi {
                val supported =
                    client.json(
                        HttpMethod.Post,
                        "/v1/recommend",
                        recommend("\"003\",\"004\"", "saturday-day"),
                    )
                supported.status shouldBe HttpStatusCode.OK
                val result = supported.objectBody()
                result.getValue("missingServices").jsonArray.map { line -> line.jsonPrimitive.content } shouldBe
                    listOf("동해선")
                result
                    .getValue("candidates")
                    .jsonArray
                    .single()
                    .jsonObject
                    .text("stationCode") shouldBe "004"
                result.getValue("timeBasis").jsonObject.text("timeSlot") shouldBe "saturday-day"
                result.containsKey("lastTrainBasis") shouldBe false

                val unknown =
                    client.json(
                        HttpMethod.Post,
                        "/v1/recommend",
                        recommend("\"003\",\"005\"", "saturday-day"),
                    )
                unknown.status shouldBe HttpStatusCode.Conflict
                unknown.objectBody().text("code") shouldBe "SCHEDULE_UNAVAILABLE"
            }
        }

        it("creates a Busan room, checks both original and retried joins, and preserves it after rejected edits") {
            withRegionalApi {
                val created =
                    client.json(
                        HttpMethod.Post,
                        "/v1/rooms",
                        """{"mode":"fair","host":{"originCode":"003"}}""",
                    )
                created.status shouldBe HttpStatusCode.Created
                val host = created.objectBody()
                val path = "/v1/rooms/${host.text("roomId")}"
                val joinPath = "$path/participants"
                client.json(HttpMethod.Post, joinPath, """{"originCode":"002"}""").assertRegionMismatch()

                val joined =
                    client.json(HttpMethod.Post, joinPath, """{"originCode":"004"}""") {
                        headers.append("Idempotency-Key", "regional-test")
                    }
                joined.status shouldBe HttpStatusCode.Created
                client
                    .json(HttpMethod.Post, joinPath, """{"originCode":"002"}""") {
                        headers.append("Idempotency-Key", "regional-test")
                    }.assertRegionMismatch()

                val member = joined.objectBody()
                val memberPath = "$joinPath/${member.text("participantId")}"
                client
                    .json(HttpMethod.Put, memberPath, """{"originCode":"002"}""", member.text("participantToken"))
                    .assertRegionMismatch()
                val current = client.json(HttpMethod.Get, path).objectBody()
                val seen = current.getValue("shareVersion")
                client
                    .json(
                        HttpMethod.Put,
                        "$path/decision",
                        """{"stationCode":"002","seenVersion":$seen}""",
                        host.text("participantToken"),
                    ).assertRegionMismatch()
                client.json(HttpMethod.Get, "$path/result").status shouldBe HttpStatusCode.OK
                client.json(HttpMethod.Get, "$path/preview").status shouldBe HttpStatusCode.OK
            }
        }

        it("keeps a metropolitan room metropolitan when its only member tries to move to Busan") {
            withRegionalApi {
                val created =
                    client.json(
                        HttpMethod.Post,
                        "/v1/rooms",
                        """{"mode":"fair","host":{"originCode":"002"}}""",
                    )
                created.status shouldBe HttpStatusCode.Created
                val host = created.objectBody()
                val path = "/v1/rooms/${host.text("roomId")}"
                client
                    .json(
                        HttpMethod.Put,
                        "$path/participants/${host.text("participantId")}",
                        """{"originCode":"003"}""",
                        host.text("participantToken"),
                    ).assertRegionMismatch()
                client.json(HttpMethod.Post, "$path/participants", """{"originCode":"004"}""").assertRegionMismatch()
                client
                    .json(HttpMethod.Post, "$path/participants", """{"originCode":"001"}""")
                    .status shouldBe HttpStatusCode.Created
                client.json(HttpMethod.Get, path).participantCodes() shouldBe listOf("002", "001")
            }
        }

        it("does not store a participant without a timetable for the room's day, so the result stays computable") {
            withRegionalApi {
                val saturday = ""","meetingDate":"2026-11-28""""
                client
                    .json(HttpMethod.Post, "/v1/rooms", """{"mode":"fair","host":{"originCode":"005"}$saturday}""")
                    .assertScheduleUnavailable()
                val busanSaturday = """{"mode":"fair","host":{"originCode":"003"}$saturday}"""
                val created = client.json(HttpMethod.Post, "/v1/rooms", busanSaturday)
                created.status shouldBe HttpStatusCode.Created
                val path = "/v1/rooms/${created.objectBody().text("roomId")}"
                client
                    .json(HttpMethod.Post, "$path/participants", """{"originCode":"005"}""")
                    .assertScheduleUnavailable()
                client.json(HttpMethod.Get, path).participantCodes() shouldBe listOf("003")

                val joined = client.json(HttpMethod.Post, "$path/participants", """{"originCode":"004"}""")
                joined.status shouldBe HttpStatusCode.Created
                val member = joined.objectBody()
                client
                    .json(
                        HttpMethod.Put,
                        "$path/participants/${member.text("participantId")}",
                        """{"originCode":"005"}""",
                        member.text("participantToken"),
                    ).assertScheduleUnavailable()
                client.json(HttpMethod.Get, path).participantCodes() shouldBe listOf("003", "004")
                client.json(HttpMethod.Get, "$path/result").status shouldBe HttpStatusCode.OK

                val weekday =
                    client.json(HttpMethod.Post, "/v1/rooms", """{"mode":"fair","host":{"originCode":"003"}}""")
                val weekdayPath = "/v1/rooms/${weekday.objectBody().text("roomId")}"
                client
                    .json(HttpMethod.Post, "$weekdayPath/participants", """{"originCode":"005"}""")
                    .status shouldBe HttpStatusCode.Created
            }
        }

        it("checks the room's current day when the host changes it between a participant's read and write") {
            withRegionalApi { fixture ->
                val host = fixture.service.create(command("003"))
                val member = fixture.service.join(host.roomId, ParticipantInput(null, "004", false), null)
                var changeDayOnRead = false
                val racing =
                    object : RoomRepository by fixture.rooms {
                        override suspend fun find(roomId: String) =
                            fixture.rooms.find(roomId).also {
                                if (changeDayOnRead) {
                                    changeDayOnRead = false
                                    fixture.service.updateRoom(
                                        roomId,
                                        host.hostToken,
                                        RoomPatch(meetingDate = Change.Set(LocalDate.parse("2026-11-28"))),
                                    )
                                }
                            }
                    }
                val service =
                    RoomService(racing, fixture.anonUsers, fixture.tokens, fixture.ids, fixture.stations, fixture.clock)
                val path = "/v1/rooms/${host.roomId}"

                changeDayOnRead = true
                shouldThrow<RoomException> {
                    service.join(host.roomId, ParticipantInput(null, "005", false), null)
                }.error shouldBe RoomError.SCHEDULE_UNAVAILABLE
                client.json(HttpMethod.Get, path).participantCodes() shouldBe listOf("003", "004")

                fixture.service.updateRoom(host.roomId, host.hostToken, RoomPatch(meetingDate = Change.Set(null)))
                changeDayOnRead = true
                shouldThrow<RoomException> {
                    service.updateParticipant(
                        host.roomId,
                        member.participantId,
                        member.participantToken,
                        ParticipantInput(null, "005", false),
                    )
                }.error shouldBe RoomError.SCHEDULE_UNAVAILABLE
                client.json(HttpMethod.Get, path).participantCodes() shouldBe listOf("003", "004")
                client.json(HttpMethod.Get, "$path/result").status shouldBe HttpStatusCode.OK
            }
        }

        it("judges a room write by the same slot matrices the result needs, waiting for them as the result does") {
            val saturdayRoom = """{"mode":"fair","host":{"originCode":"003"},"meetingDate":"2026-11-28"}"""
            val failed = CompletableDeferred<Map<TimeSlot, OdMatrix>>()
            failed.completeExceptionally(IllegalStateException("구분 행렬 검증 실패(테스트)"))
            val unusable =
                listOf(BackgroundSlots(failed), BackgroundSlots(CompletableDeferred(), wait = 10.milliseconds))
            unusable.forEach { slots ->
                withRegionalApi({ slots }) {
                    client.json(HttpMethod.Post, "/v1/rooms", saturdayRoom).assertScheduleUnavailable()
                    val weekday =
                        client.json(HttpMethod.Post, "/v1/rooms", """{"mode":"fair","host":{"originCode":"003"}}""")
                    weekday.status shouldBe HttpStatusCode.Created
                    client
                        .json(HttpMethod.Post, "/v1/rooms", """{"mode":"fair","host":{"originCode":"001"}}""")
                        .status shouldBe HttpStatusCode.Created
                }
            }
            val late = CompletableDeferred<Map<TimeSlot, OdMatrix>>()
            lateinit var verified: Map<TimeSlot, OdMatrix>
            withRegionalApi({ loaded ->
                verified = loaded.slots.await()
                BackgroundSlots(late)
            }) {
                thread {
                    Thread.sleep(300)
                    late.complete(verified)
                }
                val created = client.json(HttpMethod.Post, "/v1/rooms", saturdayRoom)
                created.status shouldBe HttpStatusCode.Created
                val path = "/v1/rooms/${created.objectBody().text("roomId")}"
                client
                    .json(HttpMethod.Post, "$path/participants", """{"originCode":"004"}""")
                    .status shouldBe HttpStatusCode.Created
                client.json(HttpMethod.Get, "$path/result").status shouldBe HttpStatusCode.OK
            }
        }

        it("does not make a Capital room write wait for slot matrices that cannot change its verdict") {
            val saturdayRoom = """{"mode":"fair","host":{"originCode":"001"},"meetingDate":"2026-11-28"}"""
            withRegionalApi({ BackgroundSlots(CompletableDeferred(), wait = 30.seconds) }) {
                val started = TimeSource.Monotonic.markNow()
                val created = client.json(HttpMethod.Post, "/v1/rooms", saturdayRoom)
                created.status shouldBe HttpStatusCode.Created
                val room = created.objectBody()
                val path = "/v1/rooms/${room.text("roomId")}"
                val member = client.json(HttpMethod.Post, "$path/participants", """{"originCode":"002"}""").objectBody()
                client
                    .json(
                        HttpMethod.Put,
                        "$path/participants/${member.text("participantId")}",
                        """{"originCode":"002","nickname":"새 이름"}""",
                        member.text("participantToken"),
                    ).status shouldBe HttpStatusCode.OK
                (started.elapsedNow() < 5.seconds) shouldBe true
            }
        }

        it("answers REGION_MISMATCH before the room's day for a station of another region") {
            withRegionalApi {
                val created =
                    client.json(
                        HttpMethod.Post,
                        "/v1/rooms",
                        """{"mode":"fair","host":{"originCode":"001"},"meetingDate":"2026-11-28"}""",
                    )
                created.status shouldBe HttpStatusCode.Created
                val path = "/v1/rooms/${created.objectBody().text("roomId")}"
                client.json(HttpMethod.Post, "$path/participants", """{"originCode":"005"}""").assertRegionMismatch()
                val member = client.json(HttpMethod.Post, "$path/participants", """{"originCode":"002"}""").objectBody()
                client
                    .json(
                        HttpMethod.Put,
                        "$path/participants/${member.text("participantId")}",
                        """{"originCode":"005"}""",
                        member.text("participantToken"),
                    ).assertRegionMismatch()
                client.json(HttpMethod.Get, path).participantCodes() shouldBe listOf("001", "002")
            }
        }

        it("rejects result and preview of an already stored mixed room") {
            withRegionalApi { fixture ->
                val room = fixture.service.create(command("001"))
                val now = fixture.clock.instant()
                val other = aParticipant("pid002", now) { participant -> participant.copy(originCode = "003") }
                fixture.rooms.addParticipant(room.roomId, other, Activity(now, room.expiresAt))
                client.json(HttpMethod.Get, "/v1/rooms/${room.roomId}/result").assertRegionMismatch()
                client.json(HttpMethod.Get, "/v1/rooms/${room.roomId}/preview").assertRegionMismatch()
            }
        }

        it("keeps a legacy hidden station and its region out of public room data and mixed errors") {
            withRegionalApi { fixture ->
                val legacy =
                    RoomService(
                        fixture.rooms,
                        fixture.anonUsers,
                        fixture.tokens,
                        fixture.ids,
                        fixture.stations,
                        fixture.clock,
                        newHidden = NewHiddenOrigins.LEGACY_FIXTURE,
                    )
                val responses =
                    listOf("001", "002").map { code ->
                        val created = legacy.create(command(code, hidden = true))
                        val path = "/v1/rooms/${created.roomId}"
                        val state = client.json(HttpMethod.Get, path).objectBody()
                        val hidden =
                            state
                                .getValue("participants")
                                .jsonArray
                                .single()
                                .jsonObject
                        hidden["originCode"] shouldBe JsonNull
                        hidden.containsKey("region") shouldBe false
                        val mismatch = client.json(HttpMethod.Post, "$path/participants", """{"originCode":"003"}""")
                        mismatch.assertRegionMismatch()
                        mismatch.bodyAsText()
                    }
                responses.distinct().size shouldBe 1
            }
        }
    })

private fun recommend(
    origins: String,
    slot: String? = null,
): String {
    val time = slot?.let { ""","timeSlot":"$it"""" }.orEmpty()
    return """{"origins":[$origins],"mode":"fair"$time}"""
}

private fun command(
    code: String,
    hidden: Boolean = false,
) = CreateRoomCommand(RoomMode.FAIR, null, null, ParticipantInput(null, code, hidden), null, null)

private suspend fun HttpResponse.objectBody() = Json.parseToJsonElement(bodyAsText()).jsonObject

private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content

private suspend fun HttpResponse.assertRegionMismatch() {
    status shouldBe HttpStatusCode.BadRequest
    val error = objectBody()
    error.text("code") shouldBe "REGION_MISMATCH"
    error.text("detail") shouldBe "방과 추천은 한 권역 안에서 계산합니다"
}

private suspend fun HttpResponse.assertScheduleUnavailable() {
    status shouldBe HttpStatusCode.Conflict
    objectBody().text("code") shouldBe "SCHEDULE_UNAVAILABLE"
}

private suspend fun HttpResponse.participantCodes() =
    objectBody().getValue("participants").jsonArray.map { it.jsonObject.text("originCode") }

private fun withRegionalApi(
    slotsOf: suspend (LoadedArtifacts) -> BackgroundSlots = { BackgroundSlots(it.slots) },
    block: suspend ApplicationTestBuilder.(RoomFixture) -> Unit,
) {
    testApplication {
        val store =
            LocalFileArtifactStore(Path.of(System.getProperty("contracts.dir"), "fixtures"), UnconfinedTestDispatcher())
        val loaded = ArtifactLoader(store, regional = true).load()
        loaded.slots.await()
        loaded.lastTrains.await()
        val slots = slotsOf(loaded)
        val directory = StationDirectory(loaded.dataSet, slots, testTimes, slots)
        val fixture = RoomFixture(clock = MutableClock(Instant.parse("2026-11-26T03:00:00Z")), stations = directory)
        val lastTrains = BackgroundLastTrains(loaded.lastTrains, LocalDate.parse("2026-11-26"), emptySet())
        val recommendation =
            RecommendationService(
                directory.travel,
                directory,
                lastTrains = lastTrains,
                clock = fixture.clock,
                slotsReady = slots,
            )
        val results = RoomResultService(fixture.service, recommendation, testTimes)
        application {
            val services =
                apiServices(
                    fixture.anonService,
                    fixture.service,
                    results,
                    recommendation,
                    directory,
                    PublishedArtifacts(store, loaded),
                )
            apiModule(testConfig(), services, fixture.clock)
        }
        block(fixture)
    }
}
