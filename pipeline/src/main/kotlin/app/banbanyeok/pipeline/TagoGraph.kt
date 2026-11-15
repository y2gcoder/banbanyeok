package app.banbanyeok.pipeline

import app.banbanyeok.schema.TimeSlot
import kotlinx.serialization.json.JsonObject
import kotlin.math.sign

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

/**
 * Boarding headway of a TAGO service (branch: its exclusive stations; trunk: every non-join station) for one time
 * slot: the day type's timetable, departures inside the band window.
 */
internal fun tagoServiceHeadways(
    tago: TagoInput,
    slot: TimeSlot = TimeSlot.DEFAULT,
): Map<String, Int> =
    tago.lines.services.associate { service ->
        // A branch service waits for its own trains, counted where no other service of the group stops; a trunk
        // service counts every train of its section.
        val shared =
            tago.lines.services
                .filter { it.group == service.group && it.id != service.id && !service.trunk }
                .flatMap { it.stations }
                .toSet()
        val own = service.stations.filter { it !in shared && it !in service.joins }
        val timetable = requireNotNull(tago.timetables[slot.day]) { "TAGO ${slot.day.id} timetable not cached" }
        val seconds =
            requireNotNull(serviceHeadway(own.map { timetable.getValue(it) }, slot.band.window)) {
                "No TAGO departures for ${service.id} ($slot)"
            }
        require(seconds in TAGO_HEADWAY_RANGE) {
            "TAGO headway for ${service.id} ($slot) outside supported range: $seconds"
        }
        service.id to seconds
    }

internal data class TagoEdgeResult(
    val seconds: Int,
    val json: JsonObject,
)

/** A run more than this many times its reverse (and [ASYMMETRY_MIN_GAP] s longer) is a headway alias. */
internal const val ASYMMETRY_FACTOR = 2
internal const val ASYMMETRY_MIN_GAP = 120

/**
 * Directed run time between consecutive TAGO stations [from] → [to] of [heading]'s service. Rows are split by
 * direction with [TagoHeading]. Falls back to the reverse direction (mirrored) when one direction does not pass
 * the match gate. When both pass but one is over [ASYMMETRY_FACTOR]× the other, the longer one is a headway
 * alias of mis-split rows (별내선 north, whose termini all read 구리): the shorter value is used both ways and
 * the edge is flagged `asymmetryCorrected` in the report.
 */
internal fun tagoRunTimes(
    heading: TagoHeading,
    from: String,
    to: String,
): TagoRun {
    val i = heading.service.stations.indexOf(from)
    val j = heading.service.stations.indexOf(to)
    val dwell = heading.ordinaryDwell
    val rawForward = estimateRun(heading.rows(from, i, j), heading.rows(to, i, j), dwell)
    val rawReverse = estimateRun(heading.rows(to, j, i), heading.rows(from, j, i), dwell)
    var forward = rawForward?.takeIf(::acceptable)
    var reverse = rawReverse?.takeIf(::acceptable)
    if (forward == null && reverse == null) {
        return TagoRun(null, null, listOfNotNull(rawForward, rawReverse).map(::describe))
    }
    val corrected = asymmetric(forward, reverse)
    if (corrected) {
        val shorter = minOf(requireNotNull(forward), requireNotNull(reverse), compareBy { it.seconds })
        if (forward.seconds > shorter.seconds) forward = null
        if (reverse.seconds > shorter.seconds) reverse = null
    }

    fun result(
        estimate: RunEstimate?,
        mirrored: Boolean,
    ) = estimate?.let {
        TagoEdgeResult(
            it.seconds,
            JsonObject(
                describe(it) + ("mirrored" to jsonValue(mirrored)) + ("asymmetryCorrected" to jsonValue(corrected)),
            ),
        )
    }
    val rejected = if (corrected) listOfNotNull(rawForward, rawReverse).map(::describe) else emptyList()
    return TagoRun(
        result(forward, false) ?: result(reverse, true),
        result(reverse, false) ?: result(forward, true),
        rejected,
    )
}

internal fun asymmetric(
    a: RunEstimate?,
    b: RunEstimate?,
): Boolean {
    if (a == null || b == null) return false
    val (short, long) = listOf(a.seconds, b.seconds).sorted()
    return long > short * ASYMMETRY_FACTOR && long - short > ASYMMETRY_MIN_GAP
}

/**
 * Splits a service's timetable rows by direction. A row's terminus (endSubwayStationId) decides when it is
 * trustworthy; a terminus that the same U/D code claims at stations on both sides of it (별내선: every U row from
 * 별내 to 암사역사공원 "ends" at 구리) is a data error and is ignored. Rows without a usable terminus fall back
 * to the direction of their U/D code, learnt from the trustworthy rows or, failing that, from the service's end
 * stations (a code that only arrives at the first station runs towards it). Unknown rows stay in both directions.
 */
