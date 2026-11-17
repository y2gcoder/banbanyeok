package app.banbanyeok.server.room

/** 정하기·풀기 쓰기의 결과. 저장소가 방 행을 잠근 채 [DecisionRule]로 정한다. */
public sealed interface DecisionResult {
    /** 썼다. 트리거가 공유 번호를 올리고 기준 번호를 찍었다. */
    public data object Applied : DecisionResult

    /** 이미 그 상태다(같은 역이 정해져 있거나, 정한 역 없이 풀기). 아무것도 쓰지 않았다. */
    public data object Unchanged : DecisionResult

    /** 화면이 본 번호가 정한 역 칸의 마지막 변경보다 오래됐거나 지금 번호보다 크다. */
    public data object Stale : DecisionResult

    /** 요청한 사람이 이제 방에 없다(읽은 뒤 나갔거나 내보내졌다). */
    public data object NotMember : DecisionResult

    /** 정하려면 참가자가 2명 이상이어야 한다. */
    public data object TooFew : DecisionResult

    public data object RoomNotFound : DecisionResult
}

/** 두 저장소(Postgres, 메모리 fake)가 같은 판정을 쓰도록 한 곳에 둔다. */
public object DecisionRule {
    private const val MIN_PEOPLE = 2

    /**
     * 순서가 규칙이다. 이미 그 상태면 번호를 보지 않고 [DecisionResult.Unchanged]라서 성공한 요청의 재시도도 200이다.
     * 번호 검사(기준 번호 ≤ 본 번호 ≤ 지금 번호)는 입력이 바뀐 뒤의 정하기와, 화면이 보지 못한 정함을 바꾸거나 푸는 것을 함께 막는다.
     */
    public fun verdict(
        room: Room,
        members: Collection<String>,
        actor: String,
        decision: Decision?,
        seen: ShareVersion,
    ): DecisionResult =
        when {
            actor !in members -> DecisionResult.NotMember
            decision != null && members.size < MIN_PEOPLE -> DecisionResult.TooFew
            room.decision?.stationCode == decision?.stationCode -> DecisionResult.Unchanged
            seen < room.decisionBasis || seen > room.shareVersion -> DecisionResult.Stale
            else -> DecisionResult.Applied
        }
}
