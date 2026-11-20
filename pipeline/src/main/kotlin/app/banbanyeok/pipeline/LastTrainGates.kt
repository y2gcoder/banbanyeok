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
    val samples = mutableMapOf<Pair<String, String>, MutableList<Int>>()
    truth.forEach { train ->
        train.stops.zipWithNext().filter { it.first.departure >= 0 }.forEach { (a, b) ->
            val adjacent = families.adjacent(train.group, a.code.substringAfter(':'), b.code.substringAfter(':'))
            if (adjacent) samples.getOrPut(a.code to b.code) { mutableListOf() }.add(b.key - a.departure)
        }
    }
    val hops = samples.mapValues { (_, values) -> values.sorted()[values.size / 2] }
    val rows =
        kept
            .filter { it.end != null }
            .groupBy(
                { id(it.group, it.code) },
                { LtRow(it.arrival, it.departure, id(it.group, requireNotNull(it.end))) },
            )
    val neighbours = hops.keys.groupBy({ it.first }, { it.second }).mapValues { it.value.sorted() }
    val chainer =
        LtChainer(rows, neighbours, hops) { station, end, next ->
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
): Int = base.latest.indices.count { wider.latest[it] > base.latest[it] || wider.direct[it] != base.direct[it] }

/** Cells whose content contradicts the search they came from (a direct train later than the best itinerary). */
internal fun ltInconsistentCells(result: LtDayResult): Int =
    result.latest.indices.count {
        result.direct[it] > result.latest[it] ||
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

/** Compares the samples with the computed direct trains; a sample passes when minute and destination match. */
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
        val result = results.getValue(sample.day)
        val cell = home * problem.meetings.size + meeting
        val direct = result.direct[cell].takeIf { it >= 0 }?.div(60)
        val bound = result.cells[cell].bound?.let(names::get)
        obj(
            "meeting" to sample.meeting,
            "home" to sample.home,
            "day" to sample.day.id,
            "family" to sample.family,
            "official" to sample.minute,
            "computed" to direct,
            "computedBound" to bound,
            "officialBound" to sample.bound,
            "passed" to (direct == sample.minute && (bound == null || bound == sample.bound)),
            "url" to sample.url,
            "checkedAt" to sample.checkedAt,
        )
    }
}
