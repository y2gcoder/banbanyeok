package app.banbanyeok.applogic

import app.banbanyeok.applogic.Fixtures.favor
import app.banbanyeok.applogic.Fixtures.reason
import app.banbanyeok.applogic.Fixtures.versus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class ReasonInputValidationTest {
    private val names = listOf("민지", "지훈")
    private fun fair(vararg minutes: Int, label: List<String?> = names) = reason(ReasonMode.FAIR, 1, label, minutes.toList())
    private fun error(input: ReasonInput): InputErrorCode? = ReasonInputValidator.validate(input)

    @Test
    fun validInputPasses() {
        assertNull(error(fair(34, 38)))
        assertNull(error(reason(ReasonMode.FAIR, 1, listOf(null, null, null, null), listOf(10, 20, 30, 40))))
    }

    @Test
    fun peopleCountMustBeTwoToFour() {
        assertEquals(InputErrorCode.PEOPLE_COUNT, ReasonInputValidator.validatePeople(Fixtures.people(listOf("민지"))))
        assertEquals(
            InputErrorCode.PEOPLE_COUNT,
            ReasonInputValidator.validatePeople(List(5) { PersonRef("p$it") }),
        )
        assertNull(ReasonInputValidator.validatePeople(Fixtures.people(listOf(null, null))))
    }

    @Test
    fun samePersonTwiceIsRejectedButSameOriginIsAllowed() {
        val dup = listOf(PersonRef("p0", "민지", "03v"), PersonRef("p0", "지훈", "130"))
        assertEquals(InputErrorCode.DUPLICATE_PERSON, ReasonInputValidator.validatePeople(dup))
        val sameOrigin = listOf(PersonRef("p0", "민지", "03v"), PersonRef("p1", "지훈", "03v"))
        assertNull(ReasonInputValidator.validatePeople(sameOrigin))
        assertEquals(InputErrorCode.BLANK_PERSON_ID, ReasonInputValidator.validatePeople(listOf(PersonRef(" "), PersonRef("p1"))))
    }

    @Test
    fun nicknameLengthIsCountedInCodePoints() {
        val twentyEmoji = "🙂".repeat(20) // UTF-16으로는 40, 코드포인트로는 20
        val twentyOneEmoji = "🙂".repeat(21)
        assertNull(ReasonInputValidator.validatePeople(Fixtures.people(listOf(twentyEmoji, null))))
        assertEquals(InputErrorCode.NICKNAME_TOO_LONG, ReasonInputValidator.validatePeople(Fixtures.people(listOf(twentyOneEmoji, null))))
        assertNull(ReasonInputValidator.validatePeople(Fixtures.people(listOf("a".repeat(20), null))))
        assertEquals(InputErrorCode.NICKNAME_TOO_LONG, ReasonInputValidator.validatePeople(Fixtures.people(listOf("a".repeat(21), null))))
        assertEquals(InputErrorCode.NICKNAME_MALFORMED, ReasonInputValidator.validatePeople(Fixtures.people(listOf("\uD83D", null))))
    }

    @Test
    fun stationCodeFormatIsChecked() {
        val badOrigin = listOf(PersonRef("p0", null, "03V"), PersonRef("p1", null, "130"))
        assertEquals(InputErrorCode.BAD_STATION_CODE, ReasonInputValidator.validatePeople(badOrigin))
        // 숨긴 참가자는 출발역 코드가 없을 수 있다
        assertNull(ReasonInputValidator.validatePeople(listOf(PersonRef("p0", null, null), PersonRef("p1", null, "130"))))
        assertEquals(InputErrorCode.BAD_STATION_CODE, error(fair(34, 38).copy(stationCode = "oo0")))
        assertEquals(InputErrorCode.BAD_STATION_CODE, error(fair(34, 38).copy(stationCode = "ab")))
        assertEquals(
            InputErrorCode.BAD_STATION_CODE,
            error(fair(34, 38).copy(comparison = versus(2, "합정", listOf(1, 2), code = "03V"))),
        )
    }

    @Test
    fun emptyNamesAndNegativeValuesAreRejected() {
        assertEquals(InputErrorCode.EMPTY_STATION_NAME, error(fair(34, 38).copy(stationName = " ")))
        val negative = fair(34, 38).let { it.copy(people = listOf(it.people[0].copy(seconds = -1), it.people[1])) }
        assertEquals(InputErrorCode.NEGATIVE_VALUE, error(negative))
        assertEquals(InputErrorCode.NEGATIVE_VALUE, error(fair(34, 38).copy(toleranceSeconds = -1)))
        val negativeTransfer = fair(34, 38).let { it.copy(people = listOf(it.people[0].copy(transfers = -1), it.people[1])) }
        assertEquals(InputErrorCode.NEGATIVE_VALUE, error(negativeTransfer))
    }

    @Test
    fun rankAndReasonCodeMustAgree() {
        assertEquals(InputErrorCode.RANK_OUT_OF_RANGE, error(fair(34, 38).copy(rank = 0)))
        assertEquals(InputErrorCode.RANK_OUT_OF_RANGE, error(fair(34, 38).copy(rank = 4)))
        assertEquals(InputErrorCode.REASON_CODE_MISMATCH, error(fair(34, 38).copy(reasonCode = ReasonCode.FAIR_ALTERNATIVE)))
        assertEquals(InputErrorCode.REASON_CODE_MISMATCH, error(fair(34, 38).copy(reasonCode = ReasonCode.FAST_TOTAL)))
        assertEquals(InputErrorCode.REASON_CODE_MISMATCH, error(fair(34, 38).copy(rank = 2)))
    }

    @Test
    fun aggregatesMustMatchPersonTimes() {
        assertEquals(InputErrorCode.AGGREGATE_MISMATCH, error(fair(34, 38).copy(maxSeconds = 1)))
        assertEquals(InputErrorCode.AGGREGATE_MISMATCH, error(fair(34, 38).copy(spreadSeconds = 0)))
        assertEquals(InputErrorCode.AGGREGATE_MISMATCH, error(fair(34, 38).copy(totalSeconds = 0)))
    }

    @Test
    fun comparisonMustBeTheRightRankAndSize() {
        assertNull(error(fair(34, 38).copy(comparison = versus(2, "합정", listOf(36, 42)))))
        assertEquals(InputErrorCode.COMPARISON_MISMATCH, error(fair(34, 38).copy(comparison = versus(1, "합정", listOf(36, 42)))))
        assertEquals(InputErrorCode.COMPARISON_MISMATCH, error(fair(34, 38).copy(comparison = versus(2, "합정", listOf(36)))))
        assertEquals(InputErrorCode.COMPARISON_MISMATCH, error(fair(34, 38).copy(comparison = versus(4, "합정", listOf(36, 42)))))
        assertEquals(InputErrorCode.EMPTY_STATION_NAME, error(fair(34, 38).copy(comparison = versus(2, " ", listOf(36, 42)))))
        val alternative = reason(ReasonMode.FAIR, 3, names, listOf(34, 38))
        assertEquals(InputErrorCode.COMPARISON_MISMATCH, error(alternative.copy(comparison = versus(2, "합정", listOf(36, 42)))))
        assertNull(error(alternative.copy(comparison = versus(1, "합정", listOf(36, 42)))))
    }

    @Test
    fun favorContextIsRequiredExactlyForFavorMode() {
        val withoutContext = reason(ReasonMode.FAVOR, 1, names, listOf(15, 47))
        assertEquals(InputErrorCode.FAVOR_CONTEXT_MISSING, error(withoutContext))
        val context = favor(0, listOf(30, 38), listOf(null, 53))
        assertNull(error(withoutContext.copy(favor = context)))
        assertEquals(InputErrorCode.FAVOR_CONTEXT_MISSING, error(fair(34, 38).copy(favor = context)))
        assertEquals(InputErrorCode.FAVOR_CONTEXT_INVALID, error(withoutContext.copy(favor = context.copy(index = 2))))
        assertEquals(InputErrorCode.FAVOR_CONTEXT_INVALID, error(withoutContext.copy(favor = context.copy(index = -1))))
        assertEquals(InputErrorCode.FAVOR_CONTEXT_INVALID, error(withoutContext.copy(favor = context.copy(capSeconds = listOf(null)))))
        assertEquals(
            InputErrorCode.FAVOR_CONTEXT_INVALID,
            error(withoutContext.copy(favor = context.copy(baselineTimesSeconds = listOf(1800, -1)))),
        )
    }

    @Test
    fun generateThrowsWithTheErrorCode() {
        val exception = assertFailsWith<ReasonInputException> { ReasonGenerator.generate(fair(34, 38).copy(totalSeconds = 0)) }
        assertEquals(InputErrorCode.AGGREGATE_MISMATCH, exception.code)
    }

    @Test
    fun everyErrorCodeHasATest() {
        // 새 오류 코드를 추가하면 이 목록과 위 테스트도 같이 늘려야 한다.
        assertEquals(14, InputErrorCode.entries.size)
    }
}
