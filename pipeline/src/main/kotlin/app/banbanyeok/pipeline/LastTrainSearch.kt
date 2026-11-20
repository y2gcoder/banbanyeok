package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainKind
import java.util.PriorityQueue

private const val SECONDS_PER_MINUTE = 60
private const val MARGIN_STEP_MINUTES = 10

/** The value a client shows for a margin kind: the minute floored to ten minutes. */
internal fun ltMarginShown(minute: Int): Int = minute - minute % MARGIN_STEP_MINUTES

/**
 * Trains of one night indexed for the backward search. A state is (physical station, line family): "the latest
 * time a rider can leave this station on a train of this family and still get home".
 */
internal class LtNight(
    val trains: List<LtTrain>,
) {
    private val stateIds = linkedMapOf<Pair<String, String>, Int>()
    private val arrivals = mutableListOf<MutableList<Triple<Int, Int, Int>>>()

    init {
        trains.forEachIndexed { t, train ->
            train.stops.forEachIndexed { i, stop ->
                val state = state(stop.code, train.group)
                if (stop.alights) arrivals[state].add(Triple(stop.arrival, t, i))
            }
        }
        arrivals.forEach { list -> list.sortWith(compareBy({ it.first }, { it.second }, { it.third })) }
    }

    private fun state(
        code: String,
        group: String,
    ): Int =
        stateIds.getOrPut(code to group) {
            arrivals.add(mutableListOf())
            arrivals.size - 1
        }

    val stateCount: Int get() = arrivals.size
    val stateKeys: List<Pair<String, String>> = stateIds.keys.toList()

    /** Family → state id, per physical station. */
    val statesAt: Map<String, List<Pair<String, Int>>> =
        stateIds.entries.groupBy({ it.key.first }, { it.key.second to it.value })

    fun stateOf(
        code: String,
        group: String,
    ): Int = stateIds.getValue(code to group)

    /** (platform time, train, stop) of every stop of a state's family at its station, in time order. */
    fun arrivalsAt(state: Int): List<Triple<Int, Int, Int>> = arrivals[state]
}

/**
 * Latest departure towards one home station from every state, by label setting from the largest value down. A stop
 * is activated when a rider arriving there can still get home; every earlier stop of that train is then a
 * candidate first boarding. Changing trains costs the allowance of that station and pair of families.
 */
private class LtBackward(
    private val night: LtNight,
    private val allowance: (code: String, from: String, to: String) -> Int,
    private val home: String,
) {
    val best = IntArray(night.stateCount) { -1 }
    private val scanned = IntArray(night.stateCount)
    private val reached = IntArray(night.trains.size)
    private val waiting = mutableMapOf<Int, MutableList<Int>>()
    private val queue = PriorityQueue<Pair<Int, Int>>(compareBy({ -it.first }, { it.second }))

    fun run(): IntArray {
        night.statesAt[home].orEmpty().forEach { (_, state) -> scan(state, LT_DAY_END) }
        while (queue.isNotEmpty()) {
            val (value, state) = queue.remove()
            if (best[state] != value) continue
            val (code, group) = night.stateKeys[state]
            night.statesAt.getValue(code).forEach { (from, other) -> scan(other, value - allowance(code, from, group)) }
        }
        return best
    }

    /** Activates the stops of [state] a rider reaches by [deadline] that were not activated before. */
    private fun scan(
        state: Int,
        deadline: Int,
    ) {
        val list = night.arrivalsAt(state)
        while (scanned[state] < list.size && list[scanned[state]].first <= deadline) {
            val (_, train, stop) = list[scanned[state]++]
            activate(train, stop)
        }
    }

    private fun activate(
        train: Int,
        stop: Int,
    ) {
        val late = waiting[train]
        late?.removeAll { board(train, it, stop) }
        for (earlier in reached[train] until stop) {
            if (!board(train, earlier, stop)) waiting.getOrPut(train) { mutableListOf() }.add(earlier)
        }
        reached[train] = maxOf(reached[train], stop)
    }

    /** True when boarding at [from] is settled: used with [to], or never usable. False to retry with a later stop. */
    private fun board(
        train: Int,
        from: Int,
        to: Int,
    ): Boolean {
        val run = night.trains[train]
        val origin = run.stops[from]
        val target = run.stops[to]
        if (!origin.boards || origin.boardBy < LT_BOARD_FROM || origin.code == home) return true
        if (from >= to || !ltRides(origin, target)) return false
        val state = night.stateOf(origin.code, run.group)
        if (origin.boardBy > best[state]) {
            best[state] = origin.boardBy
            queue.add(origin.boardBy to state)
        }
        return true
    }
}

