package app.banbanyeok.server.app.http

import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.server.recommendation.MapMiddle
import app.banbanyeok.server.recommendation.ParticipantTime
import app.banbanyeok.server.recommendation.RecommendedStation
import app.banbanyeok.server.recommendation.lasttrain.LastTrainBasis
import app.banbanyeok.server.recommendation.lasttrain.ParticipantLastTrain
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// 결과(Result)의 카드·지도 한가운데는 값이 없을 때 키를 생략해야 해서 직접 만든다.

/** 응답에 쓰는 막차 종류 이름(openapi `LastTrain.kind`): 직행 확정 / 여유 시각 / 확인 필요. */
internal val LastTrainKind.wire: String
    get() =
        when (this) {
            LastTrainKind.DIRECT -> "direct"
            LastTrainKind.MARGIN_TRANSFER, LastTrainKind.MARGIN_DIRECT -> "margin"
            LastTrainKind.UNKNOWN -> "check"
        }

fun RecommendedStation.candidateJson(): JsonObject =
    buildJsonObject {
        put("rank", rank)
        put("stationCode", stationCode)
        put("stationName", stationName)
        put("times", JsonArray(times.map { it.toJson() }))
        put("maxSeconds", maxSeconds)
        put("spreadSeconds", spreadSeconds)
        put("totalSeconds", totalSeconds)
        favoredSeconds?.let { put("favoredSeconds", it) }
        put("reasonCode", reasonCode)
        put("reason", reason)
        lastTrains?.let { list -> put("lastTrains", JsonArray(list.map { it.toJson(withParticipant = true) })) }
    }

/**
 * 막차 한 건(openapi `LastTrain`). 값과 분류만 싣는다: `margin`의 10분 단위 내림과 문구는 클라이언트가 한다. 확인 필요(`check`)면
 * 시각이 없다. `transfer`는 여유 시각(`margin`)에만 있고, 행선지(`boundFor`)는 열차 한 대로 가는 길에만 있다.
 */
fun ParticipantLastTrain.toJson(withParticipant: Boolean): JsonObject =
    buildJsonObject {
        if (withParticipant) put("participantId", participantId)
        put("kind", cell.kind.wire)
        cell.minute?.let { put("minute", it) }
        if (cell.kind == LastTrainKind.MARGIN_TRANSFER || cell.kind == LastTrainKind.MARGIN_DIRECT) {
            put("transfer", cell.kind == LastTrainKind.MARGIN_TRANSFER)
        }
        cell.boundFor?.let { code ->
            put(
                "boundFor",
                buildJsonObject {
                    put("stationCode", code.toString())
                    put("stationName", boundName ?: code.toString())
                },
            )
        }
    }

fun LastTrainBasis.toJson(): JsonObject =
    buildJsonObject {
        put("dayType", dayType.id)
        put("asOf", asOf.toString())
        unavailable?.let { put("unavailable", it.name.lowercase()) }
        if (partial) put("partial", true)
    }

fun MapMiddle.toJson(): JsonObject =
    buildJsonObject {
        put("stationCode", stationCode)
        put("stationName", stationName)
        put("times", JsonArray(times.map { it.toJson() }))
    }

private fun ParticipantTime.toJson(): JsonObject =
    buildJsonObject {
        put("participantId", participantId)
        put("seconds", seconds)
        put("transfers", transfers)
    }
