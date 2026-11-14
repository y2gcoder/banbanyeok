package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject

internal const val MIN_MATCHED = 3
internal const val MIN_RATIO = 0.5
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
 * Directed run time between consecutive TAGO stations. Falls back to the reverse direction (mirrored) when one
 * direction does not pass the match gate; returns null when neither does.
 */
internal fun tagoRunTimes(
    tago: TagoInput,
    from: String,
    to: String,
): Pair<TagoEdgeResult?, TagoEdgeResult?> {
    val forward = estimateRun(tago.timetable.getValue(from), tago.timetable.getValue(to))?.takeIf(::acceptable)
    val reverse = estimateRun(tago.timetable.getValue(to), tago.timetable.getValue(from))?.takeIf(::acceptable)

    fun result(
        estimate: RunEstimate?,
        mirrored: Boolean,
    ) = estimate?.let {
        TagoEdgeResult(
            it.seconds,
            obj(
                "seconds" to it.seconds,
                "runSeconds" to it.runSeconds,
                "dwellSeconds" to it.dwellSeconds,
                "matched" to it.matched,
                "ratio" to (it.ratio * 1000).toInt() / 1000.0,
                "directions" to "${it.fromDirection}>${it.toDirection}",
                "mirrored" to mirrored,
            ),
        )
    }
    return (result(forward, false) ?: result(reverse, true)) to (result(reverse, false) ?: result(forward, true))
}

private fun acceptable(estimate: RunEstimate): Boolean =
    estimate.matched >= MIN_MATCHED && estimate.ratio >= MIN_RATIO && estimate.seconds in RUN_RANGE
