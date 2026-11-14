package app.banbanyeok.applogic

import app.banbanyeok.applogic.Fixtures.favor
import app.banbanyeok.applogic.Fixtures.reason
import app.banbanyeok.applogic.Fixtures.versus
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * 추천 이유 문구 스냅샷. 문구를 바꾸면 이 테스트가 깨지므로, 바뀐 문장을 눈으로 검토하고 docs/setup/p6-notes.md의
 * 규칙표와 함께 고친다. 시간 단위는 분(분 값은 초로 바꿔 넣으므로 반올림되지 않는다).
 */
class ReasonSnapshotTest {
    private fun check(
        expected: String,
        input: ReasonInput,
    ) = assertEquals(expected, ReasonGenerator.generate(input))

    @Test
    fun fair1SameNamesAreNumbered() =
        check(
            "가장 오래 걸리는 민수 2도 38분이에요.",
            reason(ReasonMode.FAIR, 1, listOf("민수", " 민수 "), listOf(34, 38)),
        )

    // ---- 공평, 1위 ----

    @Test
    fun fair1TwoPeopleNamesLongestAndCompares() =
        check(
            "가장 오래 걸리는 지훈도 38분이에요. 2위 합정보다 가장 오래 걸리는 사람이 4분 덜 걸려요.",
            reason(ReasonMode.FAIR, 1, listOf("민지", "지훈"), listOf(34, 38), versus = versus(2, "합정", listOf(36, 42))),
        )

    @Test
    fun fair1OriginLabelsWhenNoNicknames() =
        check(
            "가장 오래 걸리는 홍대입구에서 오는 분도 38분이에요. 2위 합정보다 가장 오래 걸리는 사람이 4분 덜 걸려요.",
            reason(ReasonMode.FAIR, 1, listOf(null, null), listOf(34, 38), versus = versus(2, "합정", listOf(36, 42))),
        )

    @Test
    fun fair1SameOriginLabelsAreNumbered() =
        check(
            "가장 오래 걸리는 강남에서 오는 분 2도 38분이에요. 2위 합정보다 가장 오래 걸리는 사람이 4분 덜 걸려요.",
            reason(
                ReasonMode.FAIR,
                1,
                listOf(null, null),
                listOf(34, 38),
                originNames = listOf("강남", "강남"),
                versus = versus(2, "합정", listOf(36, 42)),
            ),
        )

    @Test
    fun favor1HiddenParticipantUsesOrdinal() =
        check(
            "참가자 2는 15분, 환승 없이 와요. 강남에서 오는 분은 공평하게보다 9분 더 걸려요 (47분, 상한 +15분).",
            reason(
                ReasonMode.FAVOR,
                1,
                listOf(null, null),
                listOf(47, 15),
                originNames = listOf("강남", null),
                favor = favor(1, listOf(38, 30), listOf(53, null)),
            ),
        )

    @Test
    fun fair1EveryoneSameTimeSaysBoth() =
        check(
            "둘 다 30분이에요. 2위 합정보다 가장 오래 걸리는 사람이 5분 덜 걸려요.",
            reason(ReasonMode.FAIR, 1, listOf("민지", "지훈"), listOf(30, 30), versus = versus(2, "합정", listOf(35, 35))),
        )

    @Test
    fun fair1MaxTieDecidedBySpread() =
        check(
            "가장 오래 걸리는 지훈도 38분이에요. 2위 합정과 최장 시간은 같지만, 시간 차이가 더 작아요 (4분 vs 12분).",
            reason(ReasonMode.FAIR, 1, listOf("민지", "지훈"), listOf(34, 38), versus = versus(2, "합정", listOf(26, 38))),
        )

    @Test
    fun fair1MaxAndSpreadTieDecidedByTotal() =
        check(
            "가장 오래 걸리는 수아도 40분, 3명 모두 20~40분 사이예요. 2위 을지로3가와 최장 시간과 차이가 같고, 합계가 10분 더 짧아요.",
            reason(
                ReasonMode.FAIR,
                1,
                listOf("민지", "지훈", "수아"),
                listOf(20, 25, 40),
                versus = versus(2, "을지로3가", listOf(20, 35, 40)),
            ),
        )

