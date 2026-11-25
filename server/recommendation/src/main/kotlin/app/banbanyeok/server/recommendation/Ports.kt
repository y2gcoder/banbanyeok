package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.StationRegion
import app.banbanyeok.schema.TimeSlot

/**
 * 출발역 N개 × 후보 M개. 도달 불가는 [times]와 [transfers]의 같은 칸이 함께 null이다. 행은 요청한 출발역 순서다.
 * [slot]은 실제로 읽은 구분이다(요청한 구분의 행렬이 없는 데이터면 기본 구분).
 */
public class TravelMatrix(
    public val candidates: List<String>,
    public val times: List<List<Int?>>,
    public val transfers: List<List<Int?>>,
    public val slot: TimeSlot = TimeSlot.DEFAULT,
    public val missingServices: List<String> = emptyList(),
)

/** 출발역에서 모든 후보역까지의 시간·환승(정수 초, 횟수). 지금 구현은 od.bin 기반이다. */
public interface TravelTimeProvider {
    /** 계산에 쓰는 산출물의 manifest dataVersion. */
    public val dataVersion: String

    public fun isOrigin(code: String): Boolean

    public fun regionOf(code: String): StationRegion? = StationRegion.CAPITAL.takeIf { isOrigin(code) }

    /**
     * [code]에서 [slot]으로 계산할 수 있는가(현재 데이터의 권역별 구분 범위와, 대신 계산하지 않는 구분이면 그 행렬). 아니면 [measure]가
     * `SCHEDULE_UNAVAILABLE`이다. 방 쓰기도 이 판정으로 저장 여부를 정한다.
     */
    public fun departs(
        code: String,
        slot: TimeSlot,
    ): Boolean = true

    /**
     * 모든 [origins]가 [isOrigin]이어야 한다. [slot]의 행렬이 없으면(manifest 1세대 데이터) 기본 구분으로 계산하고
     * [TravelMatrix.slot]에 그 사실을 남긴다. 모든 구분은 같은 출발역·후보 축이다.
     */
    public fun measure(
        origins: List<String>,
        slot: TimeSlot = TimeSlot.DEFAULT,
    ): TravelMatrix
}

/** 역 코드의 표시 이름. */
public fun interface StationNames {
    public fun nameOf(code: String): String?
}

/**
 * 기본 구분을 뺀 구분의 행렬을 내준다. 없는 구분(manifest 1세대 데이터, 검사 실패)이면 null. **막지 않는다**: 서버는 시작 뒤 뒤에서
 * 검사하는 동안 null을 주고(app의 BackgroundSlots), 기다림은 [SlotReadiness]가 맡는다.
 */
public fun interface SlotMatrices {
    public fun matrix(slot: TimeSlot): OdMatrix?
}

/**
 * [slot]의 행렬을 쓸 수 있을 때까지(또는 기다릴 만큼) 기다린다. [RecommendationService.evaluate]가 측정 바로 전에 부른다. 기본 구분은
 * 기다릴 것이 없다. 서버 구현(app의 BackgroundSlots)은 뒤에서 도는 구분 행렬 검사를 최대 몇 초 기다리고 요청 스레드를 붙잡지 않는다.
 * 시간을 넘기거나 검사가 실패해도 그냥 돌아온다(그 요청은 기본 구분으로 계산된다).
 */
public fun interface SlotReadiness {
    public suspend fun await(slot: TimeSlot)
}
