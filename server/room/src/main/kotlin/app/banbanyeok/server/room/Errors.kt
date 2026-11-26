package app.banbanyeok.server.room

/** HTTP를 모르는 분류. app 모듈이 상태 코드로 옮긴다. */
public enum class ErrorKind { INVALID, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT }

public enum class RoomError(
    public val kind: ErrorKind,
) {
    INVALID_STATION(ErrorKind.INVALID),
    REGION_MISMATCH(ErrorKind.INVALID),
    INVALID_NICKNAME(ErrorKind.INVALID),
    INVALID_MEETING_DATE(ErrorKind.INVALID),
    INVALID_MEETING_BAND(ErrorKind.INVALID),
    INVALID_EXPECTED_COUNT(ErrorKind.INVALID),
    INVALID_OUTCOME(ErrorKind.INVALID),
    FAVOR_TARGET_REQUIRED(ErrorKind.INVALID),
    FAVOR_TARGET_UNKNOWN(ErrorKind.INVALID),

    /** 방 만들기의 다른 사람 칸(#227)이 규칙에 맞지 않는다(뽑기 방이 아님, 인원 초과, 방장 자리 범위 밖). */
    INVALID_OTHERS(ErrorKind.INVALID),

    /** 새로 출발역을 숨기려 했다(ADR-0007). 이미 숨긴 참가자의 유지·풀기는 된다. */
    HIDE_NOT_AVAILABLE(ErrorKind.INVALID),
    UNAUTHORIZED(ErrorKind.UNAUTHENTICATED),
    FORBIDDEN(ErrorKind.FORBIDDEN),
    ROOM_NOT_FOUND(ErrorKind.NOT_FOUND),
    PARTICIPANT_NOT_FOUND(ErrorKind.NOT_FOUND),
    ROOM_FULL(ErrorKind.CONFLICT),
    ROOM_LOCKED(ErrorKind.CONFLICT),
    NOT_ENOUGH_PARTICIPANTS(ErrorKind.CONFLICT),

    /** 방의 약속 구분에 그 출발역의 배차를 확인하지 못했다. 저장하면 방 결과가 같은 409가 된다. */
    SCHEDULE_UNAVAILABLE(ErrorKind.CONFLICT),

    /** 화면이 본 뒤 방의 입력이나 정한 역(또는 뽑기 상태)이 바뀌었다. 방을 다시 불러 확인한 뒤 다시 누른다. */
    ROOM_CHANGED(ErrorKind.CONFLICT),

    /** 방을 만들 때 대상을 뽑기로 정한 방이 아니다. */
    DRAW_NOT_AVAILABLE(ErrorKind.CONFLICT),

    /** 뽑기 대상(출발역을 숨기지 않은 참가자)이 2명 미만이다. */
    NOT_ENOUGH_DRAW_CANDIDATES(ErrorKind.CONFLICT),

    /** 다시 뽑기를 이미 썼다. */
    DRAW_LIMIT_REACHED(ErrorKind.CONFLICT),
}

public class RoomException(
    public val error: RoomError,
    message: String,
) : RuntimeException(message)

internal fun reject(
    error: RoomError,
    message: String,
): Nothing = throw RoomException(error, message)