    @Test
    fun fair1NearlyIdenticalRunnerUp() =
        check(
            "가장 오래 걸리는 지훈도 38분이에요. 2위 합정과 거의 같아요.",
            reason(ReasonMode.FAIR, 1, listOf("민지", "지훈"), listOf(34, 38), versus = versus(2, "합정", listOf(34, 38))),
        )

    @Test
    fun fair1ThreePeopleShowsRange() =
        check(
            "가장 오래 걸리는 수아도 45분, 3명 모두 35~45분 사이예요. 2위 합정보다 가장 오래 걸리는 사람이 5분 덜 걸려요.",
            reason(
                ReasonMode.FAIR,
                1,
                listOf("민지", "지훈", "수아"),
                listOf(35, 42, 45),
                versus = versus(2, "합정", listOf(40, 46, 50)),
            ),
        )

    @Test
    fun fair1FourPeopleOverAnHourUsesHours() =
        check(
            "가장 오래 걸리는 사당에서 오는 분도 1시간 5분, 4명 모두 50분~1시간 5분 사이예요.",
            reason(ReasonMode.FAIR, 1, listOf(null, null, null, null), listOf(50, 55, 60, 65)),
        )

    @Test
    fun fair1SeveralPeopleTieForLongest() =
        check(
            "가장 오래 걸리는 지훈·수아도 45분, 3명 모두 30~45분 사이예요.",
            reason(ReasonMode.FAIR, 1, listOf("민지", "지훈", "수아"), listOf(30, 45, 45)),
        )

    @Test
    fun fair1ToleranceIsDisclosed() =
        check(
            "가장 오래 걸리는 지훈도 38분이에요. 2위 합정보다 가장 오래 걸리는 사람이 2분 덜 걸려요. (3분 동점 옵션)",
            reason(
                ReasonMode.FAIR,
                1,
                listOf("민지", "지훈"),
                listOf(34, 38),
                toleranceSeconds = 180,
                versus = versus(2, "합정", listOf(34, 40)),
            ),
        )

    @Test
    fun fair1ToleranceCanPickLongerMaxWithSmallerSpread() =
        check(
            "가장 오래 걸리는 지훈도 44분이에요. 최장 시간은 2위 합정보다 2분 길지만, 시간 차이가 더 작아요 (3분 vs 12분). (3분 동점 옵션)",
            reason(
                ReasonMode.FAIR,
                1,
                listOf("민지", "지훈"),
                listOf(41, 44),
                toleranceSeconds = 180,
                versus = versus(2, "합정", listOf(30, 42)),
            ),
        )

    // ---- 공평, 대안 ----

    @Test
    fun fairAlternativeShowsExtraTimeAndSpreadBenefit() =
        check(
            "공평 모드 대안이에요. 1위 신촌보다 가장 오래 걸리는 사람이 2분 더 걸려요. 대신 시간 차이는 16분 더 작아요.",
            reason(
                ReasonMode.FAIR,
                2,
                listOf("민지", "지훈"),
                listOf(38, 42),
                station = "합정",
                versus = versus(1, "신촌", listOf(20, 40)),
            ),
        )

    @Test
    fun fairAlternativeWithSameMaxMentionsSpread() =
        check(
            "공평 모드 대안이에요. 1위 신촌과 최장 시간은 같아요. 시간 차이는 10분 더 작아요.",
            reason(
                ReasonMode.FAIR,
                3,
                listOf("민지", "지훈"),
                listOf(30, 40),
                station = "합정",
                versus = versus(1, "신촌", listOf(20, 40)),
            ),
        )

    @Test
    fun fairAlternativeWithoutComparison() =
        check(
            "공평 모드 대안이에요.",
            reason(ReasonMode.FAIR, 2, listOf("민지", "지훈"), listOf(38, 42), station = "합정"),
        )

    // ---- 빨리 만나기 ----