/**
 * The latest train; among trains boarded at the same time a confirmed one, then the smaller destination code, so
 * the result does not depend on the order of the trains.
 */
internal val LT_DIRECT_ORDER =
    compareBy<LtDirect>({ -it.boardBy }, { !it.verified }, { it.bound }, { it.group }, { it.departure })

/** Latest single-train boarding per (home, meeting), with that train's destination and family. */
private fun ltDirect(
    trains: List<LtTrain>,
    homes: Map<String, Int>,
    meetings: Map<String, Int>,
): Map<Pair<Int, Int>, LtDirect> {
    val best = mutableMapOf<Pair<Int, Int>, LtDirect>()
    trains.forEach { train ->
        train.stops.forEachIndexed { to, target ->
            val home = homes[target.code] ?: return@forEachIndexed
            train.stops.subList(0, to).forEach { origin ->
                val meeting = meetings[origin.code]
                if (meeting != null && ltRides(origin, target)) {
                    val verified = origin.verified && target.verified
                    val found = LtDirect(origin.boardBy, origin.departure, train.bound, train.group, verified)
                    best.merge(home to meeting, found) { old, new -> minOf(old, new, LT_DIRECT_ORDER) }
                }
            }
        }
    }
    return best
}

/**
 * Classifies one cell. [latest] is the latest boarding by any itinerary and [direct] by one train (so
 * `latest >= direct`). The direct train is a confirmed one only when it is boarded and left at confirmed rows. A transfer itinerary wins only when what a client would show for it (floored to ten
 * minutes) is later than what it would show for the direct train.
 */
private fun ltCell(
    latest: Int,
    direct: LtDirect?,
): LtCell {
    if (latest < 0) return LtCell.UNKNOWN
    val minute = latest / SECONDS_PER_MINUTE
    if (direct == null) return LtCell(LastTrainKind.MARGIN_TRANSFER.raw, minute, null)
    val directMinute = direct.boardBy / SECONDS_PER_MINUTE
    val confirmed = direct.verified
    val directShown = if (confirmed) directMinute else ltMarginShown(directMinute)
    return when {
        ltMarginShown(minute) > directShown -> LtCell(LastTrainKind.MARGIN_TRANSFER.raw, minute, null)
        confirmed -> LtCell(LastTrainKind.DIRECT.raw, directMinute, direct.bound)
        else -> LtCell(LastTrainKind.MARGIN_DIRECT.raw, directMinute, direct.bound)
    }
}

/** Last trains of one day type for every (home, meeting) cell. */
internal fun ltDay(
    problem: LtProblem,
    trains: List<LtTrain>,
    allowance: LtAllowance = LtAllowance.DEFAULT,
): LtDayResult {
    val night = LtNight(trains)
    val homes = problem.homes.withIndex().associate { it.value to it.index }
    val meetings = problem.meetings.withIndex().associate { it.value to it.index }
    val direct = ltDirect(trains, homes, meetings)
    val width = problem.meetings.size
    val latestAll = IntArray(problem.homes.size * width) { -1 }
    val directAll = MutableList<LtDirect?>(problem.homes.size * width) { null }
    val cells = MutableList(problem.homes.size * width) { LtCell.UNKNOWN }
    val allow = { code: String, from: String, to: String -> allowance.seconds(problem.walks.seconds(code, from, to)) }
    problem.homes.forEachIndexed { h, home ->
        val best = LtBackward(night, allow, home).run()
        problem.meetings.forEachIndexed { m, meeting ->
            if (meeting != home) {
                val latest = night.statesAt[meeting].orEmpty().maxOfOrNull { best[it.second] } ?: -1
                val single = direct[h to m]
                latestAll[h * width + m] = latest
                directAll[h * width + m] = single
                cells[h * width + m] = ltCell(latest, single)
            }
        }
    }
    return LtDayResult(cells, latestAll, directAll)
}

/** What a client shows for a cell: the minute as it is for a confirmed direct train, floored for a margin kind. */
internal fun ltShown(cell: LtCell): Int =
    if (cell.kind ==
        LastTrainKind.DIRECT.raw
    ) {
        cell.minute
    } else {
        ltMarginShown(cell.minute)
    }

/**
 * The answer that holds whichever of two sources is the current timetable: per cell the one a client would show
 * earlier, and no time at all when either source finds no way. Evidence for the gates stays with [first].
 */
