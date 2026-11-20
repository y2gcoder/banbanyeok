package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.Station
import kotlinx.serialization.json.JsonObject

// Gates that must pass before a last-train table is published. All of them guard one property: a published time
// may be earlier than the real last train, never later.

/** Latest single-train departure per (boarding station, alighting station) over [trains]. */
private fun ltPairs(trains: List<LtTrain>): Map<Pair<String, String>, Int> {
    val best = mutableMapOf<Pair<String, String>, Int>()
    trains.forEach { train ->
        train.stops.forEachIndexed { to, target ->
            train.stops.subList(0, to).forEach { origin ->
                if (ltRides(origin, target)) best.merge(origin.code to target.code, origin.departure, ::maxOf)
            }
        }
    }
    return best
}

/** Outcome of rebuilding numbered trains with their numbers hidden. [late] and [phantom] must be 0. */
internal data class LtHiddenCheck(
    val pairs: Int,
    val same: Int,
    /** Pairs whose rebuilt last direct train is later than the true one. */
    val late: Int,
    /** Pairs the rebuilt chains serve directly although no real train does. */
    val phantom: Int,
    val early: Int,
    val missing: Int,
) {
    val passed: Boolean get() = late == 0 && phantom == 0

    val json: JsonObject
        get() =
            obj(
                "pairs" to pairs,
                "same" to same,
                "late" to late,
                "phantom" to phantom,
                "early" to early,
                "missing" to missing,
            )
}

/** Median departure-to-departure and departure-to-arrival seconds between adjacent stations of the true trains. */
private fun medianHops(
    families: LtFamilies,
    truth: List<LtTrain>,
): Pair<Map<Pair<String, String>, Int>, Map<Pair<String, String>, Int>> {
    val samples = mutableMapOf<Pair<String, String>, MutableList<Int>>()
    val runSamples = mutableMapOf<Pair<String, String>, MutableList<Int>>()
    truth.forEach { train ->
        train.stops.zipWithNext().filter { it.first.departure >= 0 }.forEach { (a, b) ->
            val adjacent = families.adjacent(train.group, a.code.substringAfter(':'), b.code.substringAfter(':'))
            if (adjacent) samples.getOrPut(a.code to b.code) { mutableListOf() }.add(b.key - a.departure)
            if (adjacent && b.arrival >= 0) {
                runSamples.getOrPut(a.code to b.code) { mutableListOf() }.add(b.arrival - a.departure)
            }
        }
    }
    val hops = samples.mapValues { (_, values) -> values.sorted()[values.size / 2] }
    return hops to hops.mapValues { (pair, hop) -> runSamples[pair]?.let { it.sorted()[it.size / 2] } ?: hop }
}

/**
 * Scores the chain matching on lines that do have train numbers: the numbers are hidden, trains are rebuilt from
 * (station, terminal, times) alone exactly as for the unnumbered lines, and the last direct train of every
 * station pair is compared with the truth. Hop times are the median of the true hops (the D1 edge estimator is
 * validated separately). [skip] lists loop lines: both directions of a loop share a terminal, so they are never
 * rebuilt this way (no unnumbered line is a loop).
 */
internal fun ltHiddenNumbers(
    families: LtFamilies,
    stops: List<LtNumberedStop>,
    skip: Set<String>,
): LtHiddenCheck {
    fun id(
        group: String,
        code: String,
    ) = "$group:$code"
    val kept = stops.filter { it.group !in skip }
    val truth =
        ltNumberedTrains(kept.map { it.copy(code = id(it.group, it.code)) })
    val (hops, runs) = medianHops(families, truth)
    val rows =
        kept
            .filter { it.end != null }
            .groupBy(
                { id(it.group, it.code) },
                { LtRow(it.arrival, it.departure, id(it.group, requireNotNull(it.end))) },
            )
    val neighbours = hops.keys.groupBy({ it.first }, { it.second }).mapValues { it.value.sorted() }
    val chainer =
        LtChainer(rows, neighbours, hops, runs) { station, end, next ->
            families.closer(
                station.substringBefore(':'),
                station.substringAfter(':'),
                next.substringAfter(':'),
                end.substringAfter(':'),
            )
        }
    val rebuilt =
        ltChains(chainer.links()).map { chain ->
            LtTrain(
                "",
                null,
                chain.mapIndexed { index, ref ->
                    val row = chainer.rows.getValue(ref.station)[ref.index]
                    LtStop(
                        ref.station,
                        row.arrival,
                        row.departure,
                        index == 0 && row.arrival < 0 && chainer.startsRun(ref),
                    )
                },
            )
        }
    val want = ltPairs(truth)
    val got = ltPairs(rebuilt)
    return LtHiddenCheck(
        pairs = want.size,
        same = want.count { got[it.key] == it.value },
        late = got.count { (pair, value) -> (want[pair] ?: Int.MAX_VALUE) < value },
        phantom = got.keys.count { it !in want },
        early = want.count { (pair, value) -> (got[pair] ?: Int.MAX_VALUE) < value },
        missing = want.keys.count { it !in got },
    )
}

