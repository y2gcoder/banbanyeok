package app.banbanyeok.server.app.application

import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.recommendation.MapMiddle
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.RecommendParticipant
import app.banbanyeok.server.recommendation.RecommendRequest
import app.banbanyeok.server.recommendation.Recommendation
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.time.DayCertainty
import app.banbanyeok.server.recommendation.time.TimeBasis

/** 폐기된 역 코드를 정식(active) 코드로 바꾼다. [StationDirectory]가 구현한다. */
fun interface CanonicalStations {
    fun canonical(code: String): String
}

/**
 * 무상태 추천(`POST /v1/recommend`)의 입력. 방 없이 출발역 목록과 모드만으로 계산한다. HTTP 문자열은 이미 값으로 바뀌어 있다.
 * 참가자는 입력 순서의 인덱스 문자열("0", "1", …)로 구분한다.
 */
class StatelessRequest(
    origins: List<String>,
    nicknames: List<String?>,
    val mode: RecommendMode,
    /** [RecommendMode.FAVOR]일 때 우대할 사람의 입력 순서. */
    val favorIndex: Int?,
    /** 요청이 고른 구분. null이면 고르지 않았다(옛 클라이언트, 요일을 고른 적 없는 `v=1` 링크). */
    val slot: TimeSlot?,
) {
    /** 출발역 코드(옛 공유 링크의 폐기된 코드일 수 있다). 요청을 만들 때 복사한다: 호출자가 나중에 목록을 바꿔도 평가와 응답 매핑은 같은 사본을 쓴다. */
    val origins: List<String> = origins.toList()

    /** [origins]와 같은 길이의 별칭(요청을 만들 때 복사한다). 없는 사람은 null. */
    val nicknames: List<String?> = nicknames.toList()

    init {
        require(this.nicknames.size == this.origins.size) { "nicknames는 origins와 같은 길이여야 합니다" }
    }
}

class StatelessResult(
    val recommendation: Recommendation,
    /** "지도 한가운데" 비교(#68). 조건을 모두 만족할 때만 있다. */
    val mapMiddle: MapMiddle?,
    /** 정식 코드로 바꾼 출발역. 응답에는 이 코드를 싣는다. */
    val origins: List<String>,
    val nicknames: List<String?>,
    val missingServices: List<String>? = null,
)

/**
 * 무상태 추천의 규칙: 출발역 정식 코드화, 입력 순서 인덱스 참가자, 구분 결정과 [DayCertainty]. 라우트는 요청을 값으로 바꿔 이것을 부르고
 * 결과를 응답으로 옮기기만 한다. 잘못된 요청은 [app.banbanyeok.server.recommendation.RecommendationException]이고, 그것을 어떤 응답으로
 * 바꿀지는 HTTP 계층이 정한다.
 */
class StatelessRecommendation(
    private val recommendation: RecommendationService,
    private val stations: CanonicalStations,
) {
    suspend fun recommend(request: StatelessRequest): StatelessResult {
        // 폐기된 코드(옛 공유 링크)는 정식 코드로 바꿔 계산하고 응답에도 정식 코드를 싣는다.
        val origins = request.origins.map(stations::canonical)
        val people =
            origins.mapIndexed {
                index,
                code,
                ->
                RecommendParticipant(index.toString(), request.nicknames[index], code)
            }
        // 구분을 보내지 않은 요청은 평일 낮으로 계산하되 막차 시각은 내지 않는다: 평일은 고른 값이 아니라 기본값이고, 휴일 막차는 평일보다 이르다.
        val chosen = request.slot
        val evaluation =
            recommendation.evaluate(
                RecommendRequest(
                    people,
                    request.mode,
                    request.favorIndex?.toString(),
                    TimeBasis.of(chosen ?: TimeSlot.DEFAULT),
                    dayCertainty = if (chosen != null) DayCertainty.KNOWN else DayCertainty.DEFAULTED,
                ),
            )
        // 구분 행렬 대기·측정·막차 표 읽기는 evaluate가 한 번씩 한다. 순위와 지도 한가운데 비교가 같은 행렬에서 나온다.
        // 지도 한가운데 비교는 조건을 모두 만족할 때만 붙는다.
        return StatelessResult(
            evaluation.recommendation,
            evaluation.mapMiddle,
            origins,
            request.nicknames,
            evaluation.missingServices,
        )
    }
}
