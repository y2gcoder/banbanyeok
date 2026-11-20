package app.banbanyeok.server.app.http

import app.banbanyeok.server.recommendation.MapMiddle
import app.banbanyeok.server.recommendation.ParticipantTime
import app.banbanyeok.server.recommendation.RecommendedStation
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// 결과(Result)의 카드·지도 한가운데는 값이 없을 때 키를 생략해야 해서 직접 만든다.

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
