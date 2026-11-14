package app.banbanyeok.server.room

/** HTTP를 모르는 분류. app 모듈이 상태 코드로 옮긴다. */
public enum class ErrorKind { INVALID, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT }

public enum class RoomError(
    public val kind: ErrorKind,
) {
    INVALID_STATION(ErrorKind.INVALID),
    INVALID_NICKNAME(ErrorKind.INVALID),
    INVALID_MEETING_DATE(ErrorKind.INVALID),
    INVALID_EXPECTED_COUNT(ErrorKind.INVALID),
    INVALID_OUTCOME(ErrorKind.INVALID),
    FAVOR_TARGET_REQUIRED(ErrorKind.INVALID),
    FAVOR_TARGET_UNKNOWN(ErrorKind.INVALID),
    UNAUTHORIZED(ErrorKind.UNAUTHENTICATED),
    FORBIDDEN(ErrorKind.FORBIDDEN),
    ROOM_NOT_FOUND(ErrorKind.NOT_FOUND),
    PARTICIPANT_NOT_FOUND(ErrorKind.NOT_FOUND),
    ROOM_FULL(ErrorKind.CONFLICT),
    ROOM_LOCKED(ErrorKind.CONFLICT),
}

public class RoomException(
    public val error: RoomError,
    message: String,
) : RuntimeException(message)

internal fun reject(
    error: RoomError,
    message: String,
): Nothing = throw RoomException(error, message)
