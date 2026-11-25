package app.banbanyeok.server.app

import app.banbanyeok.server.recommendation.RecommendationError
import app.banbanyeok.server.recommendation.RecommendationException
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.mockk.coEvery
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * `RecommendationError` → 응답은 경로마다 표가 따로 있다(http/Errors.kt). 같은 오류에도 일부러 다른 코드를 쓰는 곳을 고정한다:
 * 저장된 출발역이 사라진 방은 충돌(`STATION_UNAVAILABLE` 409), 입력이 잘못된 무상태 추천은 `INVALID_STATION` 400이다.
 */
class RecommendationErrorTableTest :
    DescribeSpec({
        class Reply(
            val status: HttpStatusCode,
            val code: String,
            val message: String,
        )

        fun reply(
            status: HttpStatusCode,
            body: String,
        ): Reply {
            val json = Json.parseToJsonElement(body).jsonObject
            return Reply(
                status,
                json.getValue("code").jsonPrimitive.content,
                json.getValue("detail").jsonPrimitive.content,
            )
        }

        val origins = DevArtifacts.origins.take(2)
        val recommendBody = """{"origins":["${origins[0]}","${origins[1]}"],"mode":"fair"}"""

        describe("the stateless /v1/recommend table") {
            val table =
                mapOf(
                    RecommendationError.PEOPLE_COUNT to "INVALID_PEOPLE_COUNT",
                    RecommendationError.INVALID_NICKNAME to "INVALID_NICKNAME",
                    RecommendationError.UNKNOWN_STATION to "INVALID_STATION",
                    RecommendationError.REGION_MISMATCH to "REGION_MISMATCH",
                    RecommendationError.SCHEDULE_UNAVAILABLE to "SCHEDULE_UNAVAILABLE",
                    RecommendationError.FAVOR_TARGET_REQUIRED to "FAVOR_TARGET_REQUIRED",
                    RecommendationError.FAVOR_TARGET_UNKNOWN to "FAVOR_TARGET_UNKNOWN",
                    RecommendationError.FAVOR_TARGET_HIDDEN to "FAVOR_TARGET_HIDDEN",
                )
            it("lists every error") { table.keys shouldBe RecommendationError.entries.toSet() }
            for ((error, code) in table) {
                val status =
                    if (error ==
                        RecommendationError.SCHEDULE_UNAVAILABLE
                    ) {
                        HttpStatusCode.Conflict
                    } else {
                        HttpStatusCode.BadRequest
                    }
                val detail = regionalDetails[error] ?: "추천 메시지"
                it("answers $error with $status $code and the expected detail") {
                    withMockedApi { services ->
                        coEvery { services.recommendation.evaluate(any()) } throws
                            RecommendationException(error, "추천 메시지")
                        val response = client.json(HttpMethod.Post, "/v1/recommend", recommendBody)
                        val got = reply(response.status, response.bodyAsText())
                        got.status shouldBe status
                        got.code shouldBe code
                        got.message shouldBe detail
                    }
                }
            }
        }

        describe("the room result and preview table") {
            // 오류 → (상태, 코드, 고정 메시지)
            val table =
                mapOf(
                    RecommendationError.PEOPLE_COUNT to
                        Triple(HttpStatusCode.Conflict, "NOT_ENOUGH_PARTICIPANTS", "참가자가 2명 이상이어야 합니다"),
                    RecommendationError.INVALID_NICKNAME to
                        Triple(HttpStatusCode.BadRequest, "INVALID_NICKNAME", "별칭이 올바르지 않습니다"),
                    RecommendationError.UNKNOWN_STATION to
                        Triple(HttpStatusCode.Conflict, "STATION_UNAVAILABLE", "참가자의 출발역이 현재 데이터에 없습니다"),
                    RecommendationError.REGION_MISMATCH to
                        Triple(
                            HttpStatusCode.BadRequest,
                            "REGION_MISMATCH",
                            regionalDetails.getValue(RecommendationError.REGION_MISMATCH),
                        ),
                    RecommendationError.SCHEDULE_UNAVAILABLE to
                        Triple(
                            HttpStatusCode.Conflict,
                            "SCHEDULE_UNAVAILABLE",
                            regionalDetails.getValue(RecommendationError.SCHEDULE_UNAVAILABLE),
                        ),
                    RecommendationError.FAVOR_TARGET_REQUIRED to
                        Triple(HttpStatusCode.BadRequest, "FAVOR_TARGET_REQUIRED", "우대 대상이 필요합니다"),
                    RecommendationError.FAVOR_TARGET_UNKNOWN to
                        Triple(HttpStatusCode.BadRequest, "FAVOR_TARGET_UNKNOWN", "우대 대상이 참가자에 없습니다"),
                    RecommendationError.FAVOR_TARGET_HIDDEN to
                        Triple(
                            HttpStatusCode.BadRequest,
                            "FAVOR_TARGET_HIDDEN",
                            "출발역을 숨긴 사람 쪽으로 맞춘 결과는 본인만 볼 수 있습니다",
                        ),
                )
            it("lists every error") { table.keys shouldBe RecommendationError.entries.toSet() }
            for ((error, expected) in table) {
                val (status, code, message) = expected
                it("answers $error with $status $code on the result") {
                    withMockedApi { services ->
                        coEvery { services.results.result(any(), any(), any(), any()) } throws
                            RecommendationException(error, "추천 메시지")
                        val response = client.json(HttpMethod.Get, "/v1/rooms/r1/result")
                        val got = reply(response.status, response.bodyAsText())
                        got.status shouldBe status
                        got.code shouldBe code
                        got.message shouldBe message
                    }
                }
                it("answers $error with $status $code on the preview") {
                    withMockedApi { services ->
                        coEvery { services.results.preview(any()) } throws RecommendationException(error, "추천 메시지")
                        val response = client.json(HttpMethod.Get, "/v1/rooms/r1/preview")
                        val got = reply(response.status, response.bodyAsText())
                        got.status shouldBe status
                        got.code shouldBe code
                        got.message shouldBe message
                    }
                }
            }
        }
    })

private val regionalDetails =
    mapOf(
        RecommendationError.REGION_MISMATCH to "방과 추천은 한 권역 안에서 계산합니다",
        RecommendationError.SCHEDULE_UNAVAILABLE to "요청한 시간표를 확인하지 못했습니다",
    )