    @Test
    fun fast1TwoPeopleNamesTradeOff() =
        check(
            "둘이 합쳐 58분, 후보 중 가장 짧아요. 대신 지훈이 민지보다 14분 더 걸려요.",
            reason(ReasonMode.FAST, 1, listOf("민지", "지훈"), listOf(22, 36)),
        )

    @Test
    fun fast1TwoPeopleSameTimeUsesHours() =
        check(
            "둘이 합쳐 1시간, 후보 중 가장 짧아요. 둘 다 30분이에요.",
            reason(ReasonMode.FAST, 1, listOf("민지", "지훈"), listOf(30, 30)),
        )

    @Test
    fun fast1FourPeopleSaysAllAndLongest() =
        check(
            "4명 모두 합쳐 2시간 40분, 후보 중 가장 짧아요. 가장 오래 걸리는 잠실에서 오는 분은 45분이에요.",
            reason(ReasonMode.FAST, 1, listOf(null, null, null, null), listOf(35, 40, 45, 40)),
        )

    @Test
    fun fast1SameAsFairBaseline() =
        check(
            "둘이 합쳐 58분, 후보 중 가장 짧아요. 가장 빠르면서 공평하기도 한 역이에요.",
            reason(ReasonMode.FAST, 1, listOf("민지", "지훈"), listOf(22, 36), isFairBaseline = true),
        )

    @Test
    fun fast1ToleranceSoftensTheClaim() =
        check(
            "둘이 합쳐 58분, 후보 중 가장 짧은 편이에요. 대신 지훈이 민지보다 14분 더 걸려요. (3분 동점 옵션)",
            reason(ReasonMode.FAST, 1, listOf("민지", "지훈"), listOf(22, 36), toleranceSeconds = 180),
        )

    @Test
    fun fast1LatinNamesPickPostpositionByPronunciation() =
        check(
            "둘이 합쳐 58분, 후보 중 가장 짧아요. 대신 B가 A보다 14분 더 걸려요.",
            reason(ReasonMode.FAST, 1, listOf("A", "B"), listOf(22, 36)),
        )

    @Test
    fun fastAlternativeWithTradeOff() =
        check(
            "빠른 만남 대안이에요. 1위 신촌보다 합쳐서 6분 더 걸려요. 대신 가장 오래 걸리는 사람은 2분 덜 걸려요.",
            reason(
                ReasonMode.FAST,
                2,
                listOf("민지", "지훈"),
                listOf(30, 34),
                station = "합정",
                versus = versus(1, "신촌", listOf(22, 36)),
            ),
        )

    @Test
    fun fastAlternativeWithoutTradeOff() =
        check(
            "빠른 만남 대안이에요. 1위 신촌보다 합쳐서 12분 더 걸려요.",
            reason(
                ReasonMode.FAST,
                3,
                listOf("민지", "지훈"),
                listOf(30, 40),
                station = "합정",
                versus = versus(1, "신촌", listOf(22, 36)),
            ),
        )

    @Test
    fun fastAlternativeWithEqualTotal() =
        check(
            "빠른 만남 대안이에요. 합계는 1위 신촌과 같아요. 가장 오래 걸리는 사람은 2분 덜 걸려요.",
            reason(
                ReasonMode.FAST,
                2,
                listOf("민지", "지훈"),
                listOf(24, 34),
                station = "합정",
                versus = versus(1, "신촌", listOf(22, 36)),
            ),
        )

    // ---- 배려 ----

    @Test
    fun favor1TwoPeopleShowsGiveAndCap() =
        check(
            "민지는 15분, 환승 없이 와요. 지훈은 공평하게보다 9분 더 걸려요 (47분, 상한 +15분).",
            reason(
                ReasonMode.FAVOR,
                1,
                listOf("민지", "지훈"),
                listOf(15, 47),
                favor = favor(0, listOf(30, 38), listOf(null, 53)),
            ),
        )

