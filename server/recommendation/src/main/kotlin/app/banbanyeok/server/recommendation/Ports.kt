package app.banbanyeok.server.recommendation

/** 출발역 N개 × 후보 M개. 도달 불가는 [times]와 [transfers]의 같은 칸이 함께 null이다. 행은 요청한 출발역 순서다. */
public class TravelMatrix(
    public val candidates: List<String>,
    public val times: List<List<Int?>>,
    public val transfers: List<List<Int?>>,
)

/** 출발역에서 모든 후보역까지의 시간·환승(정수 초, 횟수). 지금 구현은 od.bin 기반이다. */
public interface TravelTimeProvider {
    /** 계산에 쓰는 산출물의 manifest dataVersion. */
    public val dataVersion: String

    public fun isOrigin(code: String): Boolean

    /** 모든 [origins]가 [isOrigin]이어야 한다. */
    public fun measure(origins: List<String>): TravelMatrix
}

/** 역 코드의 표시 이름. */
public fun interface StationNames {
    public fun nameOf(code: String): String?
}
