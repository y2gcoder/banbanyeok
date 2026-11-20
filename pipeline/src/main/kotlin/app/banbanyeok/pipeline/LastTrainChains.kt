package app.banbanyeok.pipeline

/** A row of an unnumbered station: station id and index in that station's sorted rows. */
internal data class LtRef(
    val station: String,
    val index: Int,
)

private data class LtMatch(
    val gap: Int,
    val next: String,
    val index: Int,
)

/**
 * Rebuilds trains from station rows that carry no train number: a row is linked to the row of the same train at
 * the next station when that row names the same terminal and sits at the expected time (± [LT_TOLERANCE]).
 *
 * - The expected time is an **arrival** when the next row has one (departure + run time), and a departure only
 *   for rows without an arrival (a passing train). A train that waits at a station to be overtaken leaves late
 *   but still arrives on time, so it is matched by its arrival, not confused with the train overtaking it.
 * - A row at the next station that is not later than this row's departure is never the same train.
 * - Only neighbours on the terminal's side are tried ([allowed]); among them the neighbour that most rows of
 *   the same (station, terminal) match wins.
 * - **A link is made only when it is the only one possible**: the row has exactly one candidate within the
 *   tolerance, and no other row has that candidate within the tolerance. How much nearer one candidate is than
 *   another says nothing: a train that starts at the next station can sit exactly where a passing express was
 *   expected, with the express itself a minute off.
 * - **A row without an arrival may be where another train starts its run**, not this train passing. Such a row
 *   is linked to only when nothing else to the same terminal is at that station within [LT_ORIGIN_WINDOW] of the
 *   expected time, and no other row could claim it within that window either.
 *
 * A link that is not made loses rides (the answer gets earlier or disappears); it never invents one.
 */
internal class LtChainer(
    rows: Map<String, List<LtRow>>,
    private val neighbours: Map<String, List<String>>,
    private val hops: Map<Pair<String, String>, Int>,
    private val runs: Map<Pair<String, String>, Int>,
    private val allowed: (station: String, end: String, next: String) -> Boolean,
) {
    /** Station id → distinct rows of the night in time order. Links refer to these lists. */
    val rows: Map<String, List<LtRow>> =
        rows.toSortedMap().mapValues { (_, list) ->
            list
                .filter { it.end.isNotEmpty() && it.key in LT_CHAIN_FROM until LT_DAY_END }
                .distinct()
                .sortedWith(compareBy({ it.key }, { it.arrival }, { it.departure }, { it.end }))
        }

    /** Station id → terminal → row indexes. */
    private val byEnd: Map<String, Map<String, List<Int>>> =
        this.rows.mapValues { (_, list) -> list.indices.groupBy { list[it].end } }

    /** How far the candidate row is from where this train would be, or null when it is nowhere near or not later. */
    private fun gap(
        row: LtRow,
        candidate: LtRow,
        hop: Int,
        run: Int,
    ): Int? {
        val stops = candidate.arrival >= 0
        val actual = if (stops) candidate.arrival else candidate.departure
        val expected = row.departure + if (stops) run else hop
        return kotlin.math.abs(actual - expected).takeIf { actual > row.departure && it <= LT_ORIGIN_WINDOW }
    }

    /**
     * Rows at [next] that could be this train, nearest first: every row to the same terminal within
     * [LT_ORIGIN_WINDOW] of where the train would be. Those within [LT_TOLERANCE] are its candidates.
     */
    private fun near(
        from: String,
        row: LtRow,
        next: String,
    ): List<LtMatch> {
        val hop = hops[from to next] ?: return emptyList()
        val run = runs[from to next] ?: return emptyList()
        val list = rows[next] ?: return emptyList()
        return byEnd[next]
            ?.get(row.end)
            .orEmpty()
            .mapNotNull { index -> gap(row, list[index], hop, run)?.let { LtMatch(it, next, index) } }
            .sortedWith(compareBy({ it.gap }, { it.index }))
    }

    private val previous: Map<String, List<String>> =
        hops.keys.groupBy({ it.second }, { it.first }).mapValues { it.value.sorted() }

    /**
     * Whether a chain's first row is where the train starts its run. A row with an arrival is a stop either way.
     * One without is a start only if no train to the same terminal is at a previous station around the time this
     * one would have left it ([LT_ORIGIN_WINDOW]); otherwise it is treated as a train passing through.
     */
    fun startsRun(head: LtRef): Boolean {
        val row = rows.getValue(head.station)[head.index]
        return previous[head.station].orEmpty().filter { allowed(it, row.end, head.station) }.none { before ->
            val expected = row.departure - hops.getValue(before to head.station)
            val list = rows.getValue(before)
            byEnd[before]?.get(row.end).orEmpty().any { index ->
                list[index].departure >= 0 && kotlin.math.abs(list[index].departure - expected) <= LT_ORIGIN_WINDOW
            }
        }
    }

    /** Every departing row's nearby rows at each allowed neighbour, in (station, row) order. */
    private fun nearby(): Map<LtRef, List<LtMatch>> {
        val found = linkedMapOf<LtRef, List<LtMatch>>()
        rows.forEach { (station, list) ->
            list.forEachIndexed { index, row ->
                if (row.departure >= 0) {
                    found[LtRef(station, index)] =
                        neighbours[station]
                            .orEmpty()
                            .filter { allowed(station, row.end, it) }
                            .flatMap { near(station, row, it) }
                }
            }
        }
        return found
    }

    private fun passes(match: LtMatch) = rows.getValue(match.next)[match.index].arrival < 0

    /** Row → the row of the same train at the next station. */
    fun links(): Map<LtRef, LtRef> {
        val found = nearby()
        val votes = mutableMapOf<Pair<String, String>, MutableMap<String, Int>>()
        found.forEach { (ref, list) ->
            val key = ref.station to rows.getValue(ref.station)[ref.index].end
            list.filter { it.gap <= LT_TOLERANCE }.map { it.next }.distinct().forEach {
                votes.getOrPut(key) { sortedMapOf() }.merge(it, 1, Int::plus)
            }
        }
        // Per row: the rows near it at the neighbour most rows of its (station, terminal) agree on.
        val sided =
            found.mapValues { (ref, list) ->
                val key = ref.station to rows.getValue(ref.station)[ref.index].end
                // On a tie the smaller id (the map is sorted).
                val side = votes[key]?.entries?.maxByOrNull { it.value }?.key
                list.filter { it.next == side }
            }
        // Rows each row could be the continuation of: how many could claim it within the tolerance, and at all.
        val close = mutableMapOf<LtRef, Int>()
        val wide = mutableMapOf<LtRef, Int>()
        sided.values.forEach { list ->
            list.forEach { match ->
                val target = LtRef(match.next, match.index)
                wide.merge(target, 1, Int::plus)
                if (match.gap <= LT_TOLERANCE) close.merge(target, 1, Int::plus)
            }
        }
        val forward = mutableMapOf<LtRef, LtRef>()
        sided.forEach { (ref, list) ->
            val candidates = list.filter { it.gap <= LT_TOLERANCE }
            val only = candidates.singleOrNull() ?: return@forEach
            val target = LtRef(only.next, only.index)
            // A candidate without an arrival may be another train's start: nothing else may be near at all.
            val contested = passes(only) && (list.size > 1 || wide[target] != 1)
            if (close[target] == 1 && !contested) forward[ref] = target
        }
        return forward
    }
}