/** Cells of [wider] (computed with a larger transfer allowance) that are later than in [base]. Must be 0. */
internal fun ltLaterCells(
    base: LtDayResult,
    wider: LtDayResult,
): Int =
    base.latest.indices.count {
        wider.latest[it] > base.latest[it] || wider.direct[it]?.boardBy != base.direct[it]?.boardBy
    }

/** Cells whose content contradicts the search they came from (a direct train later than the best itinerary). */
internal fun ltInconsistentCells(result: LtDayResult): Int =
    result.latest.indices.count {
        (result.direct[it]?.boardBy ?: -1) > result.latest[it] ||
            (result.latest[it] < 0) != (result.cells[it].kind == 0)
    }

private const val BOUND_RIDE_SHARE = 0.6
private const val BOUND_SLACK = 300

/**
 * A coarse check that does not use the rebuilt trains' routes at all: leaving the meeting station at the published
 * time and riding for a share of the travel graph's shortest riding time, with no waiting, cannot end after the
 * last train of the night reaches the home station. A wrong direction or a train invented across lines breaks
 * this by a wide margin. The share is low because the graph times are all-stop times and an express covers the
 * same stretch in about two thirds of them (line 9: 0.68), so this does not replace the stop rules of [LtStop].
 */
internal class LtArrivalBound(
    net: Network,
    private val problem: LtProblem,
) {
    private val nodesOf = net.nodes.indices.groupBy { net.nodes[it].first }
    private val rideOnly =
        net.graph.map { edges ->
            edges.map { if (it.wait == null) it else it.copy(seconds = it.seconds - net.waits.getValue(it.wait)) }
        }

    /** Shortest riding + walking seconds from each meeting station to each home station, home-major. */
    private val ride: IntArray =
        IntArray(problem.homes.size * problem.meetings.size).also { out ->
            problem.meetings.forEachIndexed { m, meeting ->
                val costs = shortest(rideOnly, nodesOf.getValue(meeting).associateWith { 0 })
                problem.homes.forEachIndexed { h, home ->
                    out[h * problem.meetings.size + m] = nodesOf.getValue(home).minOf { costs[it].seconds }
                }
            }
        }

    fun violations(
        result: LtDayResult,
        trains: List<LtTrain>,
    ): Int {
        val lastArrival = mutableMapOf<String, Int>()
        trains.forEach { train ->
            train.stops.filter { it.alights }.forEach { lastArrival.merge(it.code, it.arrival, ::maxOf) }
        }
        val width = problem.meetings.size
        return result.latest.indices.count { cell ->
            val latest = result.latest[cell]
            val arrival = lastArrival[problem.homes[cell / width]] ?: -1
            latest >= 0 && latest + (ride[cell] * BOUND_RIDE_SHARE).toInt() - BOUND_SLACK > arrival
        }
    }
}

/** One row of data/config/last-train-official.csv: a last direct train read from the operator's own timetable. */
internal data class LtOfficialSample(
    val meeting: String,
    val home: String,
    val day: DayType,
    /** Minute of the service day as the operator publishes it. */
    val minute: Int,
    val bound: String,
    val family: String,
    val url: String,
    val checkedAt: String,
)

internal fun ltOfficialSamples(text: String): List<LtOfficialSample> =
    csv(text).drop(1).filter { it.any(String::isNotBlank) }.map { row ->
        require(row.size == 8) { "last-train-official.csv: meeting,home,day,time,bound,family,url,checkedAt" }
        val (hour, minute) = row[3].split(':').map(String::toInt)
        require(hour in 20..26 && minute in 0..59) { "last-train-official.csv: time ${row[3]} must be 20:00–26:59" }
        LtOfficialSample(
            row[0],
            row[1],
            requireNotNull(DayType.entries.firstOrNull { it.id == row[2] }) { "Unknown day type ${row[2]}" },
            hour * 60 + minute,
            row[4],
            row[5],
            row[6].also { require(it.startsWith("https://")) { "last-train-official.csv: source URL required" } },
            row[7],
        )
    }

/**
 * Compares the samples with the last single train of each cell. A sample passes only when the departure minute,
 * the train's destination **and its line family** all match: a sample cannot vouch for another family, and a cell
 * where no single train runs never passes.
 */