internal fun ltEarlier(
    first: LtDayResult,
    second: LtDayResult,
): LtDayResult {
    val cells =
        first.cells.indices.map { i ->
            val a = first.cells[i]
            val b = second.cells[i]
            when {
                a.kind == 0 || b.kind == 0 -> LtCell.UNKNOWN
                ltShown(b) < ltShown(a) || (ltShown(b) == ltShown(a) && b.minute < a.minute) -> b
                else -> a
            }
        }
    val latest =
        IntArray(first.latest.size) { i ->
            if (cells[i].kind ==
                0
            ) {
                -1
            } else {
                minOf(first.latest[i], second.latest[i])
            }
        }
    return LtDayResult(cells, latest, first.direct)
}

/** One day type's table from its rows: both sources where a family has a second one, the earlier answer kept. */
internal fun ltNight(
    problem: LtProblem,
    day: DayType,
    rows: LtDayRows,
    allowance: LtAllowance = LtAllowance.DEFAULT,
): LtDayResult {
    if (!problem.rebuild) {
        val proven = ltDay(problem, ltProvenTrains(problem, day, rows), allowance)
        return ltWithProvenDirect(problem, day, proven, ltRebuiltDirect(problem, day, rows))
    }
    val first = ltDay(problem, ltTrains(problem, day, rows), allowance)
    val second = ltSecondTrains(problem, day, rows) ?: return first
    return ltEarlier(first, ltDay(problem, second, allowance))
}

/**
 * The last single train of every cell among the trains rebuilt from unnumbered rows. With [LtProblem.rebuild] off
 * these never give a time by themselves: they are what the operator's timetable is compared with, cell by cell.
 */
internal fun ltRebuiltDirect(
    problem: LtProblem,
    day: DayType,
    rows: LtDayRows,
): List<LtDirect?> {
    val trains = ltUnnumberedTrains(problem, rows.unnumbered, { problem.margin(it, day) }, problem.exact[day].orEmpty())
    val homes = problem.homes.withIndex().associate { it.value to it.index }
    val meetings = problem.meetings.withIndex().associate { it.value to it.index }
    val direct = ltDirect(trains, homes, meetings)
    val width = problem.meetings.size
    return List(problem.homes.size * width) { direct[it / width to it % width] }
}

/**
 * The same result with, per cell, the later of its own last single train and the rebuilt one: what an operator's
 * sample is compared with. With rebuilding on [rebuilt] is empty and the result is returned as it is.
 */
internal fun ltComparable(
    result: LtDayResult,
    rebuilt: List<LtDirect?>,
): LtDayResult =
    if (rebuilt.isEmpty()) {
        result
    } else {
        val direct =
            result.direct.indices.map {
                listOfNotNull(
                    result.direct[it],
                    rebuilt[it],
                ).minWithOrNull(LT_DIRECT_ORDER)
            }
        LtDayResult(result.cells, result.latest, direct)
    }

/**
 * Adds the direct cells of [LtProblem.proven] to a table computed from train-numbered sources only. A proven cell
 * is added only when the rebuilt train for it ([rebuilt]) is of a family confirmed that day and leaves at the
 * minute and for the terminal the operator's timetable gives; then that departure is published as a confirmed
 * direct train. It is never used as a leg of a transfer: its arrival time is not in the operator's table.
 */
internal fun ltWithProvenDirect(
    problem: LtProblem,
    day: DayType,
    result: LtDayResult,
    rebuilt: List<LtDirect?>,
): LtDayResult {
    val cells = result.cells.toMutableList()
    val latest = result.latest.copyOf()
    val direct = result.direct.toMutableList()
    val width = problem.meetings.size
    problem.proven[day].orEmpty().forEach { ride ->
        val index = problem.homes.indexOf(ride.home) * width + problem.meetings.indexOf(ride.meeting)
        val train = rebuilt.getOrNull(index)?.takeIf { ride.family in problem.exact[day].orEmpty() } ?: return@forEach
        val same =
            train.group == ride.family && train.bound == ride.bound &&
                train.departure / SECONDS_PER_MINUTE == ride.minute
        if (!same || ride.home == ride.meeting) return@forEach
        val confirmed = LtDirect(train.departure, train.departure, train.bound, train.group, verified = true)
        val best = listOfNotNull(result.direct[index], confirmed).minWithOrNull(LT_DIRECT_ORDER)
        latest[index] = maxOf(latest[index], confirmed.boardBy)
        direct[index] = best
        cells[index] = ltCell(latest[index], best)
    }
    return LtDayResult(cells, latest, direct)
}
