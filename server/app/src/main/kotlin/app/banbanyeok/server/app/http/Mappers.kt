package app.banbanyeok.server.app.http

import app.banbanyeok.applogic.ParticipantLabel
import app.banbanyeok.applogic.ParticipantLabels
import app.banbanyeok.applogic.PersonRef
import app.banbanyeok.schema.LastTrainCell
import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.app.application.AppException
import app.banbanyeok.server.app.application.PreviewBasis
import app.banbanyeok.server.app.application.PreviewStation
import app.banbanyeok.server.app.application.RoomPreview
import app.banbanyeok.server.app.application.RoomResult
import app.banbanyeok.server.app.application.StatelessResult
import app.banbanyeok.server.recommendation.MapMiddle
import app.banbanyeok.server.recommendation.ParticipantTime
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.Recommendation
import app.banbanyeok.server.recommendation.RecommendedStation
import app.banbanyeok.server.recommendation.StationNames
import app.banbanyeok.server.recommendation.lasttrain.LastTrainBasis
import app.banbanyeok.server.recommendation.lasttrain.ParticipantLastTrain
import app.banbanyeok.server.recommendation.route.ParticipantRoute
import app.banbanyeok.server.recommendation.route.RouteStop
import app.banbanyeok.server.recommendation.time.TimeBasis
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
import java.time.LocalTime
import java.time.format.DateTimeParseException

fun RoomMode.wire(): String = name.lowercase()

fun RecommendMode.wire(): String = name.lowercase()

fun ParticipantView.toDto(
    stations: StationNames,
    label: ParticipantLabel,
) = ParticipantDto(
    participantId = id,
    nickname = nickname,
    hidden = hidden,
    originCode = originCode,
    originName = stations.displayName(originCode),
    isHost = isHost,
    isSelf = isSelf,
    label = label.text,
    labelKind = label.kind.name.lowercase(),
    shortLabel = label.short,
    enteredByHost = enteredByHost,
)

/**
 * 방 참여자의 표시 이름. 숨긴 사람은 보는 사람이 본인이어도 출발역 이름을 넘기지 않는다(누가 보든 같은 이름, data-format §8).
 * 결과 응답은 문장과 같은 값을 쓰도록 [Recommendation.labels]를 쓴다.
 */
fun labelsOf(
    participants: List<ParticipantView>,
    stations: StationNames,
): List<ParticipantLabel> =
    ParticipantLabels.of(
        participants.map {
            PersonRef(it.id, it.nickname, originName = if (it.hidden) null else stations.displayName(it.originCode))
        },
    )

fun RoomView.participantDtos(stations: StationNames): List<ParticipantDto> =
    participants.zip(labelsOf(participants, stations)) { participant, label -> participant.toDto(stations, label) }

fun RoomView.toDto(
    stations: StationNames,
    timeBasis: TimeBasis,
) = RoomDto(
    roomId = id,
    mode = mode.wire(),
    favorTarget = favorParticipantId,
    locked = locked,
    meetingDate = meetingDate?.toString(),
    meetingTime = meetingTime?.wire(),
    meetingBand = meetingBand?.id,
    expiresAt = expiresAt.toString(),
    dataVersion = dataVersion,
    participants = participantDtos(stations),
    timeBasis = timeBasis.toDto(requested = timeBasis.slot),
    roomHash = roomHash,
    createdAt = createdAt.toString(),
    shareVersion = shareVersion.value,
    decision =
        decision?.let {
            DecisionDto(it.stationCode, stations.stationName(it.stationCode), it.decidedBy, it.decidedAt.toString())
        },
    favorDraw =
        favorDraw?.let { draw ->
            FavorDrawDto(
                draw.generation,
                draw.round,
                draw.maxRounds,
                draw.candidates,
                draw.winner,
                draw.drawnAt?.toString(),
                draw.excluded.map { DrawExclusionDto(it.participantId, it.reason.name.lowercase()) },
            )
        },
)

/** 출발역·정한 역의 표시 이름. 레지스트리에 없으면 null. */
private fun StationNames.displayName(code: String?): String? = code?.let { nameOf(it) }

private fun StationNames.stationName(code: String): String = nameOf(code) ?: code

