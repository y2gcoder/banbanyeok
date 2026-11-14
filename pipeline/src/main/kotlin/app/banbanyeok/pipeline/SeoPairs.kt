package app.banbanyeok.pipeline

import app.banbanyeok.applogic.Comparison
import app.banbanyeok.applogic.PersonRef
import app.banbanyeok.applogic.PersonTime
import app.banbanyeok.applogic.ReasonCode
import app.banbanyeok.applogic.ReasonGenerator
import app.banbanyeok.applogic.ReasonInput
import app.banbanyeok.applogic.ReasonMode
import app.banbanyeok.core.Candidate
import app.banbanyeok.core.RankInput
import app.banbanyeok.core.rank
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.StationStatus
import kotlinx.serialization.json.JsonObject

internal fun seoPairs(
    registry: Registry,
    od: OdMatrix,
    hubs: List<String>,
    dataVersion: String,
): JsonObject {
    val ordered = hubs.distinct().sorted()
    val active = registry.stations.filter { it.status == StationStatus.ACTIVE }.associateBy { it.code }
    require(ordered.all { it in active && od.indexOfOrigin(StationCode.parse(it)) >= 0 }) {
        "SEO hubs must be active supported origins"
    }
    val pairs =
        ordered.flatMapIndexed { index, a ->
            ordered.drop(index + 1).map { b -> obj("a" to a, "b" to b, "results" to seoResults(registry, od, a, b)) }
        }
    return obj("schemaVersion" to 1, "dataVersion" to dataVersion, "pairs" to pairs)
}

private fun seoResults(
    registry: Registry,
    od: OdMatrix,
    a: String,
    b: String,
): List<JsonObject> {
    val origins = listOf(a, b).map { od.indexOfOrigin(StationCode.parse(it)) }
    val candidates = (0 until od.candidateCount).map { od.candidateCode(it).toString() }
    val ranked =
        rank(
            RankInput(
                participants = listOf(a, b),
                candidates = candidates,
                times =
                    origins.map { origin ->
                        candidates.indices.map { od.timeSeconds(origin, it).takeIf { t -> t >= 0 } }
                    },
                transfers =
                    origins.map { origin ->
                        candidates.indices.map { od.transfers(origin, it).takeIf { t -> t >= 0 } }
                    },
                mode = "fair",
            ),
        ).recommendations.take(3)
    val stations = registry.stations.associateBy { it.code }
    return ranked.map { candidate ->
        val other = if (candidate.rank == 1) ranked.getOrNull(1) else ranked.first()
        val reason =
            ReasonGenerator.generate(
                ReasonInput(
                    mode = ReasonMode.FAIR,
                    rank = candidate.rank,
                    stationCode = candidate.stationCode,
                    stationName = stations.getValue(candidate.stationCode).name,
                    people =
                        candidate.times.map { time ->
                            PersonTime(
                                // 이름 없이 출발역만 넘겨 웹·서버와 같은 표시 이름("{역}에서 오는 분")을 쓴다.
                                PersonRef(
                                    id = time.participantId,
                                    originCode = time.participantId,
                                    originName = stations.getValue(time.participantId).name,
                                ),
                                time.seconds,
                                time.transfers,
                            )
                        },
                    maxSeconds = candidate.maxSeconds,
                    spreadSeconds = candidate.spreadSeconds,
                    totalSeconds = candidate.totalSeconds.toInt(),
                    reasonCode = ReasonCode.valueOf(candidate.reasonCode),
                    comparison =
                        other?.let {
                            Comparison(
                                it.rank,
                                it.stationCode,
                                stations.getValue(it.stationCode).name,
                                it.times.map { time -> time.seconds },
                            )
                        },
                ),
            )
        seoResult(candidate, reason)
    }
}

private fun seoResult(
    candidate: Candidate,
    reason: String,
): JsonObject =
    obj(
        "stationCode" to candidate.stationCode,
        "times" to candidate.times.map { it.seconds },
        "transfers" to candidate.times.map { it.transfers },
        "maxSeconds" to candidate.maxSeconds,
        "spreadSeconds" to candidate.spreadSeconds,
        "totalSeconds" to candidate.totalSeconds,
        "reason" to reason,
    )
