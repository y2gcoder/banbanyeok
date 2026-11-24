package app.banbanyeok.server.app

import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.recommendation.OdTravelTimeProvider
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.StationNames
import app.banbanyeok.server.recommendation.codeNames
import app.banbanyeok.server.recommendation.lasttrain.LastTrainData
import app.banbanyeok.server.recommendation.mapmiddle.GeoPoint
import app.banbanyeok.server.recommendation.sampleLastTrainAsOf
import app.banbanyeok.server.recommendation.sampleLastTrains
import app.banbanyeok.server.recommendation.sampleRouteGraph
import app.banbanyeok.server.recommendation.smallOd
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomPatch
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldNotContain
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** #143: compare the entire wire response, including future person-specific fields, without masking times. */
class HiddenOriginNoninterferenceHttpTest :
    DescribeSpec({
        it("changing only a hidden origin cannot change any other viewer's response") {
            // The two hidden rows differ in exact seconds and transfers, but have the same five-minute buckets.
            // Origins are not candidates or visible route endpoints: a public meeting/route may legitimately name one.
            val od =
                smallOd(
                    listOf("03v", "130", "225", "31a"),
                    listOf("03v", "31a", "4xz"),
                    listOf(
                        listOf(0, 1800, null),
                        listOf(850, 1450, 1000),
                        listOf(900, 1500, 1050),
                        listOf(2100, 0, null),
                    ),
                    listOf(listOf(0, 2, 0), listOf(0, 1, 1), listOf(2, 3, 2), listOf(2, 0, 0)),
                )
            val directory = DevArtifacts.directory
            val recommendation =
                RecommendationService(
                    OdTravelTimeProvider(od, "20261120.1", TimeSlot.ALL.associateWith { od }),
                    hiddenOriginNames,
                    locations = { GeoPoint(37.5, 127.0) },
                    routes = { sampleRouteGraph() },
                    lastTrains = { LastTrainData(sampleLastTrains, sampleLastTrainAsOf) },
                    clock = Clock.fixed(Instant.parse("2026-11-27T03:00:00Z"), ZoneOffset.UTC),
                )
            val rooms =
                listOf("130", "225").map {
                    RouteRoom(it, recommendation, LocalDate.parse("2026-11-27")).open()
                }
            // Guard against a vacuous pair: the hidden person still receives different exact values and all features.
            val ownTimes =
                rooms.map { room ->
                    val own = room.results.result(room.roomId, room.hiddenToken, null, null).recommendation
                    own.candidates.forEach { card ->
                        card.routes!!.any { it.participantId == room.hiddenId } shouldBe true
                        card.lastTrains!!.size shouldBe 3
                    }
                    own.candidates.map { it.times[1].seconds }
                }
            ownTimes[0] shouldNotBe ownTimes[1]
            val snapshots = mutableListOf<Map<String, String>>()
            for (room in rooms) {
                val responses = linkedMapOf<String, String>()
                testApplication {
                    application {
                        apiModule(
                            testConfig(mapOf("RATE_LIMIT_ENABLED" to "false")),
                            apiServices(
                                room.fixture.anonService,
                                room.fixture.service,
                                room.results,
                                recommendation,
                                directory,
                            ),
                        )
                    }
                    val path = "/v1/rooms/${room.roomId}"
                    val tabs =
                        listOf("", "?mode=fair", "?mode=fast") +
                            listOf(room.hostId, room.hiddenId, room.thirdId).map { "?mode=favor&favor=$it" }
                    // Fixed clock + SequentialIdGenerator in RoomFixture normalize IDs, tokens and timestamps by construction.
                    for (stage in listOf("result", "decided-ranked", "decided-unranked")) {
                        if (stage != "result") {
                            val version = room.results.result(room.roomId, null, null, null).shareVersion
                            room.fixture.service.decide(
                                room.roomId,
                                room.hostToken,
                                if (stage == "decided-ranked") "31a" else "4xz",
                                version,
                            )
                        }
                        val modes =
                            listOf(RoomPatch(mode = RoomMode.FAIR), RoomPatch(mode = RoomMode.FAST)) +
                                listOf(room.hostId, room.hiddenId, room.thirdId).map { RoomPatch(RoomMode.FAVOR, it) }
                        for ((modeIndex, mode) in modes.withIndex()) {
                            room.fixture.service.updateRoom(room.roomId, room.managementToken, mode)
                            for ((viewer, token) in listOf(
                                null,
                                room.managementToken,
                                room.hostToken,
                                room.thirdToken,
                            ).withIndex()) {
                                for (endpoint in listOf("", "/preview") + tabs.map { "/result$it" }) {
                                    val response = client.json(HttpMethod.Get, path + endpoint, token = token)
                                    response.status.value shouldBe 200
                                    val raw = response.bodyAsText()
                                    val json = Json.parseToJsonElement(raw)
                                    withClue("$stage viewer=$viewer endpoint=$endpoint") {
                                        assertNoHiddenOrigin(json, hiddenOriginNames)
                                        if (endpoint.startsWith("/result")) {
                                            val cards = json.jsonObject.getValue("candidates").jsonArray
                                            cards.isNotEmpty() shouldBe true
                                            cards.forEach {
                                                val card = it.jsonObject
                                                card.getValue("routes").jsonArray.isNotEmpty() shouldBe true
                                                card.getValue("lastTrains").jsonArray.size shouldBe 2
                                                card
                                                    .getValue("times")
                                                    .jsonArray[1]
                                                    .jsonObject
                                                    .getValue("seconds")
                                                    .jsonPrimitive.content
                                                    .toInt() % 300 shouldBe 0
                                            }
                                            // Locations are available, but hidden origins suppress the comparison for every tab.
                                            ("mapMiddle" in json.jsonObject) shouldBe false
                                        }
                                    }
                                    responses["$stage/$modeIndex/$viewer/$endpoint"] = raw
                                }
                            }
                        }
                    }
                }
                snapshots += responses
            }
            // The same wire fixtures are consumed by the web metadata/image-input tests.
            val expectedPreviews =
                Json
                    .parseToJsonElement(
                        java.io
                            .File(
                                System.getProperty("contracts.dir"),
                                "fixtures/hidden-origin-noninterference.json",
                            ).readText(),
                    ).jsonObject
            snapshots.forEach { snapshot ->
                expectedPreviews.forEach { (path, expected) ->
                    withClue(path) { snapshot.getValue(path) shouldBe expected.toString() }
                }
            }
            snapshots[0].keys shouldBe snapshots[1].keys
            snapshots[0].forEach { (path, body) -> withClue(path) { body shouldBe snapshots[1].getValue(path) } }
        }
    })

/** No allowlist of response fields: scan every key and string at every nesting depth. */
private fun assertNoHiddenOrigin(
    value: JsonElement,
    names: StationNames,
) {
    fun check(text: String) {
        for (code in listOf("130", "225")) {
            text shouldNotContain code
            names.nameOf(code)?.let { text shouldNotContain it }
        }
    }
    when (value) {
        is JsonObject -> {
            value.forEach { (key, child) ->
                check(key)
                assertNoHiddenOrigin(child, names)
            }
        }

        is JsonArray -> {
            value.forEach { assertNoHiddenOrigin(it, names) }
        }

        is JsonPrimitive -> {
            if (value.isString) check(value.content)
        }
    }
}

private val hiddenOriginNames =
    StationNames { code ->
        when (code) {
            "130" -> "동쪽비공개역"
            "225" -> "서쪽비공개역"
            else -> codeNames.nameOf(code)
        }
    }