private fun LocalTime.wire(): String = "%02d:%02d".format(java.util.Locale.ROOT, hour, minute)

fun RoomPreview.toDto(
    stations: StationNames,
    reader: LastTrainReader = LastTrainReader.BASE,
): RoomPreviewDto {
    val header =
        PreviewRoomDto(
            roomId = room.roomId,
            shareVersion = room.shareVersion.value,
            participantCount = room.participantCount,
            canJoin = room.canJoin,
            meetingDate = room.meetingDate?.toString(),
            meetingTime = room.meetingTime?.wire(),
            meetingBand = room.meetingBand?.id,
            timeBasis = room.timeBasis.toDto(requested = room.timeBasis.slot),
            enteredByHost = true.takeIf { room.enteredByHost },
        )

    fun PreviewBasis.dto() = PreviewBasisDto(mode.wire(), favorLabel, drawRound)

    fun PreviewStation.dto() =
        PreviewStationDto(
            stationCode,
            stations.stationName(stationCode),
            times.map { PreviewTimeDto(it.label, it.seconds, it.lastTrain?.toDto(withParticipant = false, reader)) },
        )

    return when (this) {
        is RoomPreview.Collecting -> {
            RoomPreviewDto.Collecting(header)
        }

        is RoomPreview.Result -> {
            RoomPreviewDto.Result(
                header,
                dataVersion,
                basis.dto(),
                station.dto(),
                lastTrainBasis?.toDto(),
                mapMiddle?.let { middle ->
                    PreviewMapMiddleDto(
                        middle.stationCode,
                        middle.stationName,
                        middle.times.map { PreviewMiddleTimeDto(it.label, it.seconds) },
                    )
                },
                true.takeIf { lastTrainPending },
            )
        }

        is RoomPreview.Decided -> {
            RoomPreviewDto.Decided(
                header,
                dataVersion,
                basis.dto(),
                station.dto(),
                decidedBy,
                decidedAt.toString(),
                lastTrainBasis?.toDto(),
                true.takeIf { lastTrainPending },
            )
        }
    }
}

/** 계산 기준 DTO. [requested]는 요청한(방은 약속 날짜·시각에서 정한) 구분이고 `slot`과 다르면 기본 구분으로 대신 계산했다는 뜻이다. */
private fun TimeBasis.toDto(requested: TimeSlot) =
    TimeBasisDto(
        timeSlot = slot.id,
        requestedTimeSlot = requested.id,
        dayType = slot.day.id,
        band = slot.band.id,
        label = label,
        holidayName = holidayName,
    )

private fun Recommendation.toDto(
    participants: List<ParticipantDto>,
    reader: LastTrainReader,
) = ResultDto(
    status = status,
    mode = mode.wire(),
    dataVersion = dataVersion,
    participants = participants,
    baselineStationCode = baselineStationCode,
    candidates = candidates.map { it.toDto(reader) },
    timeBasis = timeBasis.toDto(requested = requestedSlot),
    lastTrainBasis = lastTrainBasis?.toDto(),
    lastTrainPending = true.takeIf { lastTrainPending },
)

fun RoomResult.toDto(
    stations: StationNames,
    reader: LastTrainReader = LastTrainReader.BASE,
): ResultDto =
    recommendation
        .toDto(
            participants.zip(recommendation.labels) { participant, label -> participant.toDto(stations, label) },
            reader,
        ).copy(shareVersion = shareVersion.value, missingServices = missingServices)

/** 무상태 추천: 참가자는 입력 순서의 인덱스 문자열("0", "1", …)로 구분한다. */
fun StatelessResult.toDto(
    stations: StationNames,
    reader: LastTrainReader = LastTrainReader.BASE,
): ResultDto =
    recommendation
        .toDto(
            origins.mapIndexed { index, code ->
                val label = recommendation.labels[index]
                ParticipantDto(
                    participantId = index.toString(),
                    nickname = nicknames[index]?.trim()?.takeIf { it.isNotEmpty() },
                    hidden = false,
                    originCode = code,
                    originName = stations.displayName(code),
                    isHost = false,
                    isSelf = false,
                    label = label.text,
                    labelKind = label.kind.name.lowercase(),
                    shortLabel = label.short,
                    enteredByHost = false,
                )
            },
            reader,
        ).copy(mapMiddle = mapMiddle?.toDto(), missingServices = missingServices)

