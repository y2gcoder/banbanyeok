package app.banbanyeok.applogic

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * 출발역을 숨긴 다른 사람의 칸이 뭉뚱그린 값일 때(#142, `ReasonInput.approximate`). 순위는 정확한 값으로 정했으므로 보이는 숫자끼리는
 * 순위와 어긋날 수 있다: 그때 순위와 반대로 읽히는 말("가장 짧아요", "덜 걸려요") 대신 "거의 같아요"라고 쓴다. 정확한 값(approximate=false)의
 * 문장은 그대로다.
 */
class ApproximateReasonTest {
    private val names = listOf("민수", "서준", "지연")

    private fun ReasonInput.hiddenLast(): ReasonInput =
        copy(
            people =
                people.mapIndexed { i, p ->
                    if (i ==
                        people.lastIndex
                    ) {
                        p.copy(transfers = null)
                    } else {
                        p
                    }
                },
            approximate = true,
        )

    @Test
    fun fairWinnerSaysAlmostSameWhenShownMaxIsLongerThanSecond() {
        // 정확한 값으로는 1위 최장(22분) ≤ 2위 최장(23분)이지만, 2위의 숨긴 칸이 뭉뚱그려져 보이는 2위 최장이 20분이 된 경우.
        val input =
            Fixtures
                .reason(
                    ReasonMode.FAIR,
                    1,
                    names,
                    minutes = listOf(21, 22, 5),
                    versus = Fixtures.versus(2, "동대문역사문화공원", listOf(19, 20, 10)),
                ).hiddenLast()
        assertEquals(
            "가장 오래 걸리는 서준도 22분, 3명 모두 5~22분 사이예요. 2위 동대문역사문화공원과 거의 같아요.",
            ReasonGenerator.generate(input),
        )
    }

    @Test
    fun fairAlternativeSaysMaxAlmostSameInsteadOfShorter() {
        val versus = Fixtures.versus(1, "신당", listOf(21, 22, 5))
        val exact = Fixtures.reason(ReasonMode.FAIR, 2, names, minutes = listOf(19, 20, 10), versus = versus)
        assertEquals("공평 모드 대안이에요. 1위 신당보다 가장 오래 걸리는 사람이 2분 덜 걸려요.", ReasonGenerator.generate(exact))
        assertEquals("공평 모드 대안이에요. 1위 신당과 최장 시간은 거의 같아요.", ReasonGenerator.generate(exact.hiddenLast()))
    }

    @Test
    fun fastWinnerDoesNotClaimShortest() {
        val input = Fixtures.reason(ReasonMode.FAST, 1, names, minutes = listOf(21, 22, 5)).hiddenLast()
        assertEquals(
            "3명 모두 합쳐 48분, 후보 중 가장 짧은 편이에요. 가장 오래 걸리는 서준은 22분이에요.",
            ReasonGenerator.generate(input),
        )
    }

    @Test
    fun fastAlternativeSaysTotalAlmostSameInsteadOfShorter() {
        val versus = Fixtures.versus(1, "동대문역사문화공원", listOf(19, 24, 5))
        val exact = Fixtures.reason(ReasonMode.FAST, 2, names, minutes = listOf(21, 22, 2), versus = versus)
        assertEquals("빠른 만남 대안이에요. 1위 동대문역사문화공원보다 합쳐서 3분 덜 걸려요.", ReasonGenerator.generate(exact))
        assertEquals(
            "빠른 만남 대안이에요. 합계는 1위 동대문역사문화공원과 거의 같아요.",
            ReasonGenerator.generate(exact.hiddenLast()),
        )
    }

    @Test
    fun favorWinnerOmitsTransfersOfHiddenFavored() {
        val input =
            Fixtures
                .reason(
                    ReasonMode.FAVOR,
                    1,
                    names,
                    minutes = listOf(21, 22, 5),
                    favor = Fixtures.favor(2, listOf(21, 22, 5), listOf(31, 33, null)),
                ).hiddenLast()
        assertNull(input.people[2].transfers)
        assertEquals(
            "지연은 5분 걸려요. 다른 2명은 공평하게보다 더 걸리지 않아요.",
            ReasonGenerator.generate(input),
        )
    }

    @Test
    fun favorAlternativeSaysAlmostSameInsteadOfShorter() {
        val input =
            Fixtures
                .reason(
                    ReasonMode.FAVOR,
                    2,
                    names,
                    minutes = listOf(25, 26, 5),
                    versus = Fixtures.versus(1, "신당", listOf(21, 22, 10)),
                    favor = Fixtures.favor(2, listOf(21, 22, 10), listOf(31, 33, null)),
                ).hiddenLast()
        assertEquals("지연 쪽 대안이에요. 지연은 1위 신당과 거의 같은 5분이에요.", ReasonGenerator.generate(input))
    }

    @Test
    fun nullTransfersAreValid() {
        val input = Fixtures.reason(ReasonMode.FAIR, 1, names, minutes = listOf(21, 22, 5)).hiddenLast()
        assertNull(ReasonInputValidator.validate(input))
    }
}
