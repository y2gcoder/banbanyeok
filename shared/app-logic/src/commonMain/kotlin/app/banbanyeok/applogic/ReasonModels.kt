package app.banbanyeok.applogic

/** 추천 기준. 코어의 모드와 같은 뜻이지만 이 모듈이 따로 정의한다(코어에 의존하지 않는다). */
public enum class ReasonMode { FAIR, FAST, FAVOR }

/** 서버 응답의 `reasonCode`와 같은 이름. 순위 1이면 1위 코드, 2위 이하면 대안 코드다. */
public enum class ReasonCode(
    public val mode: ReasonMode,
    public val isAlternative: Boolean,
) {
    FAIR_MINIMAX(ReasonMode.FAIR, false),
    FAIR_ALTERNATIVE(ReasonMode.FAIR, true),
    FAST_TOTAL(ReasonMode.FAST, false),
    FAST_ALTERNATIVE(ReasonMode.FAST, true),
    FAVOR_CAPPED(ReasonMode.FAVOR, false),
    FAVOR_ALTERNATIVE(ReasonMode.FAVOR, true),
}

/**
 * 사람 한 명.
 *
 * @property id 사람을 구별하는 값(참가자 ID나 입력 순서 인덱스). 같은 출발역을 두 명이 넣을 수 있으므로 역 코드로 구별하지 않는다.
 * @property name 표시 이름(별칭). null이거나 비어 있으면 입력 순서대로 "나/친구1/친구2/친구3"으로 쓴다.
 *   A/B 같은 이름을 쓰고 싶으면 호출하는 쪽이 이름으로 넣는다.
 * @property originCode 출발역 코드(3자 정규형). 숨긴 참가자는 null.
 */
public data class PersonRef(
    val id: String,
    val name: String? = null,
    val originCode: String? = null,
)

/** 만날 역에서의 사람별 소요 시간(정수 초)과 환승 횟수. 입력 순서 = 사람 순서(A, B, C, D). */
public data class PersonTime(
    val person: PersonRef,
    val seconds: Int,
    val transfers: Int,
)

/**
 * 비교 대상 후보. 1위의 문장은 **2위**와, 2위 이하의 문장은 **1위**와 비교한다.
 *
 * @property rank 비교 대상의 순위(1위 카드는 2, 대안 카드는 1).
 * @property timesSeconds 사람별 시간(초). 입력 순서가 [ReasonInput.people]와 같다.
 */
public data class Comparison(
    val rank: Int,
    val stationCode: String,
    val stationName: String,
    val timesSeconds: List<Int>,
)

/**
 * 배려(favor) 모드의 맥락.
 *
 * @property index 우대 대상의 위치(0부터).
 * @property baselineTimesSeconds 엄밀한 공평 1위(기준역)에서의 사람별 시간(초).
 * @property capSeconds 사람별 상한 시간(초). 우대 대상 자리는 무시하며, 상한이 없으면 null.
 * @property closerStationsExcluded 우대 대상에게 더 가깝지만 다른 사람의 상한을 넘어 빠진 후보가 있었다.
 */
public data class FavorContext(
    val index: Int,
    val baselineTimesSeconds: List<Int>,
    val capSeconds: List<Int?>,
    val closerStationsExcluded: Boolean = false,
)

/**
 * 추천 이유 문장 하나를 만들기 위한 입력(후보 카드 한 장).
 *
 * @property rank 1부터. 최대 [MAX_RANK].
 * @property maxSeconds 최장 시간(초). [people]에서 다시 계산한 값과 같아야 한다.
 * @property spreadSeconds 최장 − 최단(초). 같아야 한다.
 * @property totalSeconds 합계(초). 같아야 한다.
 * @property toleranceSeconds 동점 허용오차(초). 0이면 쓰지 않음. 양수면 문장 끝에 "(N분 동점 옵션)"을 붙인다.
 * @property comparison 비교 대상(1위는 2위, 대안은 1위). 후보가 하나뿐이면 null.
 * @property favor [mode]가 FAVOR일 때 필수, 아니면 null.
 * @property isFairBaseline 이 역이 엄밀한 공평 1위와 같은 역이다(빨리 만나기 1위 문구에 쓴다).
 */
public data class ReasonInput(
    val mode: ReasonMode,
    val rank: Int,
    val stationCode: String,
    val stationName: String,
    val people: List<PersonTime>,
    val maxSeconds: Int,
    val spreadSeconds: Int,
    val totalSeconds: Int,
    val reasonCode: ReasonCode,
    val toleranceSeconds: Int = 0,
    val comparison: Comparison? = null,
    val favor: FavorContext? = null,
    val isFairBaseline: Boolean = false,
) {
    public companion object {
        public const val MAX_RANK: Int = 3
    }
}

/** 입력 검증 오류 코드. 검증은 아래 선언 순서대로 하고 첫 번째 오류 하나만 보고한다. */
public enum class InputErrorCode {
    /** 사람은 2~4명. */
    PEOPLE_COUNT,

    /** 사람 ID가 비어 있다. */
    BLANK_PERSON_ID,

    /** 같은 사람(ID)이 두 번 들어 있다. 같은 출발역을 두 사람이 넣는 것은 허용한다. */
    DUPLICATE_PERSON,

    /** 별칭이 코드포인트 20자를 넘는다. */
    NICKNAME_TOO_LONG,

    /** 별칭에 짝 없는 서로게이트가 있다. */
    NICKNAME_MALFORMED,

    /** 역 코드가 3자 소문자 base32 정규형이 아니다. */
    BAD_STATION_CODE,

    /** 역 이름이 비어 있다. */
    EMPTY_STATION_NAME,

    /** 시간·환승·허용오차가 음수다. */
    NEGATIVE_VALUE,

    /** 순위가 1..3이 아니다. */
    RANK_OUT_OF_RANGE,

    /** `reasonCode`가 모드·순위와 맞지 않는다(순위 1은 1위 코드, 2 이상은 대안 코드). */
    REASON_CODE_MISMATCH,

    /** 최장·차이·합계가 사람별 시간에서 다시 계산한 값과 다르다. */
    AGGREGATE_MISMATCH,

    /** 비교 대상의 순위·인원 수·역 코드가 맞지 않는다. */
    COMPARISON_MISMATCH,

    /** 배려 모드인데 [FavorContext]가 없거나, 배려가 아닌데 있다. */
    FAVOR_CONTEXT_MISSING,

    /** 배려 맥락의 위치·길이·값이 올바르지 않다. */
    FAVOR_CONTEXT_INVALID,
}

/** 입력이 규칙을 어겼다. [code]로 구별한다. */
public class ReasonInputException(
    public val code: InputErrorCode,
) : IllegalArgumentException("추천 이유 입력 오류: $code")
