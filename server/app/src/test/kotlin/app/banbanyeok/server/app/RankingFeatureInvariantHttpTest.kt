package app.banbanyeok.server.app

import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.lasttrain.LastTrainSource
import app.banbanyeok.server.recommendation.mapmiddle.StationLocations
import app.banbanyeok.server.recommendation.route.RouteSource
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/** 기능별 2³ 조합 × 모든 구분 × 세 모드. 부가 정보를 실제로 붙인 HTTP 응답의 순위 입력/출력을 비교한다. */
class RankingFeatureInvariantHttpTest :
    DescribeSpec({
        it("keeps rank, stationCode, times and reason with every feature combination in every slot and mode") {
            val directory = DevArtifacts.directory
            val origins =
                listOf("홍대입구", "잠실").map { name ->
                    directory.originCodes.first { directory.nameOf(it) == name }
                }
            val baseline = mutableMapOf<Pair<String, String>, List<JsonObject>>()
            val seen = mutableSetOf<String>()
            for (features in 0..7) {
                val lastTrains = features and 1 != 0
                val routes = features and 2 != 0
                val middle = features and 4 != 0
                val mocks = MockedServices()
                val service =
                    RecommendationService(
                        directory.travel,
                        directory,
                        locations = if (middle) directory else StationLocations { null },
                        lastTrains = if (lastTrains) DevArtifacts.lastTrains else LastTrainSource { null },
                        routes = if (routes) DevArtifacts.routes else RouteSource { null },
                        clock = Clock.fixed(Instant.parse("2026-11-21T03:00:00Z"), ZoneOffset.UTC),
                    )
                testApplication {
                    application {
                        apiModule(
                            testConfig(mapOf("RATE_LIMIT_ENABLED" to "false")),
                            apiServices(mocks.anon, mocks.rooms, mocks.results, service, directory),
                        )
                    }
                    for (slot in TimeSlot.ALL) {
                        for (mode in listOf("fair", "fast", "favor")) {
                            val request =
                                buildJsonObject {
                                    put("origins", JsonArray(origins.map(::JsonPrimitive)))
                                    put("timeSlot", slot.id)
                                    put("mode", mode)
                                    if (mode == "favor") put("favorIndex", 1)
                                }
                            val response = client.json(HttpMethod.Post, "/v1/recommend", request.toString())
                            response.status shouldBe HttpStatusCode.OK
                            val json = Json.parseToJsonElement(response.bodyAsText()).jsonObject
                            json
                                .getValue("timeBasis")
                                .jsonObject
                                .getValue("timeSlot")
                                .jsonPrimitive.content shouldBe
                                slot.id
                            val cards = json.getValue("candidates").jsonArray.map { it.jsonObject }
                            cards.isNotEmpty() shouldBe true
                            val ranked =
                                cards.map { card ->
                                    JsonObject(
                                        listOf("rank", "stationCode", "times", "reason").associateWith(card::getValue),
                                    )
                                }
                            val key = slot.id to mode
                            if (features == 0) {
                                baseline[key] = ranked
                            } else {
                                withClue("features=$features slot=${slot.id} mode=$mode") {
                                    ranked shouldBe baseline.getValue(key)
                                }
                            }
                            ("lastTrainBasis" in json) shouldBe lastTrains
                            cards.forEach { ("lastTrains" in it) shouldBe lastTrains }
                            cards.forEach { ("routes" in it) shouldBe routes }
                            if (!middle) ("mapMiddle" in json) shouldBe false
                            if ("mapMiddle" in json) seen += "mapMiddle"
                            if (cards.any { it["routes"]?.jsonArray?.isNotEmpty() == true }) seen += "routes"
                            if (cards.any { it["lastTrains"]?.jsonArray?.isNotEmpty() == true }) seen += "lastTrains"
                        }
                    }
                }
            }
            seen shouldBe setOf("lastTrains", "routes", "mapMiddle")
        }
    })
