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
import io.kotest.matchers.collections.shouldContainAll
import io.kotest.matchers.ints.shouldBeGreaterThanOrEqual
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldNotContain
import io.ktor.client.HttpClient
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * #143, #157: compare the entire wire response, including future person-specific fields, without masking times.
 *
 * The hidden person's origin is 130 in one room and 225 in the other. Both are meeting candidates that other viewers see on
 * their cards (#142's original leak: the hidden person showed 0 minutes at their own origin), and they are within five
 * minutes of each other both ways, so every coarse value is the same. Stations have distinct coordinates, so a
 * location-derived value that leaked would differ between the rooms (see the map-middle positive control).
 *
 * Ranking uses exact times (ADR-0004), so the matrix is chosen so the exact order is also the same in both rooms. The fair
 * baseline is 31a, 지연's origin: 지연's favor cap there is 0, so favoring 민수 or the hidden person leaves only 31a. That
 * keeps the favor-the-hidden-person tab comparable; when the hidden origin can be ranked by that person's own exact time,
 * the order itself differs (accepted by ADR-0004, not covered by this byte comparison).
 *
 * The shared wire fixture `contracts/fixtures/hidden-origin-noninterference.json` (also read by the web test) is written
 * from this test: `mise run fixtures:hidden-origin` (review the diff).
 */
class HiddenOriginNoninterferenceHttpTest :
    DescribeSpec({
        it("changing only a hidden origin cannot change any other viewer's response") {
            val rooms = HIDDEN_ORIGINS.map { RouteRoom(it, recommendation, MEETING_DATE).open() }
            // Guard against a vacuous pair: the hidden person still receives different exact values and all features.
            val ownTimes =
                rooms.map { room ->
                    val own = room.results.result(room.roomId, room.hiddenToken, null, null).recommendation
                    own.candidates.map { it.stationCode } shouldContainAll HIDDEN_ORIGINS
                    own.candidates.forEach { card ->
                        val mine = card.times[1]
                        if (card.stationCode == room.origin) {
                            // Their own origin is a candidate: exactly 0 seconds and no route for them.
                            mine.seconds shouldBe 0
                            mine.transfers shouldBe 0
                            card.routes!!.none { it.participantId == room.hiddenId } shouldBe true
                        } else {
                            card.routes!!.any { it.participantId == room.hiddenId } shouldBe true
                        }
                        card.lastTrains!!.size shouldBe 3
                    }
                    own.candidates.map { it.times[1].seconds }
                }
            ownTimes[0] shouldNotBe ownTimes[1]
            val snapshots = rooms.map { room -> room.otherViewerResponses() }
            val fixture = File(System.getProperty("contracts.dir"), "fixtures/hidden-origin-noninterference.json")
            if (System.getenv("UPDATE_CONTRACT_FIXTURES") == "1") fixture.writeText(previewFixture(snapshots[0]))
            // The same wire fixtures are consumed by the web metadata/image-input tests.
            val expectedPreviews = Json.parseToJsonElement(fixture.readText()).jsonObject
            expectedPreviews.keys shouldBe snapshots[0].keys.filter(::isFixtureKey).toSet()
            snapshots.forEach { snapshot ->
                expectedPreviews.forEach { (path, expected) ->
                    withClue(path) { snapshot.getValue(path) shouldBe expected.toString() }
                }
            }
            snapshots[0].keys shouldBe snapshots[1].keys
            snapshots[0].forEach { (path, body) -> withClue(path) { body shouldBe snapshots[1].getValue(path) } }
        }

        it("positive control: with nobody hidden the same rooms preview a map middle, and it follows the origin") {
            val middles =
                HIDDEN_ORIGINS.map { origin ->
                    val room = RouteRoom(origin, recommendation, MEETING_DATE, hidden = false).open()
                    var middle: String? = null
                    room.withApi {
                        // Only the result-stage preview of a fair room carries mapMiddle (room results never do).
                        val body = getJson("/v1/rooms/${room.roomId}/preview", null)
                        middle =
                            body["mapMiddle"]
                                ?.jsonObject
                                ?.getValue("stationCode")
                                ?.jsonPrimitive
                                ?.content
                    }
                    middle
                }
            // Each origin's own coordinates pull the middle to it: a leaked location-derived value would differ by room.
            middles shouldBe HIDDEN_ORIGINS
        }
    })

private val HIDDEN_ORIGINS = listOf("130", "225")

private val MEETING_DATE = LocalDate.parse("2026-11-27")

/**
 * People: 민수 03v (host), the hidden person (130 or 225), 지연 31a. Candidates 03v, 130, 225, 31a, 4xz (4xz is
 * unreachable for 민수 and 지연, so it is never ranked). The hidden rows differ in exact seconds and transfers but share
 * five-minute buckets (15, 5, 5, 25, 20 minutes): 130↔225 is 4–5 minutes both ways.
 *
 * Exact order in both rooms: fair 31a(25:00) < 130(30:00) < 225(31:40) < 03v; fast 130 < 225 < 31a < 03v (totals
 * 2200–2440, 2500–2770, 2950–3000, 3250–3300); favoring 지연 31a < 225 < 130 < 03v.
 */
private val od =
    smallOd(
        listOf("03v", "130", "225", "31a"),
        listOf("03v", "130", "225", "31a", "4xz"),
        listOf(
            listOf(0, 400, 1900, 1500, null),
            listOf(850, 0, 270, 1450, 1000),
            listOf(900, 240, 0, 1500, 1050),
            listOf(2400, 1800, 600, 0, null),
        ),
        listOf(
            listOf(0, 1, 1, 2, 0),
            listOf(1, 0, 1, 1, 1),
            listOf(2, 0, 0, 3, 2),
            listOf(2, 1, 0, 0, 0),
        ),
    )

/**
 * Distinct coordinates: 03v south, 31a north, 130 just east and 225 just west of the line between them. With 130 (or 225)
 * public, the origins' mean point is nearest to that station, which is 5+ minutes worse than 31a, so it is the map middle.
 */
private val locations =
    mapOf(
        "03v" to GeoPoint(37.50, 127.00),
        "130" to GeoPoint(37.53, 127.01),
        "225" to GeoPoint(37.53, 126.99),
        "31a" to GeoPoint(37.56, 127.00),
        "4xz" to GeoPoint(37.60, 127.05),
    )

private val hiddenOriginNames =
    StationNames { code ->
        when (code) {
            "130" -> "동쪽비공개역"
            "225" -> "서쪽비공개역"
            else -> codeNames.nameOf(code)
        }
    }

private val recommendation =
    RecommendationService(
        OdTravelTimeProvider(od, "20261120.1", TimeSlot.ALL.associateWith { od }),
        hiddenOriginNames,
        locations = { locations[it] },
        routes = { sampleRouteGraph() },
        lastTrains = { LastTrainData(sampleLastTrains, sampleLastTrainAsOf) },
        clock = Clock.fixed(Instant.parse("2026-11-27T03:00:00Z"), ZoneOffset.UTC),
    )

private suspend fun RouteRoom.withApi(block: suspend HttpClient.() -> Unit) {
    val room = this
    testApplication {
        application {
            apiModule(
                testConfig(mapOf("RATE_LIMIT_ENABLED" to "false")),
                apiServices(
                    room.fixture.anonService,
                    room.fixture.service,
                    room.results,
                    recommendation,
                    DevArtifacts.directory,
                ),
            )
        }
        client.block()
    }
}

private suspend fun HttpClient.getJson(
    path: String,
    token: String?,
): JsonObject {
    val response = json(HttpMethod.Get, path, token = token)
    response.status.value shouldBe 200
    return Json.parseToJsonElement(response.bodyAsText()).jsonObject
}

/**
 * Every response someone other than the hidden person can get, keyed `stage/mode/viewer/endpoint`: room, preview and every
 * result tab, for no token, the host's management token, the host's and 지연's participant tokens, across five room modes and
 * three stages (result, decided on the hidden-origin candidate 130, decided outside the ranking on 4xz).
 */
private suspend fun RouteRoom.otherViewerResponses(): Map<String, String> {
    val room = this
    val responses = linkedMapOf<String, String>()
    val cardStations = mutableSetOf<String>()
    withApi {
        val path = "/v1/rooms/${room.roomId}"
        val tabs =
            listOf("", "?mode=fair", "?mode=fast") +
                listOf(room.hostId, room.hiddenId, room.thirdId).map { "?mode=favor&favor=$it" }
        // Fixed clock + SequentialIdGenerator in RoomFixture normalize IDs, tokens and timestamps by construction.
        for (stage in listOf("result", "decided-ranked", "decided-unranked")) {
            if (stage != "result") {
                val version = room.results.result(room.roomId, null, null, null).shareVersion
                val station = if (stage == "decided-ranked") "130" else "4xz"
                room.fixture.service.decide(room.roomId, room.hostToken, station, version)
            }
            val modes =
                listOf(RoomPatch(mode = RoomMode.FAIR), RoomPatch(mode = RoomMode.FAST)) +
                    listOf(room.hostId, room.hiddenId, room.thirdId).map { RoomPatch(RoomMode.FAVOR, it) }
            for ((modeIndex, mode) in modes.withIndex()) {
                room.fixture.service.updateRoom(room.roomId, room.managementToken, mode)
                val viewers = listOf(null, room.managementToken, room.hostToken, room.thirdToken)
                for ((viewer, token) in viewers.withIndex()) {
                    for (endpoint in listOf("", "/preview") + tabs.map { "/result$it" }) {
                        val response = json(HttpMethod.Get, path + endpoint, token = token)
                        response.status.value shouldBe 200
                        val raw = response.bodyAsText()
                        val json = Json.parseToJsonElement(raw).jsonObject
                        withClue("$stage viewer=$viewer endpoint=$endpoint") {
                            assertNoHiddenOrigin(meetingStationsMasked(json))
                            json["station"]?.jsonObject?.let { assertCoarse(it) }
                            if (endpoint.startsWith("/result")) {
                                val cards = json.getValue("candidates").jsonArray.map { it.jsonObject }
                                cards.isNotEmpty() shouldBe true
                                cards.forEach { card ->
                                    cardStations += card.getValue("stationCode").jsonPrimitive.content
                                    card.getValue("routes").jsonArray.isNotEmpty() shouldBe true
                                    card.getValue("lastTrains").jsonArray.size shouldBe 2
                                    assertCoarse(card)
                                }
                            }
                            // Locations are available, but hidden origins suppress the comparison (it would be on the
                            // fair result-stage preview; see the positive control).
                            ("mapMiddle" in json) shouldBe false
                        }
                        responses["$stage/$modeIndex/$viewer/$endpoint"] = raw
                    }
                }
            }
        }
    }
    // Guard against a vacuous scan: both hidden-origin candidates really reached other viewers' cards.
    cardStations shouldContainAll HIDDEN_ORIGINS
    return responses
}

/** The hidden person's cell (index 1) as others see it: whole five-minute steps, never 0 (#142), no transfers. */
private fun assertCoarse(station: JsonObject) {
    val hidden = station.getValue("times").jsonArray[1].jsonObject
    hidden["transfers"]?.jsonPrimitive?.intOrNull shouldBe null
    val seconds = hidden.getValue("seconds").jsonPrimitive.intOrNull ?: return
    seconds % 300 shouldBe 0
    seconds shouldBeGreaterThanOrEqual 300
}

/** Fixture rows: every stage and room mode, as the preview the public link sees (no token). */
private fun isFixtureKey(key: String): Boolean = key.endsWith("/preview") && key.split("/")[2] == "0"

private fun previewFixture(snapshot: Map<String, String>): String =
    snapshot
        .filterKeys(::isFixtureKey)
        .entries
        .joinToString(",\n", "{\n", "\n}\n") { (key, raw) -> "  ${JsonPrimitive(key)}: $raw" }

private const val MASK = "<meeting station>"

/**
 * A copy with only the meeting-station slots blanked: each candidate card's own code and name, the last stop of a route on
 * that card (which is the card's station), the name of another card in a card's reason ("2위 OO역보다"), and the room's
 * decided or previewed station. 130 and 225 are candidates, so they may appear there; anywhere else (rest of the reasons,
 * last trains, labels, other route stops, keys, future fields) is still scanned.
 */
private fun meetingStationsMasked(body: JsonObject): JsonObject {
    fun JsonObject.with(changes: Map<String, JsonElement>) = JsonObject(this + changes)

    fun JsonObject.stationMasked() =
        with(listOf("stationCode", "stationName").filter { it in this }.associateWith { JsonPrimitive(MASK) })

    val cardNames =
        body["candidates"]
            ?.jsonArray
            ?.map {
                it.jsonObject
                    .getValue("stationName")
                    .jsonPrimitive.content
            }.orEmpty()

    fun reasonMasked(card: JsonObject): Map<String, JsonElement> {
        val reason = card["reason"]?.jsonPrimitive?.content ?: return emptyMap()
        return mapOf("reason" to JsonPrimitive(cardNames.fold(reason) { text, name -> text.replace(name, MASK) }))
    }

    fun card(card: JsonObject): JsonObject {
        val code = card.getValue("stationCode").jsonPrimitive.content
        val routes =
            card["routes"]?.jsonArray?.map { route ->
                val legs =
                    route.jsonObject
                        .getValue("legs")
                        .jsonArray
                        .map { it.jsonObject }
                val last = legs.last().getValue("to").jsonObject
                last.getValue("stationCode").jsonPrimitive.content shouldBe code
                val masked = legs.dropLast(1) + legs.last().with(mapOf("to" to last.stationMasked()))
                route.jsonObject.with(mapOf("legs" to JsonArray(masked)))
            }
        return card
            .stationMasked()
            .with(reasonMasked(card))
            .with(routes?.let { mapOf("routes" to JsonArray(it)) }.orEmpty())
    }

    val changes = mutableMapOf<String, JsonElement>()
    body["candidates"]?.let { cards -> changes["candidates"] = JsonArray(cards.jsonArray.map { card(it.jsonObject) }) }
    for (key in listOf("station", "decision")) {
        (body[key] as? JsonObject)?.let { changes[key] = it.stationMasked() }
    }
    return body.with(changes)
}

/** No allowlist of response fields: scan every key and string at every nesting depth. */
private fun assertNoHiddenOrigin(value: JsonElement) {
    fun check(text: String) {
        for (code in HIDDEN_ORIGINS) {
            text shouldNotContain code
            hiddenOriginNames.nameOf(code)?.let { text shouldNotContain it }
        }
    }
    when (value) {
        is JsonObject -> {
            value.forEach { (key, child) ->
                check(key)
                assertNoHiddenOrigin(child)
            }
        }

        is JsonArray -> {
            value.forEach { assertNoHiddenOrigin(it) }
        }

        is JsonPrimitive -> {
            if (value.isString) check(value.content)
        }
    }
}