/** Follows [links] from every row that nothing links to, in (station, row) order. Each list has two rows or more. */
internal fun ltChains(links: Map<LtRef, LtRef>): List<List<LtRef>> {
    val targets = links.values.toSet()
    return links.keys
        .filter { it !in targets }
        .sortedWith(compareBy({ it.station }, { it.index }))
        .map { head -> generateSequence(head) { links[it] }.toList() }
}

/** Trains of the unnumbered lines: rebuilt chains turned into stops at physical stations. */
internal fun ltUnnumberedTrains(
    problem: LtProblem,
    rows: Map<String, List<LtRow>>,
    /** Seconds before departure a rider must be on the platform, per line family (the source margin). */
    margin: (family: String) -> Int = { 0 },
    /** Families confirmed against the operator's timetable that day type. */
    verified: Set<String> = emptySet(),
): List<LtTrain> {
    val known = rows.filterKeys { it in problem.stations }
    val neighbours =
        problem.hops.keys
            .groupBy({ it.first }, { it.second })
            .mapValues { it.value.sorted() }
    val chainer =
        LtChainer(known, neighbours, problem.hops, problem.runs) { station, end, next ->
            val here = problem.stations.getValue(station)
            val there = problem.stations[next] ?: return@LtChainer false
            problem.families.closer(here.group, here.code, there.code, problem.stations[end]?.code)
        }
    return ltChains(chainer.links()).map { chain ->
        val head = chain.first()
        val first = chainer.rows.getValue(head.station)[head.index]
        val family = problem.stations.getValue(head.station).group
        LtTrain(
            family,
            problem.stations[first.end]?.code,
            chain.mapIndexed { index, ref ->
                val row = chainer.rows.getValue(ref.station)[ref.index]
                val origin = index == 0 && row.arrival < 0 && chainer.startsRun(ref)
                LtStop(
                    problem.stations.getValue(ref.station).code,
                    row.arrival,
                    row.departure,
                    origin,
                    margin(family),
                    family in verified,
                )
            },
        )
    }
}

