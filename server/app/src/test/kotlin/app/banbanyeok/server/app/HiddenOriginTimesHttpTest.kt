package app.banbanyeok.server.app

import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.NewHiddenOrigins
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomFixture
import app.banbanyeok.server.room.RoomMode
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.ints.shouldBeGreaterThanOrEqual
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldContain
import io.ktor.client.HttpClient
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * #142: 출발역을 숨긴 사람의 출발역이 만날 역 후보(1·2·3위)일 때, 다른 사람이 받는 응답 어디에도 그 사람의 0분·정확한 초·환승이
 * 없어야 한다. 방 구성은 재현 때 쓴 것이다(실제 dev 산출물, 평일 낮).
 *
 * - 다른 사람(토큰 없음·다른 참가자 토큰)의 결과: 숨긴 칸은 5분 단위로 올린 값(0분도 5분)이고 환승은 null, 최장·차이·합계·우대 시간은
 *   보이는 칸에서 다시 계산한 값(합계에서 정확한 초가 거꾸로 나오지 않는다), 이유 문장에 "0~"·"0분"이 없다.
 * - 링크 미리보기(결과·정한 역 단계)도 같은 뭉뚱그린 값이다(그림의 "바로 여기"는 0초일 때만 나온다).
 * - 숨긴 본인은 정확한 값이다. 순위(역 순서)는 누가 보든 같다(공평 순위 불변).
 * - 숨긴 사람 쪽으로 맞춘 배려 탭은 본인만 받는다(다른 사람은 400 `FAVOR_TARGET_HIDDEN`, #162).
 */
class HiddenOriginTimesHttpTest :
    DescribeSpec({
        val directory = DevArtifacts.directory
        val recommendation = RecommendationService(directory.travel, directory, locations = directory)

        class Person(
            val name: String?,
            val code: String,
            val hidden: Boolean = false,
        )

        class Scenario(
            val name: String,
            val people: List<Person>,
            /** 숨긴 사람의 출발역이 이 기준의 몇 위인가(구성이 재현 때와 같은지 확인한다). */
            val ownRank: Pair<String, Int>,
        )

        // 홍대입구 ryf, 잠실 dxy, 신당 7gf, 동대문역사문화공원 s1q, 왕십리 ct5, 합정 ep4, 시청 gf9
        val scenarios =
            listOf(
                Scenario(
                    "공평 1위",
                    listOf(Person("민수", "ryf"), Person("서준", "dxy"), Person("지연", "7gf", true)),
                    "fair" to 1,
                ),
                Scenario(
                    "공평 2위",
                    listOf(Person("민수", "ryf"), Person("서준", "dxy"), Person("지연", "s1q", true)),
                    "fair" to 2,
                ),
                Scenario(
                    "공평 3위",
                    listOf(Person("민수", "ryf"), Person("서준", "dxy"), Person("지연", "ct5", true)),
                    "fair" to 3,
                ),
                Scenario("두 명, 빨리 2위", listOf(Person("민수", "ep4"), Person("지연", "gf9", true)), "fast" to 2),
                Scenario(
                    "이름 없음",
                    listOf(Person(null, "ep4"), Person(null, "ct5"), Person(null, "gf9", true)),
                    "fair" to 1,
                ),
            )

        for (scenario in scenarios) {
            it("${scenario.name}: 다른 사람의 응답에는 숨긴 사람의 0분·정확한 초·환승이 없고, 본인은 정확하다") {
                val fixture = RoomFixture(stations = directory, newHidden = NewHiddenOrigins.LEGACY_FIXTURE)
                val results = RoomResultService(fixture.service, recommendation, testTimes)
                val api =
                    apiServices(
                        fixture.anonService,
                        fixture.service,
                        results,
                        recommendation,
                        directory,
                        DevArtifacts.published,
                    )
                testApplication {
                    application { apiModule(noRateLimit, api) }
                    val people = scenario.people
                    val created =
                        fixture.service.create(
                            CreateRoomCommand(
                                RoomMode.FAIR,
                                null,
                                null,
                                ParticipantInput(people[0].name, people[0].code, people[0].hidden),
                                null,
                                null,
                            ),
                        )
                    val tokens =
                        listOf(created.participantToken) +
                            people.drop(1).map {
                                fixture.service
                                    .join(
                                        created.roomId,
                                        ParticipantInput(it.name, it.code, it.hidden),
                                        null,
                                    ).participantToken
                            }
                    val hiddenIndex = people.indexOfFirst { it.hidden }
                    val hiddenCode = people[hiddenIndex].code
                    val room = "/v1/rooms/${created.roomId}"
                    for (query in listOf("?mode=fair", "?mode=fast")) {
                        val self = client.result("$room/result$query", tokens[hiddenIndex])
                        val selfCards = self["candidates"]!!.jsonArray.map { it.jsonObject }
                        val others =
                            listOf(client.result("$room/result$query", null)) +
                                tokens
                                    .filterIndexed {
                                        i,
                                        _,
                                        ->
                                        i != hiddenIndex
                                    }.map { client.result("$room/result$query", it) }
                        for (other in others) {
                            val cards = other["candidates"]!!.jsonArray.map { it.jsonObject }
                            // 공평 순위 불변: 역 순서는 본인과 같다.
                            cards.map { it.string("stationCode") } shouldBe selfCards.map { it.string("stationCode") }
                            for ((card, selfCard) in cards.zip(selfCards)) {
                                val clue = "${scenario.name} $query ${card.string("stationName")}"
                                withClue(clue) {
                                    val times = card["times"]!!.jsonArray.map { it.jsonObject }
                                    val selfTimes = selfCard["times"]!!.jsonArray.map { it.jsonObject }
                                    val hidden = times[hiddenIndex]
                                    val exact = selfTimes[hiddenIndex].int("seconds")
                                    val shown = hidden.int("seconds")
                                    hidden["transfers"] shouldBe JsonNull
                                    shown % 300 shouldBe 0
                                    shown shouldBeGreaterThanOrEqual 300
                                    shown shouldBe coarse(exact)
                                    // 집계는 보이는 칸에서 다시 계산: 합계에서 공개된 사람을 빼면 뭉뚱그린 값이 나온다(정확한 초가 아니라).
                                    val seconds = times.map { it.int("seconds") }
                                    card.int("maxSeconds") shouldBe seconds.max()
                                    card.int("spreadSeconds") shouldBe seconds.max() - seconds.min()
                                    card.int("totalSeconds") shouldBe seconds.sum()
                                    ZERO_MINUTES.containsMatchIn(card.string("reason")) shouldBe false
                                    // 공개한 사람의 칸은 그대로다.
                                    times.indices.filter { it != hiddenIndex }.forEach {
                                        times[it] shouldBe
                                            selfTimes[it]
                                    }
                                    // 숨긴 사람의 경로·막차는 본인에게만 있다.
                                    card["routes"]?.jsonArray?.forEach { route ->
                                        route.jsonObject.string("participantId") shouldNotBe
                                            self.participantIdOf(hiddenIndex)
                                    }
                                }
                            }
                        }
                        // 본인 응답은 정확한 값: 자기 출발역이 후보이면 그 칸은 0초·환승 0이다.
                        selfCards.firstOrNull { it.string("stationCode") == hiddenCode }?.let { own ->
                            val mine = own["times"]!!.jsonArray[hiddenIndex].jsonObject
                            mine.int("seconds") shouldBe 0
                            mine.int("transfers") shouldBe 0
                        }
                    }
                    // 재현 구성 확인: 숨긴 출발역이 다른 사람 화면의 후보(정한 순위)에 그대로 있다.
                    val (mode, rank) = scenario.ownRank
                    val ranked = client.result("$room/result?mode=$mode", null)
                    ranked["candidates"]!!.jsonArray[rank - 1].jsonObject.string("stationCode") shouldBe hiddenCode

                    // 배려 탭(다른 사람 쪽)도 같다. 숨긴 사람 쪽 탭은 본인만 받는다(#162).
                    val ids = people.indices.map { ranked.participantIdOf(it) }
                    for ((favorIndex, id) in ids.withIndex()) {
                        val query = "?mode=favor&favor=$id"
                        if (favorIndex == hiddenIndex) {
                            for (token in listOf(null) + tokens.filterIndexed { i, _ -> i != hiddenIndex }) {
                                val response = client.json(HttpMethod.Get, "$room/result$query", token = token)
                                response.status.value shouldBe 400
                                response.bodyAsText() shouldContain "FAVOR_TARGET_HIDDEN"
                            }
                            client.result("$room/result$query", tokens[hiddenIndex])
                            continue
                        }
                        val other = client.result("$room/result$query", null)
                        val self = client.result("$room/result$query", tokens[hiddenIndex])
                        // 숨긴 본인도 다른 사람 쪽 탭에서는 같은 상한 규칙이라 같은 후보를 본다.
                        self.stationCodes() shouldBe other.stationCodes()
                        for (card in other["candidates"]!!.jsonArray.map { it.jsonObject }) {
                            val times = card["times"]!!.jsonArray.map { it.jsonObject }
                            val hidden = times[hiddenIndex]
                            withClue("${scenario.name} $query ${card.string("stationName")}") {
                                hidden["transfers"] shouldBe JsonNull
                                hidden.int("seconds") % 300 shouldBe 0
                                hidden.int("seconds") shouldBeGreaterThanOrEqual 300
                                card["favoredSeconds"]?.jsonPrimitive?.int?.let { favored ->
                                    favored shouldBe times[favorIndex].int("seconds")
                                }
                                // 숨긴 사람에게 상한이 없어 공개한 사람의 출발역이 후보일 수 있다. 그 사람의 "0분"은 공개된 값이다.
                                val publicZero =
                                    times.indices.any {
                                        it != hiddenIndex && times[it].int(
                                            "seconds",
                                        ) < 30
                                    }
                                if (!publicZero) ZERO_MINUTES.containsMatchIn(card.string("reason")) shouldBe false
                            }
                        }
                    }

                    // 링크 미리보기(누가 묻든 같은 값). 1위가 숨긴 출발역이면 예전에는 0초였다.
                    val preview = client.preview("$room/preview")
                    preview.hiddenSeconds(hiddenIndex) % 300 shouldBe 0
                    preview.hiddenSeconds(hiddenIndex) shouldBeGreaterThanOrEqual 300

                    // 다른 사람이 숨긴 사람의 출발역으로 정해도, 정한 역 미리보기에 0초가 나가지 않는다.
                    val view = results.result(created.roomId, null, null, null)
                    val decider = tokens.indices.first { it != hiddenIndex }
                    fixture.service.decide(created.roomId, tokens[decider], hiddenCode, view.shareVersion)
                    val decided = client.preview("$room/preview")
                    decided.string("stage") shouldBe "decided"
                    decided["station"]!!.jsonObject.string("stationCode") shouldBe hiddenCode
                    decided.hiddenSeconds(hiddenIndex) shouldBe 300
                }
            }
        }

        it("뭉뚱그림 규칙: 표시 분을 5분 단위로 올리고 0분도 5분이다") {
            listOf(0 to 300, 29 to 300, 281 to 300, 329 to 300, 330 to 600, 341 to 600, 1271 to 1500, 3000 to 3000)
                .forEach { (exact, shown) -> withClue(exact) { coarse(exact) shouldBe shown } }
        }
    })

/** 문장 속 "0분"·"0~22분"(10분·20분은 아니다). */
private val ZERO_MINUTES = Regex("(^|[^0-9])0(분|~)")

/** openapi `PersonalTime`의 뭉뚱그림(#142)을 테스트 쪽에서 따로 쓴 것: 표시 분((초 + 30) / 60)을 5분 단위로 올리고 최소 5분. */
private fun coarse(seconds: Int): Int = maxOf(1, ((seconds + 30) / 60 + 4) / 5) * 300

private suspend fun HttpClient.result(
    path: String,
    token: String?,
): JsonObject {
    val response = json(HttpMethod.Get, path, token = token)
    response.status.value shouldBe 200
    return Json.parseToJsonElement(response.bodyAsText()).jsonObject
}

private suspend fun HttpClient.preview(path: String): JsonObject = result(path, null)

private fun JsonObject.stationCodes(): List<String> =
    getValue("candidates").jsonArray.map { it.jsonObject.string("stationCode") }

private fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.content

private fun JsonObject.int(key: String): Int = getValue(key).jsonPrimitive.int

private fun JsonObject.participantIdOf(index: Int): String =
    getValue("participants").jsonArray[index].jsonObject.string("participantId")

private fun JsonObject.hiddenSeconds(index: Int): Int =
    getValue("station")
        .jsonObject
        .getValue("times")
        .jsonArray[index]
        .jsonObject
        .int("seconds")

private val noRateLimit = testConfig(mapOf("RATE_LIMIT_ENABLED" to "false"))
