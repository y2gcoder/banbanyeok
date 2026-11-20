package app.banbanyeok.server.app

import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.app.http.ApiServices
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.RecommendParticipant
import app.banbanyeok.server.recommendation.RecommendRequest
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.TimeBasis
import app.banbanyeok.server.recommendation.TimeSlotLabels
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** 서버 조립(Components)과 같이 역 좌표(레지스트리)를 넣은 실제 추천 서비스. */
private fun realApi(): ApiServices {
    val mocks = MockedServices()
    val directory = DevArtifacts.directory
    return ApiServices(
        mocks.anon,
        mocks.rooms,
        mocks.results,
        RecommendationService(directory.travel, directory, locations = directory),
        directory,
        DevArtifacts.published,
    )
}

private suspend fun HttpResponse.body(): JsonObject = Json.parseToJsonElement(bodyAsText()).jsonObject

private fun codeOf(name: String): String =
    DevArtifacts.directory.originCodes.first {
        DevArtifacts.directory.nameOf(it) ==
            name
    }

class MapMiddleHttpTest :
    DescribeSpec({
        // 홍대입구·잠실: 공평 1위 신당(둘 다 21분), 지도 한가운데는 한강진(홍대입구 23분·잠실 35분)이라 14분 더 걸린다.
        val hongdae = codeOf("홍대입구")
        val jamsil = codeOf("잠실")
        val gangnam = codeOf("강남")

        describe("POST /v1/recommend mapMiddle") {
            it("adds the map middle station and everyone's time when the fair comparison applies") {
                testApplication {
                    application { apiModule(testConfig(), realApi()) }
                    val response =
                        client.json(
                            HttpMethod.Post,
                            "/v1/recommend",
                            """{"origins":["$hongdae","$jamsil"],"mode":"fair"}""",
                        )
                    response.status shouldBe HttpStatusCode.OK
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", response)
                    val json = response.body()
                    val top =
                        json
                            .getValue("candidates")
                            .jsonArray
                            .first()
                            .jsonObject
                    top.getValue("stationName").jsonPrimitive.content shouldBe "신당" // 공평 순위는 그대로다
                    val middle = json.getValue("mapMiddle").jsonObject
                    middle.getValue("stationName").jsonPrimitive.content shouldBe "한강진"
                    val times = middle.getValue("times").jsonArray.map { it.jsonObject }
                    times.map { it.getValue("participantId").jsonPrimitive.content } shouldBe listOf("0", "1")
                    val minutes =
                        times.map {
                            it
                                .getValue("seconds")
                                .jsonPrimitive.content
                                .toInt() / 60
                        }
                    minutes shouldBe listOf(23, 35)
                }
            }

            it("leaves the key out when the middle station is not worse enough, or the mode is not fair") {
                testApplication {
                    application { apiModule(testConfig(), realApi()) }
                    val close =
                        client.json(
                            HttpMethod.Post,
                            "/v1/recommend",
                            """{"origins":["$gangnam","$jamsil"],"mode":"fair"}""",
                        )
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", close)
                    close.body().containsKey("mapMiddle") shouldBe false

                    val fast =
                        client.json(
                            HttpMethod.Post,
                            "/v1/recommend",
                            """{"origins":["$hongdae","$jamsil"],"mode":"fast"}""",
                        )
                    fast.status shouldBe HttpStatusCode.OK
                    OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", fast)
                    fast.body().containsKey("mapMiddle") shouldBe false
                }
            }

            it("takes the times from the od of the requested time slot, like timesTo") {
                val directory = DevArtifacts.directory
                val service = RecommendationService(directory.travel, directory, locations = directory)
                val people = listOf(RecommendParticipant("0", null, hongdae), RecommendParticipant("1", null, jamsil))
                var shown = 0
                testApplication {
                    application { apiModule(testConfig(), realApi()) }
                    for (slot in TimeSlot.ALL) {
                        directory.awaitSlots(slot)
                        val response =
                            client.json(
                                HttpMethod.Post,
                                "/v1/recommend",
                                """{"origins":["$hongdae","$jamsil"],"mode":"fair","timeSlot":"${slot.id}"}""",
                            )
                        OpenApiContract.assertValid(HttpMethod.Post, "/v1/recommend", response)
                        val middle = response.body()["mapMiddle"]?.jsonObject ?: continue
                        shown += 1
                        val code = middle.getValue("stationCode").jsonPrimitive.content
                        val request =
                            RecommendRequest(
                                people,
                                RecommendMode.FAIR,
                                time = TimeBasis(slot, TimeSlotLabels.of(slot)),
                            )
                        val expected = service.timesTo(request, code).orEmpty().map { it?.seconds }
                        middle
                            .getValue(
                                "times",
                            ).jsonArray
                            .map {
                                it.jsonObject
                                    .getValue("seconds")
                                    .jsonPrimitive.content
                                    .toInt()
                            } shouldBe
                            expected
                    }
                }
                (shown > 0) shouldBe true
            }
        }
    })