internal fun ltOfficialReport(
    samples: List<LtOfficialSample>,
    problem: LtProblem,
    origins: List<Station>,
    results: Map<DayType, LtDayResult>,
): List<JsonObject> {
    val names = origins.associate { it.code to it.name }
    return samples.map { sample ->
        val home = problem.homes.indexOf(stationNamed(origins, sample.home).code)
        val meeting = problem.meetings.indexOf(stationNamed(origins, sample.meeting).code)
        require(home >= 0 && meeting >= 0) { "Official sample ${sample.meeting}→${sample.home} is outside the axes" }
        val direct = results.getValue(sample.day).direct[home * problem.meetings.size + meeting]
        val minute = direct?.departure?.div(60)
        val bound = direct?.bound?.let(names::get)
        val family = direct?.group
        obj(
            "meeting" to sample.meeting,
            "home" to sample.home,
            "day" to sample.day.id,
            "family" to sample.family,
            "official" to sample.minute,
            "computed" to minute,
            "computedFamily" to family,
            "computedBound" to bound,
            "officialBound" to sample.bound,
            "passed" to (minute == sample.minute && bound == sample.bound && family == sample.family),
            "url" to sample.url,
            "checkedAt" to sample.checkedAt,
        )
    }
}

/** One row of data/config/last-train-ceilings.csv: a cell that must never show a time later than the operator's. */
internal data class LtCeiling(
    val meeting: String,
    val home: String,
    val day: DayType,
    val notAfter: Int,
    val url: String,
    val checkedAt: String,
)

internal fun ltCeilings(text: String): List<LtCeiling> =
    csv(text).drop(1).filter { it.any(String::isNotBlank) }.map { row ->
        require(row.size == 7) { "last-train-ceilings.csv: meeting,home,day,notAfter,url,checkedAt,note" }
        val (hour, minute) = row[3].split(':').map(String::toInt)
        LtCeiling(
            row[0],
            row[1],
            requireNotNull(DayType.entries.firstOrNull { it.id == row[2] }) { "Unknown day type ${row[2]}" },
            hour * 60 + minute,
            row[4].also { require(it.startsWith("https://")) { "last-train-ceilings.csv: source URL required" } },
            row[5],
        )
    }

/** What each ceiling cell shows (floored for margin kinds); it passes when that is not later than the ceiling. */
internal fun ltCeilingReport(
    ceilings: List<LtCeiling>,
    problem: LtProblem,
    origins: List<Station>,
    results: Map<DayType, LtDayResult>,
): List<JsonObject> =
    ceilings.map { ceiling ->
        val home = problem.homes.indexOf(stationNamed(origins, ceiling.home).code)
        val meeting = problem.meetings.indexOf(stationNamed(origins, ceiling.meeting).code)
        require(home >= 0 && meeting >= 0) { "Ceiling ${ceiling.meeting}→${ceiling.home} is outside the axes" }
        val cell = results.getValue(ceiling.day).cells[home * problem.meetings.size + meeting]
        val shown = cell.takeIf { it.kind != 0 }?.let(::ltShown)
        obj(
            "meeting" to ceiling.meeting,
            "home" to ceiling.home,
            "day" to ceiling.day.id,
            "notAfter" to ceiling.notAfter,
            "shown" to shown,
            "passed" to (shown == null || shown <= ceiling.notAfter),
            "url" to ceiling.url,
            "checkedAt" to ceiling.checkedAt,
        )
    }

/** Last direct trains of one line family in our trains against the operator's train-coded file, pair by pair. */
internal data class LtCrossCheck(
    val pairs: Int,
    val same: Int,
    /** Pairs where ours is later than the operator's, and by how many seconds at most. */
    val later: Int,
    val maxLaterSeconds: Int,
    val earlier: Int,
    val onlyOurs: Int,
    val onlyOfficial: Int,
) {
    /**
     * Every pair we publish has the same last direct train in the operator's file (so none is later, earlier or ours
     * alone), and there is something to compare. Only then are the line's direct trains published to the minute.
     */
    val identical: Boolean get() = pairs > 0 && same == pairs

    val json: JsonObject
        get() =
            obj(
                "pairs" to pairs,
                "same" to same,
                "later" to later,
                "maxLaterSeconds" to maxLaterSeconds,
                "earlier" to earlier,
                "onlyOurs" to onlyOurs,
                "onlyOfficial" to onlyOfficial,
            )
}

/** [ours] and [official] are trains of the same line family and day type. Source margins are not applied. */
internal fun ltCrossCheck(
    ours: List<LtTrain>,
    official: List<LtTrain>,
): LtCrossCheck {
    fun raw(trains: List<LtTrain>) =
        ltPairs(trains.map { train -> LtTrain(train.group, train.end, train.stops.map { it.copy(margin = 0) }) })
    val mine = raw(ours)
    val theirs = raw(official)
    val late = mine.mapNotNull { (pair, value) -> theirs[pair]?.let { value - it }?.takeIf { it > 0 } }
    return LtCrossCheck(
        pairs = mine.size,
        same = mine.count { theirs[it.key] == it.value },
        later = late.size,
        maxLaterSeconds = late.maxOrNull() ?: 0,
        earlier = mine.count { (pair, value) -> (theirs[pair] ?: Int.MIN_VALUE) > value },
        onlyOurs = mine.keys.count { it !in theirs },
        onlyOfficial = theirs.keys.count { it !in mine },
    )
}
