package app.banbanyeok.server.app.http

import app.banbanyeok.server.app.application.AppException
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.ErrorKind

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
    return room.toCommand(deviceToken = null).copy(others = others.map { it.toInput() }, hostPosition = hostPosition)
}
