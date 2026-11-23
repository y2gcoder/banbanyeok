package app.banbanyeok.server.recommendation

import app.banbanyeok.applogic.DisplayMinutes

/**
 * 출발역을 숨긴 사람의 시간을 **다른 사람에게** 보일 때 뭉뚱그리는 규칙(#142).
 *
 * 숨긴 사람도 시간은 보인다(docs/01-synthesis.md '숨기기'). 다만 정확한 값을 그대로 보이면 그 사람의 출발역이 후보일 때 "0분"으로
 * 드러나고, 공개된 od 행렬과 맞춰 보면 출발역이 한 곳으로 좁혀진다. 그래서 숨긴 사람 본인이 아닌 요청([RecommendRequest.viewerId]가 아님:
 * 다른 참가자, 토큰 없는 요청, 링크 미리보기)에는
 * - 시간: 표시 분([DisplayMinutes.fromSeconds])을 [STEP_MINUTES]분 단위로 올린 값의 초(0분도 5분),
 * - 환승: null(보이지 않는다)
 * 로 내고, 최장·차이·합계·우대 시간·이유 문장·순위 밖 역의 시간도 이 값으로 만든다. **순위는 정확한 값으로 정한다**(공평 순위 불변):
 * 이 클래스는 순위를 다 정한 뒤 표시 값에만 쓴다.
 */
internal class HiddenTimes private constructor(
    /** 요청 참가자 순서. true면 그 칸을 뭉뚱그린다. */
    private val masked: List<Boolean>,
) {
    val any: Boolean get() = masked.any { it }

    fun isMasked(index: Int): Boolean = masked[index]

    /** [index]번째 사람의 보이는 시간(초). */
    fun seconds(
        index: Int,
        seconds: Int,
    ): Int = if (masked[index]) coarse(seconds) else seconds

    /** [index]번째 사람의 보이는 칸. */
    fun time(
        index: Int,
        participantId: String,
        seconds: Int,
        transfers: Int,
    ): ParticipantTime =
        if (masked[index]) {
            ParticipantTime(participantId, coarse(seconds), null)
        } else {
            ParticipantTime(participantId, seconds, transfers)
        }

    companion object {
        const val STEP_MINUTES = 5
        private const val SECONDS_PER_MINUTE = 60

        /** 숨긴 사람이 본인 요청이 아니면 뭉뚱그린다. 무상태 추천은 숨김이 없어 아무것도 바꾸지 않는다. */
        fun of(request: RecommendRequest): HiddenTimes {
            val viewer = request.viewerId
            return HiddenTimes(request.participants.map { it.hidden && it.id != viewer })
        }

        /** 표시 분을 [STEP_MINUTES]분 단위로 올린 값의 초. 0분도 [STEP_MINUTES]분이다. 0 → 300, 281(5분) → 300, 341(6분) → 600. */
        fun coarse(seconds: Int): Int {
            val minutes = DisplayMinutes.fromSeconds(seconds)
            val steps = maxOf(1, (minutes + STEP_MINUTES - 1) / STEP_MINUTES)
            return steps * STEP_MINUTES * SECONDS_PER_MINUTE
        }
    }
}
