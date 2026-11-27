package app.banbanyeok.server.app.http

import app.banbanyeok.server.app.application.AppException
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.ErrorKind

private val RECOVERY_KEY = Regex("^[A-Za-z0-9_-]{32,128}$")

/** 복구 키는 추측할 수 없는 값이어야 한다(방장 권한을 되찾는 데 쓰인다). */
fun requireRoomRecoveryKey(recoveryKey: String): String {
    if (!RECOVERY_KEY.matches(recoveryKey)) {
        throw AppException(ErrorKind.INVALID, "INVALID_REQUEST", "recoveryKey는 32~128자의 영문·숫자·_·-여야 합니다")
    }
    return recoveryKey
}

/**
 * 늘 favor·draw인 방이다. 약속일·시간대는 일반 방 만들기와 같은 규칙으로 읽는다. 다른 사람 칸이 없으면 일반 방 만들기와 구별되지
 * 않으므로 이 경로에서는 받지 않는다.
 */
fun DrawRoomCreateRequestDto.toCommand(): CreateRoomCommand {
    if (others.isEmpty()) throw AppException(ErrorKind.INVALID, "INVALID_OTHERS", "others는 1명 이상이어야 합니다")
    val room =
        RoomCreateRequestDto(
            mode = "favor",
            favorTarget = CreateRoomCommand.DRAW_TARGET,
            meetingDate = meetingDate,
            meetingBand = meetingBand,
            host = host,
        )
    return room.toCommand(deviceToken = null).copy(
        others =
            others.map {
                it.toInput("다른 사람 칸은 출발역을 숨길 수 없습니다")
            },
        hostPosition = hostPosition,
    )
}

/** 같은 명단 입력 규칙을 쓰되 뽑기 상태를 만들지 않는다. 이전 결과에서 돌아오면 추천 기준도 이어 간다. */
fun FilledRoomCreateRequestDto.toCommand(): CreateRoomCommand {
    if (others.isEmpty()) throw AppException(ErrorKind.INVALID, "INVALID_OTHERS", "others는 1명 이상이어야 합니다")
    val room =
        RoomCreateRequestDto(
            mode = mode,
            favorTarget = if (mode == "favor") CreateRoomCommand.HOST_TARGET else null,
            meetingDate = meetingDate,
            meetingBand = meetingBand,
            host = host,
        )
    return room.toCommand(deviceToken = null).copy(
        others = others.map { it.toInput() },
        hostPosition = hostPosition,
        initialFavorPosition = favorPosition,
    )
}
