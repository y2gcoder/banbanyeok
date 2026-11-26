package app.banbanyeok.server.room

/**
 * 참가자의 출발역을 방에 저장해도 되는가. 저장소가 방 행을 잠근 트랜잭션 안에서 잠근 방으로 부른다. 그래서 읽은 뒤 방장이 약속을
 * 바꿨어도 바뀐 약속으로 본다. 권역을 먼저 보고 그다음 그 약속의 구분을 본다(다른 권역의 역은 구분과 상관없이 REGION_MISMATCH).
 */
public class OriginRule(
    private val stations: StationCatalog,
) {
    private val regions = RoomRegionRule(stations)

    public fun requireAllowed(
        room: Room,
        code: String,
        hidden: Boolean = false,
    ) {
        regions.requireMatch(room, code, hidden)
        if (!stations.departs(stations.canonical(code), room.meeting)) {
            throw RoomException(RoomError.SCHEDULE_UNAVAILABLE, "이 방의 요일·시간대에 확인된 시간표가 없는 출발역입니다")
        }
    }

    /**
     * 참여를 받은 뒤의 방. 아무도 남지 않은 방(방장도 나갔다)은 들어오는 사람의 권역을 따른다. 방 응답에 권역이 없어 웹은 빈 방의
     * 권역을 모르고 어느 권역의 역이든 고르게 하기 때문이다. 참여자가 있으면 저장된 권역 그대로다.
     */
    public fun joined(
        room: Room,
        participants: List<Participant>,
        code: String,
        hidden: Boolean = false,
    ): Room {
        val target = if (participants.isEmpty()) room.copy(region = regions.regionFor(code, hidden)) else room
        requireAllowed(target, code, hidden)
        return target
    }
}
