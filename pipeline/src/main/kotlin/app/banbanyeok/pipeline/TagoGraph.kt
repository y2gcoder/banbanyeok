package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject

internal const val MIN_MATCHED = 3
internal const val MIN_RATIO = 0.4
internal val RUN_RANGE = 30..1800
internal val TAGO_HEADWAY_RANGE = 60..7200

/** Nodes contributed by TAGO services: (registry code, service id), joins reuse the S3 service node. */
internal fun tagoNodes(
    tago: TagoInput,
    codes: Map<String, String>,
): List<Pair<String, String>> =
    tago.lines.services.flatMap { service ->
        service.stations.map { id -> codes.getValue(id) to (service.joins[id] ?: service.id) }
    }

/** Boarding headway of a TAGO service from the stations no other service of its group stops at. */
internal fun tagoServiceHeadways(tago: TagoInput): Map<String, Int> =
    tago.lines.services.associate { service ->
        val shared =
            tago.lines.services
                .filter { it.group == service.group && it.id != service.id }
                .flatMap { it.stations }
                .toSet()
        val own = service.stations.filter { it !in shared && it !in service.joins }
        val seconds =
            requireNotNull(serviceHeadway(own.map { tago.timetable.getValue(it) })) {
                "No TAGO departures for ${service.id}"
            }
        require(seconds in TAGO_HEADWAY_RANGE) { "TAGO headway for ${service.id} outside supported range: $seconds" }
        service.id to seconds
    }

internal data class TagoEdgeResult(
    val seconds: Int,
    val json: JsonObject,
)

/**
 * Directed run time between consecutive TAGO stations [from] → [to] of [service]. A row heads towards [to] when its
 * terminus sits at or beyond [to] in the service order (termini resolved to physical stations, so another
 * operator's id for the same station counts); rows with an unknown terminus are kept for both directions.
 * Falls back to the reverse direction (mirrored) when one direction does not pass the match gate.
 */
internal fun tagoRunTimes(
    tago: TagoInput,
    service: MetroService,
    codes: Map<String, String>,
    from: String,
    to: String,
): TagoRun {
    val heading = TagoHeading(tago, service, codes)
    val i = service.stations.indexOf(from)
    val j = service.stations.indexOf(to)
    val rawForward = estimateRun(heading.rows(from, i, j), heading.rows(to, i, j))
    val rawReverse = estimateRun(heading.rows(to, j, i), heading.rows(from, j, i))
    val forward = rawForward?.takeIf(::acceptable)
    val reverse = rawReverse?.takeIf(::acceptable)
    if (forward == null && reverse == null) {
        return TagoRun(null, null, listOfNotNull(rawForward, rawReverse).map(::describe))
    }

    fun result(
        estimate: RunEstimate?,
        mirrored: Boolean,
    ) = estimate?.let {
        TagoEdgeResult(
            it.seconds,
            JsonObject(describe(it) + ("mirrored" to jsonValue(mirrored))),
        )
    }
    return TagoRun(result(forward, false) ?: result(reverse, true), result(reverse, false) ?: result(forward, true))
}

/** Rows of a station heading from position [origin] towards [target] of the service order, judged by terminus. */
private class TagoHeading(
    private val tago: TagoInput,
    private val service: MetroService,
    private val codes: Map<String, String>,
) {
    private val order = service.stations.map { codes.getValue(it) }

    private fun position(end: String?): Int? {
        val id = end ?: return null
        val own = service.stations.indexOf(id)
        if (own >= 0) return own
        return codes[id]?.let { order.indexOf(it) }?.takeIf { it >= 0 }
    }

    fun rows(
        station: String,
        origin: Int,
        target: Int,
    ): List<TagoTrain> =
        tago.timetable.getValue(station).values.flatten().filter { train ->
            val p = position(train.end) ?: return@filter true
            if (target > origin) p >= target else p <= target
        }
}

internal data class TagoRun(
    val forward: TagoEdgeResult?,
    val reverse: TagoEdgeResult?,
    /** Raw estimates that failed the gate, for the report. */
    val rejected: List<JsonObject> = emptyList(),
)

private fun describe(it: RunEstimate): JsonObject =
    obj(
        "seconds" to it.seconds,
        "runSeconds" to it.runSeconds,
        "dwellSeconds" to it.dwellSeconds,
        "matched" to it.matched,
        "ratio" to (it.ratio * 1000).toInt() / 1000.0,
    )

private fun acceptable(estimate: RunEstimate): Boolean =
    estimate.matched >= MIN_MATCHED && estimate.ratio >= MIN_RATIO && estimate.seconds in RUN_RANGE

/**
 * Estimator check against an official source: Seoul Metro S3 adjacent times on lines whose TAGO timetables are
 * also cached (1·4호선 validation stations). Δ = TAGO estimate − S3 for both directions of every S3 row.
 */
internal fun tagoVersusS3(
    tago: TagoInput,
    runtime: List<List<String>>,
    rules: NetworkRules,
): JsonObject {
    val ids =
        tago.stations
            .filter { (id, value) -> id.startsWith("MTRS1") && id in tago.timetable && value.second.endsWith("호선") }
            .entries
            .associate { (id, value) -> (value.second.removeSuffix("호선") to rules.canonical(value.first)) to id }
    val rows =
        runtime.zipWithNext().mapNotNull { (previous, row) ->
            val seconds = duration(row[3])
            val line = row[1]
            val from = ids[line to rules.canonical(rules.predecessor(line, row[2], previous[2]))]
            val to = ids[line to rules.canonical(row[2])]
            if (seconds == 0 || previous[1] != line) return@mapNotNull null
            if (from == null || to == null) return@mapNotNull null
            val forward = estimateByCodes(tago.timetable.getValue(from), tago.timetable.getValue(to))
            val reverse = estimateByCodes(tago.timetable.getValue(to), tago.timetable.getValue(from))
            obj(
                "line" to line,
                "from" to rules.predecessor(line, row[2], previous[2]),
                "to" to row[2],
                "s3Seconds" to seconds,
                "forwardDelta" to forward?.let { it.seconds - seconds },
                "reverseDelta" to reverse?.let { it.seconds - seconds },
            )
        }
    val deltas =
        rows.flatMap { row ->
            listOf("forwardDelta", "reverseDelta").mapNotNull {
                (row[it] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull()
            }
        }
    return obj(
        "basis" to "S3(서울교통공사 역간 소요시간)와 같은 구간의 TAGO 시간표 추정값 비교. Δ = TAGO − S3 (초)",
        "pairs" to rows.size,
        "deltaSeconds" to distribution(deltas),
        "absDeltaSeconds" to distribution(deltas.map { kotlin.math.abs(it) }),
        "rows" to rows,
    )
}