private val stopOrder = compareBy<LtStop>({ it.key }, { it.code })

/**
 * Trains of the numbered lines: stops of one train number in time order; trains in train-id order. Rows of the
 * lines in [verified] are confirmed rows; rows of every other line are boarded [margin] seconds early.
 */
internal fun ltNumberedTrains(
    stops: List<LtNumberedStop>,
    verified: Set<String> = emptySet(),
    margin: Int = 0,
): List<LtTrain> =
    stops
        .map {
            val confirmed = it.group in verified
            it to LtStop(it.code, it.arrival, it.departure, margin = if (confirmed) 0 else margin, verified = confirmed)
        }.filter { (_, stop) -> stop.key in LT_CHAIN_FROM until LT_DAY_END }
        .groupBy({ it.first.train }, { it })
        .toSortedMap()
        .values
        .map { list ->
            val first = list.first().first
            val run = list.map { it.second }.distinct().sortedWith(stopOrder)
            // A numbered train's first row is its start (or a stop with an arrival when the night's cut-off fell
            // inside its run); any later row without an arrival is not treated as a stop.
            LtTrain(first.group, first.end, run.mapIndexed { index, stop -> stop.copy(origin = index == 0) })
        }

/**
 * Joins a rebuilt chain to the numbered train it continues as (through trains cross the two sources at the
 * boundary station): same family, same terminal, same physical station, departures within
 * [LT_STITCH_TOLERANCE]. Several chains can join one numbered train (one on each side of its numbered section).
 */
internal fun ltStitch(
    numbered: List<LtTrain>,
    chains: List<LtTrain>,
): List<LtTrain> {
    val at = mutableMapOf<Triple<String, String, String>, MutableList<Pair<Int, Int>>>()
    numbered.forEachIndexed { index, train ->
        val end = train.end ?: return@forEachIndexed
        train.stops.filter { it.departure >= 0 }.forEach {
            at.getOrPut(Triple(train.group, it.code, end)) { mutableListOf() }.add(it.departure to index)
        }
    }
    at.values.forEach { it.sortWith(compareBy({ pair -> pair.first }, { pair -> pair.second })) }

    fun partner(chain: LtTrain): Int? {
        val end = chain.end ?: return null
        return listOf(chain.stops.first(), chain.stops.last()).firstNotNullOfOrNull { stop ->
            if (stop.departure < 0) return@firstNotNullOfOrNull null
            at[Triple(chain.group, stop.code, end)]
                ?.firstOrNull { it.first >= stop.departure - LT_STITCH_TOLERANCE }
                ?.takeIf { it.first <= stop.departure + LT_STITCH_TOLERANCE }
                ?.second
        }
    }
    val merged = sortedMapOf<Int, MutableList<LtStop>>()
    val alone = mutableListOf<LtTrain>()
    chains.forEach { chain ->
        val index = partner(chain)
        if (index == null) {
            alone.add(chain)
        } else {
            val stops = merged.getOrPut(index) { numbered[index].stops.toMutableList() }
            val seen = stops.map { it.code }.toSet()
            stops.addAll(chain.stops.filter { it.code !in seen })
        }
    }
    val whole =
        merged.map { (index, stops) ->
            LtTrain(numbered[index].group, numbered[index].end, stops.sortedWith(stopOrder))
        }
    return alone + whole + numbered.filterIndexed { index, _ -> index !in merged }
}

/** All trains of one day type from the first source of every line family. */
internal fun ltTrains(
    problem: LtProblem,
    day: app.banbanyeok.schema.DayType,
    rows: LtDayRows,
): List<LtTrain> =
    ltStitch(
        ltNumberedTrains(rows.numbered, problem.exactNumbered[day].orEmpty(), problem.sourceMargin),
        ltUnnumberedTrains(problem, rows.unnumbered, { problem.margin(it, day) }, problem.exact[day].orEmpty()),
    )

/**
 * The same night with the second source for the families that have one: their unnumbered rows are left out and
 * their numbered trains from the second source are used instead. Null when no family has a second source.
 */
internal fun ltSecondTrains(
    problem: LtProblem,
    day: app.banbanyeok.schema.DayType,
    rows: LtDayRows,
): List<LtTrain>? {
    val families = rows.second.map { it.group }.toSet()
    if (families.isEmpty()) return null
    val others = rows.unnumbered.filterKeys { problem.stations[it]?.group !in families }
    // The second source's own rows carry no margin (the earlier of the two answers is kept) and confirm nothing.
    return ltStitch(
        ltNumberedTrains(rows.numbered, problem.exactNumbered[day].orEmpty(), problem.sourceMargin) +
            ltNumberedTrains(rows.second),
        ltUnnumberedTrains(problem, others, { problem.margin(it, day) }, problem.exact[day].orEmpty()),
    )
}
