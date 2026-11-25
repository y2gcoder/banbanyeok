package app.banbanyeok.server.recommendation

import app.banbanyeok.server.recommendation.lasttrain.LastTrainAttacher
import app.banbanyeok.server.recommendation.lasttrain.ParticipantLastTrain
import app.banbanyeok.server.recommendation.mapmiddle.MapMiddlePicker

/**
 * 한 요청을 **한 번 잰 행렬**과 **한 번 읽은 막차 표**로 평가한 결과([RecommendationService.evaluate]). 여기서 꺼내는 값은 모두 같은
 * 데이터 버전·같은 구분([Recommendation.timeBasis])·같은 막차 기준([Recommendation.lastTrainBasis])이다.
 */
public class Evaluation internal constructor(
    private val request: RecommendRequest,
    private val matrix: TravelMatrix,
    private val lastTrains: LastTrainAttacher.Attached?,
    /** 순위와 상위 3개의 이유·시간·막차. */
    public val recommendation: Recommendation,
    private val middlePicker: MapMiddlePicker,
    private val nameOf: (String) -> String,
) {
    /**
     * "지도 한가운데" 비교(#68). 보일 조건을 채울 때만 있고, 순위는 건드리지 않는다. 쓰는 곳(무상태 추천과 방 링크 미리보기)에서만 계산한다.
     * - 공평 기준이고 1위 추천 역이 있다.
     * - **출발역을 숨긴 사람이 없다**: 숨긴 사람의 출발역은 평균점과 지도 한가운데 역에서 거꾸로 짐작할 수 있다.
     * - 나머지(좌표, 모두가 갈 수 있는 역, 1위와 다름, 충분히 더 오래 걸림)는 [MapMiddlePicker.pick].
     */
    public val mapMiddle: MapMiddle? by lazy { middle() }

    /** Lines excluded from this slot; omitted from the wire for rooms with legacy hidden origins. */
    public val missingServices: List<String>?
        get() =
            matrix.missingServices.takeIf {
                it.isNotEmpty() &&
                    request.participants.none { person ->
                        person.hidden
                    }
            }

    /**
     * [stationCode]까지 사람별 시간(요청 참가자 순서). 순위와 상관없는 역(다른 기준 탭이나 방에서 정한 역)에도 쓴다.
     * 후보 축에 없는 역이면 null이고, 갈 수 없는 사람은 그 칸이 null이다. 순위 카드와 같이 보이는 값이다: 출발역을 숨긴 다른 사람의
     * 칸은 뭉뚱그린 값이다([HiddenTimes], #142).
     */
    public fun timesTo(stationCode: String): List<ParticipantTime?>? {
        val column = matrix.candidates.indexOf(stationCode).takeIf { it >= 0 } ?: return null
        val hidden = HiddenTimes.of(request)
        return request.participants.mapIndexed { row, person ->
            matrix.times[row][column]?.let { seconds ->
                hidden.time(row, person.id, seconds, requireNotNull(matrix.transfers[row][column]))
            }
        }
    }

    /**
     * [stationCode]에서 돌아가는 사람별 막차. 순위와 상관없는 역(방에서 정한 역)에도 쓴다. 기준은 [Recommendation.lastTrainBasis]이고,
     * 그것이 null(막차 표를 쓸 수 없거나 요청한 구분의 행렬이 없다)이면 이것도 null이다. 숨긴 사람은 [RecommendRequest.viewerId]일 때만 있다.
     */
    public fun lastTrainsAt(stationCode: String): List<ParticipantLastTrain>? = lastTrains?.at(stationCode)

    private fun middle(): MapMiddle? {
        val top = recommendation.candidates.firstOrNull() ?: return null
        val fair = request.mode == RecommendMode.FAIR && recommendation.mode == RecommendMode.FAIR
        if (!fair || request.participants.any { it.hidden }) return null
        val people = request.participants
        val column =
            middlePicker.pick(
                people.map { it.originCode },
                matrix.candidates,
                matrix.times,
                top.stationCode,
                top.maxSeconds,
            ) ?: return null
        val code = matrix.candidates[column]
        val times =
            people.mapIndexed { row, person ->
                ParticipantTime(
                    person.id,
                    requireNotNull(matrix.times[row][column]),
                    requireNotNull(matrix.transfers[row][column]),
                )
            }
        return MapMiddle(code, nameOf(code), times)
    }
}