internal class TagoHeading(
    private val tago: TagoInput,
    val service: MetroService,
    private val codes: Map<String, String>,
) {
    private val order = service.stations.map { codes.getValue(it) }

    private fun position(end: String?): Int? {
        val id = end ?: return null
        val own = service.stations.indexOf(id)
        if (own >= 0) return own
        return codes[id]?.let { order.indexOf(it) }?.takeIf { it >= 0 }
    }

    private val rowsByCode: Map<String, List<Pair<Int, TagoTrain>>> =
        service.stations
            .flatMapIndexed { index, id ->
                tago.timetable.getValue(id).flatMap { (code, trains) -> trains.map { code to (index to it) } }
            }.groupBy({ it.first }, { it.second })

    /** (code, terminus) pairs claimed by a majority of a station's rows on both sides of that terminus. */
    val bogusTermini: Set<Pair<String, String>> =
        rowsByCode
            .flatMap { (code, rows) ->
                rows
                    .groupBy { it.first }
                    .flatMap { (station, here) ->
                        here
                            .groupingBy { it.second.end }
                            .eachCount()
                            .filter { (end, count) -> end != null && count * 2 >= here.size }
                            .keys
                            .mapNotNull { end ->
                                position(end)?.let { Triple(code, requireNotNull(end), it - station) }
                            }
                    }.groupBy({ it.first to it.second }, { it.third })
                    .filterValues { sides -> sides.any { it > 0 } && sides.any { it < 0 } }
                    .keys
            }.toSet()

    private fun trusted(
        code: String,
        train: TagoTrain,
    ): Int? = train.end?.takeIf { (code to it) !in bogusTermini }?.let(::position)

    /** +1: code runs towards higher service positions, −1: lower, 0: mixed or unknown. */
    val codeDirections: Map<String, Int> =
        rowsByCode
            .mapValues { (code, rows) ->
                votedDirection(code, rows) ?: endStationDirection(rows) ?: 0
            }.let { known ->
                known.mapValues { (code, direction) ->
                    if (direction != 0) direction else -(known.filterKeys { it != code }.values.singleOrNull() ?: 0)
                }
            }

    private fun votedDirection(
        code: String,
        rows: List<Pair<Int, TagoTrain>>,
    ): Int? {
        val votes =
            rows.mapNotNull { (station, train) -> trusted(code, train)?.let { (it - station).sign } }.filter {
                it !=
                    0
            }
        if (votes.size < MIN_VOTES) return null
        val up = votes.count { it > 0 }
        return when {
            up * VOTE_SHARE_DIVISOR >= votes.size * VOTE_SHARE -> 1
            (votes.size - up) * VOTE_SHARE_DIVISOR >= votes.size * VOTE_SHARE -> -1
            else -> 0
        }
    }

    private fun endStationDirection(rows: List<Pair<Int, TagoTrain>>): Int? {
        val last = service.stations.lastIndex
        val first = rows.filter { it.first == 0 }.map { it.second }
        val end = rows.filter { it.first == last }.map { it.second }
        return when {
            first.isNotEmpty() && first.all { it.departure == null } -> -1
            first.isNotEmpty() && first.all { it.arrival == null } -> 1
            end.isNotEmpty() && end.all { it.departure == null } -> 1
            end.isNotEmpty() && end.all { it.arrival == null } -> -1
            else -> null
        }
    }

    /** Ordinary dwell of the service, used where a station's own through trains are too few. */
    val ordinaryDwell: Int? = ordinaryDwell(service.stations.flatMap { tago.timetable.getValue(it).values })

    fun rows(
        station: String,
        origin: Int,
        target: Int,
    ): List<TagoTrain> {
        val way = (target - origin).sign
        return tago.timetable.getValue(station).flatMap { (code, trains) ->
            trains.filter { train ->
                val p = trusted(code, train)
                val direction = codeDirections[code] ?: 0
                when {
                    p != null -> if (way > 0) p >= target else p <= target
                    direction != 0 -> direction == way
                    else -> true
                }
            }
        }
    }
}

private const val MIN_VOTES = 10
private const val VOTE_SHARE = 8
private const val VOTE_SHARE_DIVISOR = 10

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
    val dwell = rules.s3DwellSeconds
    return obj(
        "basis" to
            "S3(서울교통공사 역간 소요시간)와 같은 구간의 TAGO 시간표 추정값 비교. Δ = TAGO − S3 원값(초), " +
            "deltaAfterDwell = TAGO − (S3 + 그래프가 더하는 정차 ${dwell}초)",
        "pairs" to rows.size,
        "deltaSeconds" to distribution(deltas),
        "absDeltaSeconds" to distribution(deltas.map { kotlin.math.abs(it) }),
        "deltaAfterDwellSeconds" to distribution(deltas.map { it - dwell }),
        "absDeltaAfterDwellSeconds" to distribution(deltas.map { kotlin.math.abs(it - dwell) }),
        "rows" to rows,
    )
}
