package app.banbanyeok.server.room

import java.time.Instant
import java.time.temporal.ChronoUnit

internal const val MAX_ROOM_PEOPLE = 4

/** 방장까지 2~4명이고(예상 인원이 있으면 그 안), 방장과 배려 대상은 입력 순서 안이어야 한다. */
internal fun validateOthers(
    command: CreateRoomCommand,
    allowFilled: Boolean,
) {
    command.initialFavorPosition?.let {
        if (!allowFilled || command.mode != RoomMode.FAVOR || it !in 0..command.others.size) {
            reject(RoomError.FAVOR_TARGET_UNKNOWN, "배려 대상은 입력한 참가자여야 합니다")
        }
    }
    if (command.others.isEmpty()) {
        if (command.hostPosition != 0) reject(RoomError.INVALID_OTHERS, "다른 사람 칸이 없으면 방장 자리는 0입니다")
        return
    }
    val drawn = command.mode == RoomMode.FAVOR && command.favorTarget == CreateRoomCommand.DRAW_TARGET
    if (!drawn && !allowFilled) {
        reject(RoomError.INVALID_OTHERS, "다른 사람 칸은 배려 대상을 뽑기로 정하는 방에서만 넣을 수 있습니다")
    }
    val total = command.others.size + 1
    if (total > (command.expectedCount ?: MAX_ROOM_PEOPLE)) {
        reject(RoomError.INVALID_OTHERS, "방장을 포함해 ${command.expectedCount ?: MAX_ROOM_PEOPLE}명까지 넣을 수 있습니다")
    }
    if (command.hostPosition !in 0..command.others.size) {
        reject(RoomError.INVALID_OTHERS, "방장 자리는 0~${command.others.size}이어야 합니다")
    }
}

internal fun newParticipant(
    id: String,
    tokenHash: TokenHash,
    anonId: String?,
    input: ParticipantInput,
    now: Instant,
) = Participant(id, tokenHash, anonId, input.nickname, input.originCode, input.hidden, now, now)

/**
 * 방을 만들 때의 입장 순서. 원래 입력 순서(방장은 [hostPosition] 자리)대로 1마이크로초씩 늦춰 입장 시각을 준다. 입장 순서가 표시 이름의
 * 번호와 뽑기 대상의 칸 순서를 정하는데, 같은 시각이면 무작위 참가자 ID 순이 되기 때문이다(DB는 마이크로초까지 저장한다).
 */
internal fun inputOrder(
    others: List<Participant>,
    host: Participant,
    hostPosition: Int,
): List<Participant> {
    val ordered = others.toMutableList().apply { add(hostPosition, host) }
    val base = host.joinedAt.truncatedTo(ChronoUnit.MICROS)
    return ordered.mapIndexed { i, p -> p.copy(joinedAt = base.plus(i.toLong(), ChronoUnit.MICROS)) }
}
