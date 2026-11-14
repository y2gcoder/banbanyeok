package app.banbanyeok.applogic

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class DisplayRulesTest {
    @Test
    fun secondsRoundHalfUpToMinutes() {
        assertEquals(0, DisplayMinutes.fromSeconds(0))
        assertEquals(0, DisplayMinutes.fromSeconds(29))
        assertEquals(1, DisplayMinutes.fromSeconds(30))
        assertEquals(1, DisplayMinutes.fromSeconds(89))
        assertEquals(2, DisplayMinutes.fromSeconds(90))
        assertEquals(37, DisplayMinutes.fromSeconds(2249))
        assertEquals(38, DisplayMinutes.fromSeconds(2250))
        assertEquals(60, DisplayMinutes.fromSeconds(3599))
        assertEquals(1092, DisplayMinutes.fromSeconds(65534)) // od.bin 시간의 최댓값
        assertEquals(35791394, DisplayMinutes.fromSeconds(Int.MAX_VALUE)) // 넘치지 않는다
        assertFailsWith<IllegalArgumentException> { DisplayMinutes.fromSeconds(-1) }
    }

    @Test
    fun minutesAreFormattedWithHoursFromSixty() {
        assertEquals("0분", DisplayMinutes.format(0))
        assertEquals("59분", DisplayMinutes.format(59))
        assertEquals("1시간", DisplayMinutes.format(60))
        assertEquals("1시간 4분", DisplayMinutes.format(64))
        assertEquals("2시간 40분", DisplayMinutes.format(160))
        assertEquals("38분", DisplayMinutes.formatSeconds(2250))
        assertFailsWith<IllegalArgumentException> { DisplayMinutes.format(-1) }
    }

    @Test
    fun transferLabels() {
        assertEquals("환승 없음", DisplayMinutes.transferLabel(0))
        assertEquals("환승 1번", DisplayMinutes.transferLabel(1))
        assertFailsWith<IllegalArgumentException> { DisplayMinutes.transferLabel(-1) }
    }

    @Test
    fun postpositionFollowsFinalConsonant() {
        assertEquals("지훈은", Korean.attach("지훈", Josa.EUN_NEUN))
        assertEquals("민지는", Korean.attach("민지", Josa.EUN_NEUN))
        assertEquals("지훈이", Korean.attach("지훈", Josa.I_GA))
        assertEquals("민지가", Korean.attach("민지", Josa.I_GA))
        assertEquals("합정과", Korean.attach("합정", Josa.WA_GWA))
        assertEquals("신촌과", Korean.attach("신촌", Josa.WA_GWA))
        assertEquals("을지로3가와", Korean.attach("을지로3가", Josa.WA_GWA))
    }

    @Test
    fun postpositionForNonHangulNames() {
        assertEquals("A는", Korean.attach("A", Josa.EUN_NEUN)) // 에이
        assertEquals("M은", Korean.attach("M", Josa.EUN_NEUN)) // 엠
        assertEquals("l이", Korean.attach("l", Josa.I_GA)) // 엘
        assertEquals("친구1이", Korean.attach("친구1", Josa.I_GA)) // 일
        assertEquals("친구2가", Korean.attach("친구2", Josa.I_GA)) // 이
        assertEquals("팀7은", Korean.attach("팀7", Josa.EUN_NEUN)) // 칠
    }

    @Test
    fun trailingSymbolsAreSkippedWhenChoosingPostposition() {
        assertEquals("지훈🎂은", Korean.attach("지훈🎂", Josa.EUN_NEUN))
        assertEquals("민지(회사)는", Korean.attach("민지(회사)", Josa.EUN_NEUN))
        assertEquals("🎂는", Korean.attach("🎂", Josa.EUN_NEUN)) // 읽을 글자가 없으면 받침 없음
    }

    @Test
    fun labelsFallBackToOriginThenOrdinal() {
        val people = Fixtures.people(listOf(null, " ", "지훈", null), originNames = listOf("강남", "강남", "합정", null))
        assertEquals(
            listOf("강남에서 오는 분 1", "강남에서 오는 분 2", "지훈", "참가자 4"),
            ParticipantLabels.of(people).map { it.text },
        )
    }

    @Test
    fun postpositionForGeneratedLabels() {
        assertEquals("강남에서 오는 분은", Korean.attach("강남에서 오는 분", Josa.EUN_NEUN))
        assertEquals("강남에서 오는 분 1은", Korean.attach("강남에서 오는 분 1", Josa.EUN_NEUN)) // 일
        assertEquals("참가자 2는", Korean.attach("참가자 2", Josa.EUN_NEUN)) // 이
        assertEquals("참가자 3이", Korean.attach("참가자 3", Josa.I_GA)) // 삼
    }
}