    @Test
    fun favor1ThreePeopleNamesBiggestGiverAndExcludedCloserStations() =
        check(
            "민지는 15분, 환승 2번으로 와요. 가장 많이 맞춰 주는 수아는 공평하게보다 8분 더 걸려요 (50분, 상한 +15분). " +
                "나머지도 상한 안이에요. 민지 쪽에 더 가까운 역은 다른 사람 상한을 넘어서 뺐어요.",
            reason(
                ReasonMode.FAVOR,
                1,
                listOf("민지", "지훈", "수아"),
                listOf(15, 44, 50),
                transfers = listOf(2, 0, 1),
                favor = favor(0, listOf(30, 40, 42), listOf(null, 55, 57), closerStationsExcluded = true),
            ),
        )

    @Test
    fun favor1NobodyLosesTwoPeople() =
        check(
            "민지는 15분, 환승 없이 와요. 지훈은 공평하게 골랐을 때와 같은 38분이에요.",
            reason(
                ReasonMode.FAVOR,
                1,
                listOf("민지", "지훈"),
                listOf(15, 38),
                favor = favor(0, listOf(30, 38), listOf(null, 53)),
            ),
        )

    @Test
    fun favor1NobodyLosesThreePeople() =
        check(
            "수아는 20분, 환승 없이 와요. 다른 2명은 공평하게보다 더 걸리지 않아요.",
            reason(
                ReasonMode.FAVOR,
                1,
                listOf("민지", "지훈", "수아"),
                listOf(30, 40, 20),
                favor = favor(2, listOf(30, 40, 30), listOf(45, 55, null)),
            ),
        )

    @Test
    fun favor1CapIsOmittedWhenUnknown() =
        check(
            "지훈은 20분, 환승 없이 와요. 민지는 공평하게보다 3분 더 걸려요 (33분).",
            reason(
                ReasonMode.FAVOR,
                1,
                listOf("민지", "지훈"),
                listOf(33, 20),
                favor = favor(1, listOf(30, 25), listOf(null, null)),
            ),
        )

    @Test
    fun favorAlternativeComparesFavoredPersonOnly() =
        check(
            "민지 쪽 대안이에요. 1위 신촌보다 민지는 5분 더 걸려요 (20분).",
            reason(
                ReasonMode.FAVOR,
                2,
                listOf("민지", "지훈"),
                listOf(20, 40),
                station = "합정",
                versus = versus(1, "신촌", listOf(15, 47)),
                favor = favor(0, listOf(30, 38), listOf(null, 53)),
            ),
        )

    @Test
    fun favorAlternativeWithSameFavoredTime() =
        check(
            "민지 쪽 대안이에요. 민지는 1위 신촌과 같은 15분이에요.",
            reason(
                ReasonMode.FAVOR,
                3,
                listOf("민지", "지훈"),
                listOf(15, 50),
                station = "합정",
                versus = versus(1, "신촌", listOf(15, 47)),
                favor = favor(0, listOf(30, 38), listOf(null, 53)),
            ),
        )

    // ---- 표시 규칙 ----

    @Test
    fun everyoneAtZeroMeansSameNeighborhood() =
        check(
            "이미 같은 동네예요.",
            reason(ReasonMode.FAIR, 1, listOf("민지", "지훈"), listOf(0, 0)),
        )

    @Test
    fun derivedNumbersAreComputedFromRoundedPersonMinutes() =
        check(
            // 2249초 = 37분 29초 -> 37분, 2250초 = 37분 30초 -> 38분. 차이는 보이는 값끼리 뺀 1분이다(초로 빼면 1초 -> 0분).
            "가장 오래 걸리는 지훈도 38분이에요. 2위 합정과 최장 시간은 같지만, 시간 차이가 더 작아요 (1분 vs 8분).",
            reason(
                ReasonMode.FAIR,
                1,
                listOf("민지", "지훈"),
                seconds = listOf(2249, 2250),
                versus = versus(2, "합정", seconds = listOf(1800, 2250)),
            ),
        )

    @Test
    fun secondsRoundHalfUpBeforeDisplay() =
        check(
            "둘이 합쳐 1시간 1분, 후보 중 가장 짧아요. 대신 지훈이 민지보다 1분 더 걸려요.",
            // 1829초 -> 30분, 1830초 -> 31분: 합계는 61분
            reason(ReasonMode.FAST, 1, listOf("민지", "지훈"), seconds = listOf(1829, 1830)),
        )
}
