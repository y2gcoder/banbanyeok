package app.banbanyeok.server.app.http

import app.banbanyeok.applogic.ParticipantLabel
import app.banbanyeok.applogic.ParticipantLabels
import app.banbanyeok.applogic.PersonRef
import app.banbanyeok.server.app.application.AppException
import app.banbanyeok.server.app.application.RoomResult
import app.banbanyeok.server.app.application.StationDirectory
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.Recommendation
import app.banbanyeok.server.recommendation.RecommendedStation
import app.banbanyeok.server.room.Change
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.ErrorKind
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.ParticipantView
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomPatch
import app.banbanyeok.server.room.RoomView
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.time.LocalDate
import java.time.format.DateTimeParseException

fun RoomMode.wire(): String = name.lowercase()

fun RecommendMode.wire(): String = name.lowercase()

fun ParticipantView.toDto(
    directory: StationDirectory,
    label: ParticipantLabel,
) = ParticipantDto(
    participantId = id,
    nickname = nickname,
    hidden = hidden,
    originCode = originCode,
    originName = directory.displayName(originCode),
    isHost = isHost,
    isSelf = isSelf,
    label = label.text,
    labelKind = label.kind.name.lowercase(),
)

/**
 * 방 참여자의 표시 이름. 숨긴 사람은 보는 사람이 본인이어도 출발역 이름을 넘기지 않는다(누가 보든 같은 이름, data-format §8).
 * 결과 응답은 문장과 같은 값을 쓰도록 [Recommendation.labels]를 쓴다.
 */
fun labelsOf(
    participants: List<ParticipantView>,
    directory: StationDirectory,
): List<ParticipantLabel> =
    ParticipantLabels.of(
        participants.map {
            PersonRef(it.id, it.nickname, originName = if (it.hidden) null else directory.displayName(it.originCode))
        },
    )

fun RoomView.participantDtos(directory: StationDirectory): List<ParticipantDto> =
    participants.zip(labelsOf(participants, directory)) { participant, label -> participant.toDto(directory, label) }

fun RoomView.toDto(directory: StationDirectory) =
    RoomDto(
        roomId = id,
        mode = mode.wire(),
        favorTarget = favorParticipantId,
        locked = locked,
        meetingDate = meetingDate?.toString(),
        expiresAt = expiresAt.toString(),
        dataVersion = dataVersion,
        participants = participantDtos(directory),
    )

fun RecommendedStation.candidateJson(): JsonObject =
    buildJsonObject {
        put("rank", rank)
        put("stationCode", stationCode)
        put("stationName", stationName)
        put(
            "times",
            JsonArray(
                times.map {
                    buildJsonObject {
                        put("participantId", it.participantId)
                        put("seconds", it.seconds)
                        put("transfers", it.transfers)
                    }
                },
            ),
        )
        put("maxSeconds", maxSeconds)
        put("spreadSeconds", spreadSeconds)
        put("totalSeconds", totalSeconds)
        favoredSeconds?.let { put("favoredSeconds", it) }
        put("reasonCode", reasonCode)
        put("reason", reason)
    }

private fun Recommendation.toDto(participants: List<ParticipantDto>) =
    ResultDto(
        status = status,
        mode = mode.wire(),
        dataVersion = dataVersion,
        participants = participants,
        baselineStationCode = baselineStationCode,
        candidates = candidates.map { it.candidateJson() },
    )

fun RoomResult.toDto(directory: StationDirectory): ResultDto =
    recommendation.toDto(
        participants.zip(recommendation.labels) { participant, label -> participant.toDto(directory, label) },
    )

/** 무상태 추천: 참가자는 입력 순서의 인덱스 문자열("0", "1", …)로 구분한다. */
fun Recommendation.toStatelessDto(
    origins: List<String>,
    nicknames: List<String?>,
    directory: StationDirectory,
): ResultDto =
    toDto(
        origins.mapIndexed { index, code ->
            val label = labels[index]
            ParticipantDto(
                participantId = index.toString(),
                nickname = nicknames[index]?.trim()?.takeIf { it.isNotEmpty() },
                hidden = false,
                originCode = code,
                originName = directory.displayName(code),
                isHost = false,
                isSelf = false,
                label = label.text,
                labelKind = label.kind.name.lowercase(),
            )
        },
    )
