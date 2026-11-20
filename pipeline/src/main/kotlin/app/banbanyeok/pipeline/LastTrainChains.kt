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
 * Only neighbours on the terminal's side are tried ([allowed]); among them the neighbour that most rows of the
 * same (station, terminal) match wins, so a following train that happens to sit at another neighbour at the
 * expected time is never linked. A skipped stop (express) or a short run simply has no row to link to: the chain
 * ends there, which loses rides but never invents one.
 */
internal class LtChainer(
    rows: Map<String, List<LtRow>>,
    private val neighbours: Map<String, List<String>>,
    private val hops: Map<Pair<String, String>, Int>,
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

    /** Station id → terminal → (time, row index) in time order. */
    private val byEnd: Map<String, Map<String, List<Pair<Int, Int>>>> =
        this.rows.mapValues { (_, list) ->
            list.withIndex().groupBy({ it.value.end }, { it.value.key to it.index })
        }

    private fun match(
        from: String,
        row: LtRow,
        next: String,
    ): LtMatch? {
        val hop = hops[from to next] ?: return null
        val candidates = byEnd[next]?.get(row.end) ?: return null
        val expected = row.departure + hop
        val first = candidates.indexOfFirst { it.first >= expected - LT_TOLERANCE - LT_TERMINAL_EARLY }
        if (first < 0) return null
        return candidates
            .subList(first, candidates.size)
            .takeWhile { it.first <= expected + LT_TOLERANCE }
            .filter { (time, index) ->
                val terminal = rows.getValue(next)[index].departure < 0
                time >= expected - LT_TOLERANCE - if (terminal) LT_TERMINAL_EARLY else 0
            }.minByOrNull { kotlin.math.abs(it.first - expected) }
            ?.let { LtMatch(kotlin.math.abs(it.first - expected), next, it.second) }
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
            byEnd[before]?.get(row.end).orEmpty().any { (time, index) ->
                rows.getValue(before)[index].departure >= 0 && kotlin.math.abs(time - expected) <= LT_ORIGIN_WINDOW
            }
        }
    }

    /** Every departing row's best match at each allowed neighbour, in (station, row) order. */
    private fun matches(): Map<LtRef, List<LtMatch>> {
        val found = linkedMapOf<LtRef, List<LtMatch>>()
        rows.forEach { (station, list) ->
            list.forEachIndexed { index, row ->
                if (row.departure >= 0) {
                    found[LtRef(station, index)] =
                        neighbours[station]
                            .orEmpty()
                            .filter { allowed(station, row.end, it) }
                            .mapNotNull { match(station, row, it) }
                }
            }
        }
        return found
    }

    /** Row → the row of the same train at the next station. */
    fun links(): Map<LtRef, LtRef> {
        val found = matches()
        val votes = mutableMapOf<Pair<String, String>, MutableMap<String, Int>>()
        found.forEach { (ref, list) ->
            val key = ref.station to rows.getValue(ref.station)[ref.index].end
            list.forEach { votes.getOrPut(key) { sortedMapOf() }.merge(it.next, 1, Int::plus) }
        }
        val forward = mutableMapOf<LtRef, LtRef>()
        val taken = mutableMapOf<LtRef, Pair<Int, LtRef>>()
        found.forEach { (ref, list) ->
            val key = ref.station to rows.getValue(ref.station)[ref.index].end
            // The neighbour most rows agree on; on a tie the smaller id (the map is sorted).
            val side = votes[key]?.entries?.maxByOrNull { it.value }?.key
            val best = list.firstOrNull { it.next == side } ?: return@forEach
            val target = LtRef(best.next, best.index)
            val holder = taken[target]
            if (holder != null && holder.first <= best.gap) return@forEach
            if (holder != null) forward.remove(holder.second)
            taken[target] = best.gap to ref
            forward[ref] = target
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
): List<LtTrain> {
    val known = rows.filterKeys { it in problem.stations }
    val neighbours =
        problem.hops.keys
            .groupBy({ it.first }, { it.second })
            .mapValues { it.value.sorted() }
    val chainer =
        LtChainer(known, neighbours, problem.hops) { station, end, next ->
            val here = problem.stations.getValue(station)
            val there = problem.stations[next] ?: return@LtChainer false
            problem.families.closer(here.group, here.code, there.code, problem.stations[end]?.code)
        }
    return ltChains(chainer.links()).map { chain ->
        val head = chain.first()
        val first = chainer.rows.getValue(head.station)[head.index]
        LtTrain(
            problem.stations.getValue(head.station).group,
            problem.stations[first.end]?.code,
            chain.mapIndexed { index, ref ->
                val row = chainer.rows.getValue(ref.station)[ref.index]
                val origin = index == 0 && row.arrival < 0 && chainer.startsRun(ref)
                LtStop(problem.stations.getValue(ref.station).code, row.arrival, row.departure, origin)
            },
        )
    }
}

private val stopOrder = compareBy<LtStop>({ it.key }, { it.code })

/** Trains of the numbered lines: stops of one train number in time order; trains in train-id order. */
internal fun ltNumberedTrains(stops: List<LtNumberedStop>): List<LtTrain> =
    stops
        .map { it to LtStop(it.code, it.arrival, it.departure) }
        .filter { (_, stop) -> stop.key in LT_CHAIN_FROM until LT_DAY_END }
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

/** All trains of one day type. */
internal fun ltTrains(
    problem: LtProblem,
    rows: LtDayRows,
): List<LtTrain> = ltStitch(ltNumberedTrains(rows.numbered), ltUnnumberedTrains(problem, rows.unnumbered))
