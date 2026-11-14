package app.banbanyeok.applogic

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class SituationAdvisorTest {
    private fun candidate(
        name: String,
        vararg minutes: Int,
    ) = CandidateTimes(name, minutes.map { it * 60 })

    private val two = Fixtures.people(listOf("민지", "지훈"))

    private fun evaluate(
        candidates: List<CandidateTimes>,
        mode: ReasonMode = ReasonMode.FAIR,
        people: List<PersonRef> = two,
    ) = SituationAdvisor.evaluate(SituationInput(mode, people, candidates))

    @Test
    fun noCandidatesMeansNoCommonCandidate() {
        val notices = evaluate(emptyList())
        assertEquals(listOf(NoticeKind.NO_COMMON_CANDIDATE), notices.map { it.kind })
        assertEquals("모두가 갈 수 있는 역을 찾지 못했어요. 출발역을 바꿔 보세요.", notices.single().text)
    }

    @Test
    fun everyoneStartingAtTheSameStationMeansSameNeighborhood() {
        val people = listOf(PersonRef("a", "민지", "03v"), PersonRef("b", "지훈", "03v"))
        val notices = evaluate(listOf(candidate("신촌", 20, 20), candidate("합정", 25, 25)), people = people)
        assertEquals(listOf(NoticeKind.SAME_NEIGHBORHOOD), notices.map { it.kind })
        assertEquals("이미 같은 동네예요. 신촌역에서 만나세요.", notices.single().text)
    }

    @Test
    fun hiddenOriginsAreNotTreatedAsTheSameStation() {
        val people = listOf(PersonRef("a", "민지", null), PersonRef("b", "지훈", null))
        assertEquals(emptyList(), evaluate(listOf(candidate("신촌", 20, 30)), people = people))
    }

    @Test
    fun veryCloseOriginsAreSameNeighborhood() {
        assertEquals(
            "이미 같은 동네예요. 서울역에서 만나세요.",
            evaluate(listOf(candidate("서울역", 3, 5))).single().text,
        )
        // 5분(300초)까지가 같은 동네. 5분 1초부터는 아니다.
        assertEquals(
            NoticeKind.SAME_NEIGHBORHOOD,
            evaluate(listOf(CandidateTimes("신촌", listOf(100, 300)))).single().kind,
        )
        assertEquals(emptyList(), evaluate(listOf(CandidateTimes("신촌", listOf(100, 301)))))
    }

    @Test
    fun overNinetyMinutesSuggestsFavoringTheLongestPerson() {
        val notice = evaluate(listOf(candidate("신촌", 40, 95))).single()
        assertEquals(NoticeKind.LONG_TRAVEL, notice.kind)
        assertEquals("누군가는 90분 넘게 걸려요. 한쪽 동네에서 만나는 게 나을 수도 있어요.", notice.text)
        assertEquals(1, notice.favorIndex)
        assertEquals("지훈 쪽으로 보기", notice.ctaLabel)
    }

    @Test
    fun exactlyNinetyMinutesIsNotLong() {
        assertEquals(emptyList(), evaluate(listOf(CandidateTimes("신촌", listOf(2400, 5400)))))
        assertEquals(NoticeKind.LONG_TRAVEL, evaluate(listOf(CandidateTimes("신촌", listOf(2400, 5401)))).single().kind)
    }

    @Test
    fun longTravelInFavorModeHasNoSuggestionButton() {
        val notice = evaluate(listOf(candidate("신촌", 40, 95)), mode = ReasonMode.FAVOR).single()
        assertEquals(NoticeKind.LONG_TRAVEL, notice.kind)
        assertEquals(null, notice.favorIndex)
        assertEquals(null, notice.ctaLabel)
    }

    @Test
    fun longTravelWithoutNicknamesUsesParticipantLabel() {
        val people = Fixtures.people(listOf(null, null))
        assertEquals("홍대입구에서 오는 분 쪽으로 보기", evaluate(listOf(candidate("신촌", 40, 95)), people = people).single().ctaLabel)
    }

    @Test
    fun similarCandidatesWithinTwoMinutes() {
        val three =
            evaluate(
                listOf(candidate("신촌", 38, 30), candidate("합정", 39, 30), candidate("을지로3가", 40, 30)),
            ).single()
        assertEquals(NoticeKind.SIMILAR_CANDIDATES, three.kind)
        assertEquals("세 곳 다 비슷해요. 가고 싶은 동네로 고르세요.", three.text)
        assertEquals(
            "두 곳 다 비슷해요. 가고 싶은 동네로 고르세요.",
            evaluate(listOf(candidate("신촌", 38, 30), candidate("합정", 38, 30))).single().text,
        )
        // 3분 차이는 비슷하다고 하지 않는다
        assertEquals(emptyList(), evaluate(listOf(candidate("신촌", 38, 30), candidate("합정", 41, 30))))
        // 단독 후보는 비교 대상이 없다
        assertEquals(emptyList(), evaluate(listOf(candidate("신촌", 38, 30))))
    }

    @Test
    fun fastModeComparesTotalsAndFavorModeSkipsSimilar() {
        assertEquals(
            NoticeKind.SIMILAR_CANDIDATES,
            evaluate(listOf(candidate("신촌", 20, 30), candidate("합정", 10, 42)), mode = ReasonMode.FAST).single().kind,
        )
        assertEquals(
            emptyList(),
            evaluate(listOf(candidate("신촌", 20, 30), candidate("합정", 10, 42)), mode = ReasonMode.FAVOR),
        )
    }

    @Test
    fun longTravelAndSimilarCanBeShownTogether() {
        val kinds = evaluate(listOf(candidate("신촌", 40, 95), candidate("합정", 41, 96))).map { it.kind }
        assertEquals(listOf(NoticeKind.LONG_TRAVEL, NoticeKind.SIMILAR_CANDIDATES), kinds)
    }

    @Test
    fun invalidInputIsRejected() {
        fun code(block: () -> Unit) = assertFailsWith<ReasonInputException>(block = block).code
        assertEquals(
            InputErrorCode.PEOPLE_COUNT,
            code { evaluate(emptyList(), people = Fixtures.people(listOf("민지"))) },
        )
        assertEquals(
            InputErrorCode.RANK_OUT_OF_RANGE,
            code { evaluate(List(4) { candidate("신촌", 10, 20) }) },
        )
        assertEquals(InputErrorCode.COMPARISON_MISMATCH, code { evaluate(listOf(candidate("신촌", 10))) })
        assertEquals(InputErrorCode.EMPTY_STATION_NAME, code { evaluate(listOf(candidate(" ", 10, 20))) })
        assertEquals(InputErrorCode.NEGATIVE_VALUE, code { evaluate(listOf(CandidateTimes("신촌", listOf(-1, 20)))) })
    }

    @Test
    fun stationLabelAddsStationSuffixOnce() {
        assertEquals("합정역", SituationAdvisor.stationLabel("합정"))
        assertEquals("서울역", SituationAdvisor.stationLabel("서울역"))
        assertTrue(SituationAdvisor.stationLabel("을지로3가").endsWith("역"))
    }
}