/** 응답에 쓰는 막차 종류 이름(openapi `LastTrain.kind`): 직행 확정 / 여유 시각 / 출발 예정 / 확인 필요. */
internal val LastTrainKind.wire: String
    get() =
        when (this) {
            LastTrainKind.DIRECT -> "direct"
            LastTrainKind.MARGIN_TRANSFER, LastTrainKind.MARGIN_DIRECT -> "margin"
            LastTrainKind.SCHEDULED_DIRECT -> "scheduled"
            LastTrainKind.UNKNOWN -> "check"
        }

private fun ParticipantTime.toDto() = ParticipantTimeDto(participantId, seconds, transfers)

private fun RecommendedStation.toDto(reader: LastTrainReader) =
    CandidateDto(
        rank = rank,
        stationCode = stationCode,
        stationName = stationName,
        times = times.map { it.toDto() },
        maxSeconds = maxSeconds,
        spreadSeconds = spreadSeconds,
        totalSeconds = totalSeconds,
        favoredSeconds = favoredSeconds,
        reasonCode = reasonCode,
        reason = reason,
        lastTrains = lastTrains?.map { it.toDto(withParticipant = true, reader) },
        routes = routes?.map { it.toDto() },
    )

private fun ParticipantRoute.toDto() =
    ParticipantRouteDto(
        participantId,
        legs.map { RouteLegDto(it.line, it.from.toDto(), it.to.toDto(), it.waitSeconds, it.rideSeconds) },
    )

private fun RouteStop.toDto() = RouteStopDto(stationCode, stationName)

private fun MapMiddle.toDto() = MapMiddleDto(stationCode, stationName, times.map { it.toDto() })

/**
 * 요청이 읽을 줄 안다고 밝힌 추가 막차 분류(쿼리 `lastTrainKinds`, openapi). 지금은 출발 예정(`scheduled`)뿐이다. 밝히지 않은
 * 요청(그 분류를 모르는 옛 웹)에는 출발 예정 칸을 확인 필요로 준다. 옛 웹은 모르는 분류를 여유 시각처럼 10분 내려 "늦어도 … 출발"과
 * 공유 그림에 쓰기 때문이다(ADR-0010). 서버 우선 배포와 웹 우선 되돌림 동안 새 서버와 옛 웹이 같이 떠 있다.
 */
class LastTrainReader private constructor(
    val scheduled: Boolean,
) {
    companion object {
        val BASE = LastTrainReader(scheduled = false)

        /** 쉼표로 나눈 값. 모르는 값은 무시한다. */
        fun parse(value: String?): LastTrainReader =
            LastTrainReader(value.orEmpty().split(',').any { it.trim() == LastTrainKind.SCHEDULED_DIRECT.wire })
    }
}

/** 막차 한 건. [withParticipant]가 거짓이면 사람 구분을 싣지 않는다(미리보기는 한 역의 한 사람 줄에 붙는다). */
private fun ParticipantLastTrain.toDto(
    withParticipant: Boolean,
    reader: LastTrainReader,
): LastTrainDto {
    val shown = if (cell.kind == LastTrainKind.SCHEDULED_DIRECT && !reader.scheduled) LastTrainCell.UNKNOWN else cell
    val kind = shown.kind
    val margin = kind == LastTrainKind.MARGIN_TRANSFER || kind == LastTrainKind.MARGIN_DIRECT
    return LastTrainDto(
        participantId = participantId.takeIf { withParticipant },
        kind = kind.wire,
        minute = shown.minute,
        transfer = (kind == LastTrainKind.MARGIN_TRANSFER).takeIf { margin },
        boundFor = shown.boundFor?.let { code -> BoundForDto(code.toString(), boundName ?: code.toString()) },
    )
}

private fun LastTrainBasis.toDto() =
    LastTrainBasisDto(
        dayType = dayType.id,
        asOf = asOf.toString(),
        unavailable = unavailable?.name?.lowercase(),
        partial = partial,
    )
