package app.banbanyeok.server.app.http

import app.banbanyeok.server.app.application.AppException
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.room.Change
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.ErrorKind
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomPatch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import java.time.LocalDate
import java.time.format.DateTimeParseException

// 요청 DTO를 서비스 입력으로 옮긴다. 문자열 검증 실패는 계약의 400 오류가 된다.

fun parseRoomMode(text: String): RoomMode? = RoomMode.entries.firstOrNull { it.wire() == text }

fun parseRecommendMode(text: String): RecommendMode? = RecommendMode.entries.firstOrNull { it.wire() == text }

private const val MODE_MESSAGE = "mode는 fair, fast, favor 중 하나여야 합니다"

fun requireRecommendMode(text: String): RecommendMode =
    parseRecommendMode(text) ?: throw AppException(ErrorKind.INVALID, "INVALID_MODE", MODE_MESSAGE)

fun RoomCreateRequestDto.toCommand(deviceToken: String?): CreateRoomCommand {
    val roomMode = parseRoomMode(mode) ?: throw AppException(ErrorKind.INVALID, "INVALID_MODE", MODE_MESSAGE)
    return CreateRoomCommand(
        roomMode,
        favorTarget,
        meetingDate?.let(::parseDate),
        host.toInput(),
        expectedCount,
        deviceToken,
    )
}

fun ParticipantInputDto.toInput() = ParticipantInput(nickname, originCode, hidden)

private fun parseDate(text: String): LocalDate =
    try {
        LocalDate.parse(text)
    } catch (e: DateTimeParseException) {
        throw AppException(ErrorKind.INVALID, "INVALID_MEETING_DATE", "meetingDate는 YYYY-MM-DD 형식이어야 합니다")
    }

/** PATCH는 키가 없는 것(바꾸지 않음)과 null(지움)을 구별해야 해서 JSON 객체를 직접 읽는다. */
fun JsonObject.toRoomPatch(): RoomPatch {
    val mode =
        this["mode"]?.stringValue("mode")?.let {
            parseRoomMode(it)
                ?: throw AppException(ErrorKind.INVALID, "INVALID_MODE", MODE_MESSAGE)
        }
    val locked = this["locked"]?.let { (it as? JsonPrimitive)?.takeIf { p -> !p.isString }?.booleanOrNull }
    val meetingDate =
        if ("meetingDate" in this) {
            Change.Set(this["meetingDate"]?.takeIf { it !is JsonNull }?.stringValue("meetingDate")?.let(::parseDate))
        } else {
            Change.Unchanged
        }
    return RoomPatch(mode, this["favorTarget"]?.stringValue("favorTarget"), locked, meetingDate)
}

private fun JsonElement.stringValue(field: String): String =
    (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
        ?: throw AppException(ErrorKind.INVALID, "INVALID_REQUEST", "$field 는 문자열이어야 합니다")
