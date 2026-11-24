package app.banbanyeok.server.recommendation

import app.banbanyeok.applogic.ParticipantLabel
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.recommendation.lasttrain.LastTrainBasis
import app.banbanyeok.server.recommendation.lasttrain.ParticipantLastTrain
import app.banbanyeok.server.recommendation.route.ParticipantRoute
import app.banbanyeok.server.recommendation.time.DayCertainty
import app.banbanyeok.server.recommendation.time.TimeBasis
import app.banbanyeok.server.recommendation.time.TimeSlotResolver

public enum class RecommendMode { FAIR, FAST, FAVOR }

/**
 * 계산에 들어가는 사람 한 명. [id]는 방에서는 participantId, 무상태 추천에서는 입력 순서의 인덱스 문자열이다.
 * [hidden]이면 [originCode]는 계산에만 쓰고 표시 이름·문장에는 출발역을 쓰지 않는다.
 */
public class RecommendParticipant(
    public val id: String,
    public val nickname: String?,
    public val originCode: String,
    public val hidden: Boolean = false,
)

public class RecommendRequest(
    public val participants: List<RecommendParticipant>,
    public val mode: RecommendMode,
    /** [RecommendMode.FAVOR]일 때 우대할 사람의 [RecommendParticipant.id]. */
    public val favorId: String? = null,
    /** 언제 만나는가. 무상태 추천은 요청의 구분, 방은 약속 날짜·시각에서 정한 구분([TimeSlotResolver]). */
    public val time: TimeBasis = TimeBasis.of(TimeSlot.DEFAULT),
    /** [time]의 요일 종류를 믿을 수 있는가. 막차 시각은 [DayCertainty.KNOWN]일 때만 낸다. */
    public val dayCertainty: DayCertainty = DayCertainty.KNOWN,
    /**
     * 이 결과를 보는 참가자의 [RecommendParticipant.id](방에서 토큰으로 확인한 본인). 숨긴 사람의 막차는 본인 요청에만 붙고, 숨긴 사람
     * 쪽으로 맞춘 결과(favor)도 본인만 받는다(#162).
     */
    public val viewerId: String? = null,
)

/**
 * 한 사람의 시간. 출발역을 숨긴 사람을 본인이 아닌 요청이 볼 때는 뭉뚱그린 시간이고 [transfers]가 null이다([HiddenTimes], #142).
 */
public data class ParticipantTime(
    public val participantId: String,
    public val seconds: Int,
    public val transfers: Int?,
)

/**
 * 상위 후보 한 장. [times]와 최장·차이·합계·우대 시간·[reason]은 **보는 사람에게 보이는 값**이다: 출발역을 숨긴 다른 사람의 칸은
 * 뭉뚱그린 값이고 집계도 그 값으로 다시 계산한다([HiddenTimes]). 순위는 정확한 값으로 정했다.
 */
public data class RecommendedStation(
    public val rank: Int,
    public val stationCode: String,
    public val stationName: String,
    public val times: List<ParticipantTime>,
    public val maxSeconds: Int,
    public val spreadSeconds: Int,
    public val totalSeconds: Int,
    public val favoredSeconds: Int?,
    public val reasonCode: String,
    public val reason: String,
    /** 이 역에서 돌아가는 사람별 막차(#62). 막차 표를 쓸 수 없으면 null. 숨긴 사람은 본인 요청일 때만 들어 있다. */
    public val lastTrains: List<ParticipantLastTrain>? = null,
    /**
     * 이 역까지 사람별 화면용 경로(#120). 노선 그래프를 쓸 수 없으면 null. 숨긴 사람은 본인 요청일 때만, 같은 역에서 출발하는 사람은 없다.
     * 순위·시간과 상관없는 표시 값이다(시간·환승 수는 [times]가 od 값이다).
     */
    public val routes: List<ParticipantRoute>? = null,
)

public data class Recommendation(
    /** `ok` 또는 `no_common_candidate`. */
    public val status: String,
    public val mode: RecommendMode,
    public val dataVersion: String,
    public val baselineStationCode: String?,
    public val candidates: List<RecommendedStation>,
    /** 요청 참가자 순서의 표시 이름(contracts/data-format.md §8). 문장도 이 이름을 쓴다. */
    public val labels: List<ParticipantLabel>,
    /** 실제로 계산한 구분. 요청한 구분의 행렬이 데이터에 없으면 기본 구분(평일 낮)이며 표시 이름도 그것을 따른다. */
    public val timeBasis: TimeBasis = TimeBasis.of(TimeSlot.DEFAULT),
    /** 요청한(방은 약속 날짜·시각에서 정한) 구분. [timeBasis]와 다르면 기본 구분으로 대신 계산한 것이다. */
    public val requestedSlot: TimeSlot = TimeSlot.DEFAULT,
    /** 막차의 기준(요일 종류·시간표 수집일). null이면 이 응답에는 막차가 없다(후보의 `lastTrains`도 null). */
    public val lastTrainBasis: LastTrainBasis? = null,
    /**
     * 막차 표를 아직 읽는 중이라 이 응답에 막차가 없다(서버가 막 떴다, [lasttrain.LastTrainSource.pending]). 잠시 뒤 같은 요청에는 막차가
     * 붙을 수 있다. 데이터에 막차 표가 없거나 다른 구분으로 대신 계산해 막차가 없는 것은 false다.
     */
    public val lastTrainPending: Boolean = false,
)

/**
 * "지도 한가운데" 역(#68): 출발역 좌표의 평균점에서 가장 가까운, **모두가 갈 수 있는** 만날 역. 공평 순위와 별개로 표시만 더하는 값이다.
 * [times]는 요청 참가자 순서이고 [Recommendation]의 후보 시간과 같은 행렬(같은 데이터 버전·같은 구분의 od)에서 꺼낸 값이다.
 */
public data class MapMiddle(
    public val stationCode: String,
    public val stationName: String,
    public val times: List<ParticipantTime>,
)

public enum class RecommendationError {
    PEOPLE_COUNT,
    INVALID_NICKNAME,
    UNKNOWN_STATION,
    FAVOR_TARGET_REQUIRED,
    FAVOR_TARGET_UNKNOWN,

    /** 우대 대상이 출발역을 숨긴 사람인데 그 사람 본인의 요청이 아니다(#162). */
    FAVOR_TARGET_HIDDEN,
}

/** 요청이 규칙에 맞지 않는다. 호출하는 쪽(HTTP 계층)이 400/409 등으로 옮긴다. */
public class RecommendationException(
    public val error: RecommendationError,
    message: String,
) : RuntimeException(message)
