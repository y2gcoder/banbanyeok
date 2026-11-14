package app.banbanyeok.server.app.ops

import app.banbanyeok.server.app.Components
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomMode

/**
 * 로컬 개발용 예시 방 하나를 만든다(참가자 3명, 한 명은 출발역 숨김). 현재 산출물의 출발역에서 서로 떨어진 역을 고른다.
 * 출력에는 개발 DB에만 있는 로컬 토큰이 들어 있으니 운영 DB에 실행하지 마라(운영 프로필에서는 거부한다).
 */
class Seeder(
    private val components: Components,
) {
    suspend fun run() {
        check(
            components.config.profile != app.banbanyeok.server.app.config.Profile.PROD,
        ) { "운영 프로필에서는 seed를 실행하지 않습니다" }
        val services = components.services
        val origins = services.directory.originCodes
        val picks = listOf(origins.first(), origins[origins.size / 2], origins.last())
        val created =
            services.rooms.create(
                CreateRoomCommand(RoomMode.FAIR, null, null, ParticipantInput("민수", picks[0]), 4, null),
            )
        services.rooms.join(created.roomId, ParticipantInput("지연", picks[1], hidden = true), null)
        services.rooms.join(created.roomId, ParticipantInput("서준", picks[2]), null)
        println("예시 방을 만들었습니다 (출발역 ${picks.map { services.directory.displayName(it) }})")
        println("roomId=${created.roomId}")
        println("hostToken=${created.hostToken}")
        println("participantToken=${created.participantToken}")
        println("curl -s localhost:\$SERVER_PORT/v1/rooms/${created.roomId}")
        println("curl -s localhost:\$SERVER_PORT/v1/rooms/${created.roomId}/result")
    }
}
