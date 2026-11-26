package app.banbanyeok.server.app

import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.app.application.BackgroundSlots
import app.banbanyeok.server.app.application.StationDirectory
import app.banbanyeok.server.app.http.ApiServices
import app.banbanyeok.server.artifact.ArtifactLoader
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.TravelMatrix
import app.banbanyeok.server.recommendation.TravelTimeProvider
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.time.Duration.Companion.milliseconds

private fun apiWith(
    recommendation: RecommendationService,
    directory: StationDirectory = DevArtifacts.directory,
): ApiServices {
    val mocks = MockedServices()
    return apiServices(mocks.anon, mocks.rooms, mocks.results, recommendation, directory, DevArtifacts.published)
}

private fun String.json(): JsonObject = Json.parseToJsonElement(this).jsonObject

private fun JsonObject.secondsOf(key: String): List<Int> =
    getValue(key).jsonObject.getValue("times").jsonArray.map {
        it.jsonObject
            .getValue("seconds")
            .jsonPrimitive.content
            .toInt()
    }

/**
 * #68 PR 검토에서 재현된 결함의 회귀 테스트.
 * 순위와 지도 한가운데 비교는 **한 번 읽은 같은 행렬**로 계산한다. 구분 행렬 검사가 요청 도중에 끝나도(BackgroundSlots) 응답의
 * timeBasis와 다른 구분으로 비교 시간이 나오면 안 된다.
 */
class MapMiddleConsistencyHttpTest :
    DescribeSpec({
        val directory = DevArtifacts.directory
        val hongdae = directory.originCodes.first { directory.nameOf(it) == "홍대입구" }
        val jamsil = directory.originCodes.first { directory.nameOf(it) == "잠실" }

        it(
            "computes the comparison times from the same matrix as the ranking (response timeBasis) even if slot loading finishes mid-request",
        ) {
            val loaded = ArtifactLoader(DevArtifacts.store).load()
            val complete = loaded.slots.await()
            val loading = CompletableDeferred<Map<TimeSlot, OdMatrix>>()
            val racing = StationDirectory(loaded.dataSet, BackgroundSlots(loading, 1.milliseconds), testTimes)
            val travel = racing.travel
            // 첫 조회가 끝나는 순간 구분 행렬을 공개한다. 두 번째 조회부터는 요청한 구분(토요일 밤)의 행렬이 보인다.
            val controlled =
                object : TravelTimeProvider by travel {
                    override fun measure(
                        origins: List<String>,
                        slot: TimeSlot,
                    ): TravelMatrix = travel.measure(origins, slot).also { loading.complete(complete) }
                }
            val api = apiWith(RecommendationService(controlled, racing, locations = racing), racing)
            testApplication {
                application { apiModule(testConfig(), api) }
                val body = """{"origins":["$hongdae","$jamsil"],"timeSlot":"saturday-night","mode":"fair"}"""
                val response = client.json(HttpMethod.Post, "/v1/recommend", body).bodyAsText().json()
                response
                    .getValue("timeBasis")
                    .jsonObject
                    .getValue("timeSlot")
                    .jsonPrimitive.content shouldBe "weekday-day"
                val middle = response.getValue("mapMiddle").jsonObject
                val matrix = travel.measure(listOf(hongdae, jamsil), TimeSlot.DEFAULT)
                val column = matrix.candidates.indexOf(middle.getValue("stationCode").jsonPrimitive.content)
                response.secondsOf("mapMiddle") shouldBe matrix.times.map { it[column] }
            }
        }

        it("leaves all three ranked cards identical to a calculation without the comparison, in every time slot") {
            val withMiddle = apiWith(RecommendationService(directory.travel, directory, locations = directory))
            val without = apiWith(RecommendationService(directory.travel, directory))
            var compared = 0
            for (slot in TimeSlot.ALL) {
                val body = """{"origins":["$hongdae","$jamsil"],"mode":"fair","timeSlot":"${slot.id}"}"""
                var a: JsonObject? = null
                var b: JsonObject? = null
                testApplication {
                    application { apiModule(testConfig(), withMiddle) }
                    a = client.json(HttpMethod.Post, "/v1/recommend", body).bodyAsText().json()
                }
                testApplication {
                    application { apiModule(testConfig(), without) }
                    b = client.json(HttpMethod.Post, "/v1/recommend", body).bodyAsText().json()
                }
                val shown = requireNotNull(a)
                if (shown.containsKey("mapMiddle")) {
                    compared += 1
                    shown.getValue("candidates").jsonArray.size shouldBe 3
                    shown.getValue("candidates") shouldBe requireNotNull(b).getValue("candidates")
                    shown.getValue("baselineStationCode") shouldBe requireNotNull(b).getValue("baselineStationCode")
                }
            }
            (compared > 0) shouldBe true
        }
    })
