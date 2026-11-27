package app.banbanyeok.server.room

import app.banbanyeok.schema.StationRegion

/** 방의 권역은 저장된 사실이다. 남은 참가자의 역에서 추론하지 않으므로 실린 데이터가 바뀌어도 방의 권역은 그대로다. */
public class RoomRegionRule(
    private val stations: StationCatalog,
) {
    /** 이 출발역으로 방을 만들면 방의 권역. 권역을 모르는 역(권역 파일을 읽지 않는 서버의 부산 역 등)은 받지 않는다. */
    public fun regionFor(code: String): StationRegion = stations.regionOf(stations.canonical(code)) ?: mismatch()

    public fun requireMatch(
        room: Room,
        code: String,
    ) {
        if (regionFor(code) != room.region) mismatch()
    }

    private fun mismatch(): Nothing = throw RoomException(RoomError.REGION_MISMATCH, "방과 추천은 한 권역 안에서 계산합니다")
}
