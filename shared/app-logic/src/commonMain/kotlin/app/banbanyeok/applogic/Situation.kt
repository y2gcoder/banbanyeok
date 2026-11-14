package app.banbanyeok.applogic

import kotlin.math.abs

/** 결과 화면에 따로 띄우는 안내(극단 상황)의 종류. 문구 원본은 product-ux 4.3. */
public enum class NoticeKind {
    /** 모두가 갈 수 있는 후보가 없다. */
    NO_COMMON_CANDIDATE,

    /** 이미 같은 역이거나 아주 가깝다. */
    SAME_NEIGHBORHOOD,

    /** 누군가 90분을 넘게 걸린다. */
    LONG_TRAVEL,

    /** 후보들의 차이가 2분 이내라 순위가 큰 의미가 없다. */
    SIMILAR_CANDIDATES,
}

/**
 * 안내 하나.
 *
 * @property text 안내 문장.
 * @property favorIndex 제안 버튼("○○ 쪽으로 보기")이 가리킬 사람의 위치. 버튼이 없으면 null.
 * @property ctaLabel 제안 버튼 문구. [favorIndex]와 함께 있거나 함께 없다.
 */
public data class Notice(
    val kind: NoticeKind,
    val text: String,
    val favorIndex: Int? = null,
    val ctaLabel: String? = null,
)

/**
 * 후보 하나의 사람별 시간. 순위 순서로 넣는다(첫 번째가 1위).
 *
 * @property timesSeconds 사람별 시간(초), 입력 순서는 [SituationInput.people]와 같다.
 */
public data class CandidateTimes(
    val stationName: String,
    val timesSeconds: List<Int>,
)

/** 극단 상황 판단 입력. 후보가 비어 있으면 "공통 후보 없음"이다. 후보는 최대 [ReasonInput.MAX_RANK]개. */
public data class SituationInput(
    val mode: ReasonMode,
    val people: List<PersonRef>,
    val candidates: List<CandidateTimes>,
)

/** 극단 상황 판단과 문구. */
public object SituationAdvisor {
    /** 최장 시간이 이 값(초)을 넘으면 [NoticeKind.LONG_TRAVEL]. 정확히 90분은 해당하지 않는다. */
    public const val LONG_TRAVEL_SECONDS: Int = 90 * 60

    /** 1위의 최장 시간이 이 값(초) 이하면 "같은 동네"로 본다(5분). 제품 판단값이며 조정할 수 있다. */
    public const val NEARBY_SECONDS: Int = 5 * 60

    /** 후보 간 차이가 이 값(분) 이하면 [NoticeKind.SIMILAR_CANDIDATES]. 비교는 표시용 분 값으로 한다. */
    public const val SIMILAR_WITHIN_MINUTES: Int = 2

    /**
     * 해당하는 안내를 우선순위 순으로 돌려준다. 해당 없으면 빈 목록.
     * - 후보 없음이면 그것만. 같은 동네면 그것만(나머지는 의미가 없다).
     * - 둘 다 아니면 LONG_TRAVEL, SIMILAR_CANDIDATES를 해당하는 만큼.
     * - SIMILAR는 공평(최장 시간)·빨리(합계)에서만 판단한다. 배려는 후보를 고르는 기준이 사람마다 달라 판단하지 않는다.
     * 입력이 규칙을 어기면 [ReasonInputException].
     */
    public fun evaluate(input: SituationInput): List<Notice> {
        ReasonInputValidator.validatePeople(input.people)?.let { failInput(it) }
        if (input.candidates.size > ReasonInput.MAX_RANK) failInput(InputErrorCode.RANK_OUT_OF_RANGE)
        for (candidate in input.candidates) {
            if (candidate.stationName.isBlank()) failInput(InputErrorCode.EMPTY_STATION_NAME)
            if (candidate.timesSeconds.size !=
                input.people.size
            ) {
                failInput(InputErrorCode.COMPARISON_MISMATCH)
            }
            if (candidate.timesSeconds.any { it < 0 }) failInput(InputErrorCode.NEGATIVE_VALUE)
        }

        val top =
            input.candidates.firstOrNull()
                ?: return listOf(Notice(NoticeKind.NO_COMMON_CANDIDATE, "모두가 갈 수 있는 역을 찾지 못했어요. 출발역을 바꿔 보세요."))

        val names = ParticipantLabels.of(input.people).map { it.text }
        val topMax = top.timesSeconds.max()
        val codes = input.people.map { it.originCode }
        val allSameOrigin = codes.all { it != null } && codes.toSet().size == 1
        if (allSameOrigin || topMax <= NEARBY_SECONDS) {
            return listOf(Notice(NoticeKind.SAME_NEIGHBORHOOD, "이미 같은 동네예요. ${stationLabel(top.stationName)}에서 만나세요."))
        }

        val notices = ArrayList<Notice>()
        if (topMax > LONG_TRAVEL_SECONDS) {
            val text = "누군가는 90분 넘게 걸려요. 한쪽 동네에서 만나는 게 나을 수도 있어요."
            if (input.mode == ReasonMode.FAVOR) {
                notices += Notice(NoticeKind.LONG_TRAVEL, text)
            } else {
                val longest = top.timesSeconds.indexOf(topMax)
                notices += Notice(NoticeKind.LONG_TRAVEL, text, longest, "${names[longest]} 쪽으로 보기")
            }
        }
        similarNotice(input.mode, input.candidates)?.let { notices += it }
        return notices
    }

    private fun failInput(code: InputErrorCode): Nothing = throw ReasonInputException(code)

    /** 역 이름 뒤에 "역"을 붙인다. 이미 "역"으로 끝나면(서울역) 그대로 둔다. */
    public fun stationLabel(stationName: String): String =
        if (stationName.endsWith("역")) stationName else "${stationName}역"

    private fun similarNotice(
        mode: ReasonMode,
        candidates: List<CandidateTimes>,
    ): Notice? {
        if (candidates.size < 2 || mode == ReasonMode.FAVOR) return null
        val metric =
            candidates.map { candidate ->
                val minutes = candidate.timesSeconds.map { DisplayMinutes.fromSeconds(it) }
                if (mode == ReasonMode.FAIR) minutes.max() else minutes.sum()
            }
        if (metric.any { abs(it - metric.first()) > SIMILAR_WITHIN_MINUTES }) return null
        val count = if (candidates.size == 2) "두" else "세"
        return Notice(NoticeKind.SIMILAR_CANDIDATES, "$count 곳 다 비슷해요. 가고 싶은 동네로 고르세요.")
    }
}
