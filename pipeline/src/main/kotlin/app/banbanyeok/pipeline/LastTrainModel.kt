package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Last trains home (#62). Rules: docs/research/last-train-design-fable.md, format: contracts/data-format.md §10.
// Everything here works on service-day seconds (00:00–02:59 is 24:00–26:59 of the previous service day).

/** Trains are rebuilt from rows of 19:00 or later; a ride can be boarded from 20:00. */
internal const val LT_CHAIN_FROM = 19 * 3600
internal const val LT_BOARD_FROM = 20 * 3600
internal const val LT_DAY_END = 27 * 3600

/** A row belongs to the same train as a row at the next station when it is this close to the expected time. */
internal const val LT_TOLERANCE = 90

/**
 * Allowance for the timetable source itself being a different revision from the operator's current one: a train
 * of a source that could not be compared with a second, train-numbered source must be boarded this many seconds
 * before its published departure. The one family that can be compared (line 9, TAGO against the operator's file)
 * is up to 125 s late on holidays; three minutes is that rounded up to whole minutes with a minute to spare.
 */
internal const val LT_SOURCE_MARGIN = 180

/**
 * A row without an arrival is either a train passing through or a train starting its run, and nothing in the row
 * says which. Within this many seconds of the expected time it is treated as contested:
 * - a chain's first row is a start only when no train to the same terminal is at the previous station that near
 *   (otherwise it may be a passing train whose earlier rows did not link);
 * - a row is linked to a row without an arrival only when no other row to the same terminal is that near, on
 *   either side of the link (otherwise the row may be the start of another train).
 */
internal const val LT_ORIGIN_WINDOW = 300

/** A rebuilt chain and a numbered train are one train when they leave the same station this close together. */
internal const val LT_STITCH_TOLERANCE = 45

/**
 * Identifier of the rules a table was computed with (manifest `lastTrainModel`). `numbered-v1`: times from
 * train-numbered sources and cell-by-cell confirmed direct cells only. `chain-v3`: rebuilt trains give times too.
 */
internal fun ltModel(rebuild: Boolean): String = (if (rebuild) "chain-v3" else "numbered-v1") + "+walk2x5m+source3m"

/**
 * Time allowed for changing trains: max([floor], walk × [walkFactor] + [extra]). The published table uses
 * [DEFAULT]; the monotonicity gate recomputes with a larger one and expects no cell to get later.
 */
internal data class LtAllowance(
    val floor: Int,
    val walkFactor: Int,
    val extra: Int,
) {
    fun seconds(walk: Int): Int = maxOf(floor, walk * walkFactor + extra)

    companion object {
        val DEFAULT = LtAllowance(floor = 600, walkFactor = 2, extra = 300)
        val WIDER = LtAllowance(floor = 900, walkFactor = 3, extra = 600)
    }
}

/** One timetable row of a station without train numbers. Times are -1 when the source has none. */
internal data class LtRow(
    val arrival: Int,
    val departure: Int,
    /** Terminal station id as the source writes it (same id space as the station ids). */
    val end: String,
) {
    /** Orders rows of one train along its run. */
    val key: Int get() = if (departure >= 0) departure else arrival
}

/** One stop of a numbered train (Seoul Metro S5): [train] is unique within a day. */
internal data class LtNumberedStop(
    val group: String,
    val train: String,
    val code: String,
    val arrival: Int,
    val departure: Int,
    /** Terminal as a physical station code; null when the source's terminal cannot be placed. */
    val end: String?,
)

/** Timetable rows of one day type, already restricted to the lines allowed on that day type. */
internal class LtDayRows(
    /** Station id → rows (TAGO lines: no train numbers). */
    val unnumbered: Map<String, List<LtRow>>,
    val numbered: List<LtNumberedStop>,
    /**
     * A second, train-numbered source for line families that [unnumbered] also covers (the operator's own file).
     * The table is computed once with each source for those families and every cell keeps the earlier answer.
     */
    val second: List<LtNumberedStop> = emptyList(),
)

/**
 * One row of a train. A row is not always a stop: the timetables list a train at stations it only passes
 * (express trains) with a departure and no arrival. So a rider gets off only where an arrival is published, and
 * gets on only where the train stops or starts its run ([origin]).
 */
internal data class LtStop(
    val code: String,
    val arrival: Int,
    val departure: Int,
    /** The train starts its run here (first row, nothing before it). */
    val origin: Boolean = false,
    /** Seconds before [departure] by which a rider must be on the platform ([LT_SOURCE_MARGIN] or 0). */
    val margin: Int = 0,
    /**
     * The row comes from a line and day type whose last trains were confirmed against the operator's timetable.
     * A ride is a confirmed direct train only when it is boarded and left at such rows.
     */
    val verified: Boolean = false,
) {
    val key: Int get() = if (departure >= 0) departure else arrival

    val alights: Boolean get() = arrival >= 0

    val boards: Boolean get() = departure >= 0 && (arrival >= 0 || origin)

    /** The time published for boarding here: the departure less the source margin. */
    val boardBy: Int get() = departure - margin
}

/** A rider boards at [from] and gets off at [to], a later row of the same train (from 20:00 on). */
internal fun ltRides(
    from: LtStop,
    to: LtStop,
): Boolean =
    from.boards && to.alights && from.boardBy >= LT_BOARD_FROM && from.code != to.code &&
        from.departure < to.arrival

/** A train of one night: stops in running order. [end] is the terminal's physical code when known. */
internal class LtTrain(
    val group: String,
    val end: String?,
    val stops: List<LtStop>,
) {
    /** Destination shown to riders: the terminal, or the last stop the timetable shows when it is unknown. */
    val bound: String get() = end ?: stops.last().code
}

/** Unnumbered station: physical code and line family. */
internal data class LtStation(
    val code: String,
    val group: String,
)

/**
 * Physical-station graph per line family (curated network, both sources). A terminal's side is the neighbour
 * strictly closer to it; a terminal that is not on the family's graph has no side, so nothing is linked towards
 * it (fails to the safe side: a missing ride, never a phantom one).
 */
internal class LtFamilies(
    edges: Map<String, Collection<Pair<String, String>>>,
) {
    private val graph: Map<String, Map<String, Set<String>>> =
        edges.mapValues { (_, pairs) ->
            (pairs + pairs.map { it.second to it.first })
                .filter { it.first != it.second }
                .groupBy({ it.first }, { it.second })
                .mapValues { it.value.toSet() }
        }
    private val distances = mutableMapOf<Pair<String, String>, Map<String, Int>>()

    fun contains(
        group: String,
        code: String,
    ): Boolean = graph[group]?.containsKey(code) == true

    fun adjacent(
        group: String,
        a: String,
        b: String,
    ): Boolean = graph[group]?.get(a)?.contains(b) == true

    fun closer(
        group: String,
        here: String,
        there: String,
        end: String?,
    ): Boolean {
        if (end == null || !contains(group, end)) return false
        val distance = distances.getOrPut(group to end) { bfs(graph.getValue(group), end) }
        val from = distance[here] ?: return false
        val to = distance[there] ?: return false
        return to < from
    }

    private fun bfs(
        adjacent: Map<String, Set<String>>,
        start: String,
    ): Map<String, Int> {
        val seen = mutableMapOf(start to 0)
        val queue = ArrayDeque(listOf(start))
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            adjacent[node].orEmpty().filter { it !in seen }.forEach {
                seen[it] = seen.getValue(node) + 1
                queue.add(it)
            }
        }
        return seen
    }

    /** Sorted undirected edges per family, for the oracle input. */
    fun json(): JsonObject =
        JsonObject(
            graph.toSortedMap().mapValues { (_, adjacent) ->
                jsonValue(
                    adjacent
                        .flatMap { (a, others) -> others.filter { a < it }.map { listOf(a, it) } }
                        .sortedWith(compareBy({ it[0] }, { it[1] })),
                )
            },
        )
}

/**
 * Walking seconds between two line families at one physical station, taken from the transfer edges of the travel
 * graph. A pair without its own edge uses the longest walk known at that station, and 0 when the station has none.
 */
internal class LtWalks(
    private val pairs: Map<Triple<String, String, String>, Int>,
    private val stations: Map<String, Int>,
) {
    fun seconds(
        code: String,
        from: String,
        to: String,
    ): Int = pairs[Triple(code, from, to)] ?: stations[code] ?: 0

    fun json(): Pair<List<List<Any>>, JsonObject> =
        pairs.entries
            .sortedWith(compareBy({ it.key.first }, { it.key.second }, { it.key.third }))
            .map { (key, walk) -> listOf(key.first, key.second, key.third, walk) } to
            JsonObject(stations.toSortedMap().mapValues { jsonValue(it.value) })
}

/**
 * A direct ride the operator's own published timetable gives for one cell: the last departure (minute of the service
 * day) from [meeting] of a train of [family] bound for [bound] that stops at [home].
 */
internal data class LtProven(
    val home: String,
    val meeting: String,
    val minute: Int,
    val bound: String,
    val family: String,
)

/** Everything the computation needs besides the day's rows. */
internal data class LtProblem(
    /** Home axis (od.bin origins) and meeting axis (od.bin candidates), both in code order. */
    val homes: List<String>,
    val meetings: List<String>,
    val families: LtFamilies,
    /** Unnumbered station id → physical code and family. */
    val stations: Map<String, LtStation>,
    /** Directed time between neighbouring unnumbered stations, departure to departure (run + dwell on arrival). */
    val hops: Map<Pair<String, String>, Int>,
    val walks: LtWalks,
    /** Unnumbered families whose direct trains passed the comparison with the operator's timetable, per day type. */
    val exact: Map<DayType, Set<String>>,
    /** Directed running time between the same stations, departure to arrival. */
    val runs: Map<Pair<String, String>, Int> = hops.mapValues { maxOf(it.value - DEFAULT_DWELL, 1) },
    /** [LT_SOURCE_MARGIN] for trains rebuilt from unnumbered rows of a family that is not exact that day. */
    val sourceMargin: Int = LT_SOURCE_MARGIN,
    /**
     * Numbered lines whose every last direct train equals the operator's train-coded file that day type (checked
     * by the build, pair for pair). Rows of other numbered lines are boarded with the source margin.
     */
    val exactNumbered: Map<DayType, Set<String>> = emptyMap(),
    /**
     * Whether trains rebuilt from rows without train numbers may give a time. **Off by default**: nothing in such
     * rows proves which train a row belongs to, and a wrong link invents a train (a time later than the real last
     * train). With it off, a time comes only from train-numbered sources, and from the direct cells of [proven].
     * Rebuilding stays in the code for comparison with a numbered source and for the independent oracle.
     */
    val rebuild: Boolean = false,
    /**
     * With [rebuild] off: the direct cells the operator's timetable was compared with one by one, per day type. Such
     * a cell gets its time only when the train rebuilt for it leaves at that minute for that terminal.
     */
    val proven: Map<DayType, List<LtProven>> = emptyMap(),
) {
    fun margin(
        family: String,
        day: DayType,
    ): Int = if (family in exact[day].orEmpty()) 0 else sourceMargin

    companion object {
        /** Dwell assumed when a problem file gives hop times only. */
        const val DEFAULT_DWELL = 30
    }
}

/** A cell's content before encoding: minute of the service day, schema kind raw value, terminal code. */
internal data class LtCell(
    val kind: Int,
    val minute: Int,
    val bound: String?,
) {
    companion object {
        val UNKNOWN = LtCell(0, -1, null)
    }
}

/** The last train that serves a cell on its own: what the operator's timetable can be compared with. */
internal data class LtDirect(
    /** Published boarding time in seconds (departure less the source margin). */
    val boardBy: Int,
    /** The train's departure as the source prints it. */
    val departure: Int,
    val bound: String,
    val group: String,
    /** Boarded and left at rows confirmed against the operator's timetable ([LtStop.verified]). */
    val verified: Boolean,
)

/** Result of one day type: cells in home-major order (home index × meetings + meeting index). */
internal class LtDayResult(
    val cells: List<LtCell>,
    /** Latest boarding time in seconds by any itinerary, -1 when none (for the gates). */
    val latest: IntArray,
    /** The last single train of each cell, null when no train serves it alone (for the gates). */
    val direct: List<LtDirect?>,
)

internal fun ltProblem(data: JsonObject): LtProblem {
    fun strings(key: String) = data.getValue(key).jsonArray.map { it.jsonPrimitive.content }
    val hopRows = data.getValue("hops").jsonArray.map { it.jsonArray }
    val walks =
        data.getValue("walks").jsonArray.associate {
            val row = it.jsonArray
            Triple(row[0].jsonPrimitive.content, row[1].jsonPrimitive.content, row[2].jsonPrimitive.content) to
                row[3].jsonPrimitive.int
        }
    return LtProblem(
        strings("homes"),
        strings("meetings"),
        LtFamilies(
            data.getValue("families").jsonObject.mapValues { (_, edges) ->
                edges.jsonArray.map { it.jsonArray[0].jsonPrimitive.content to it.jsonArray[1].jsonPrimitive.content }
            },
        ),
        data.getValue("stations").jsonObject.mapValues {
            LtStation(
                it.value.jsonArray[0]
                    .jsonPrimitive.content,
                it.value.jsonArray[1]
                    .jsonPrimitive.content,
            )
        },
        hopRows.associate { (it[0].jsonPrimitive.content to it[1].jsonPrimitive.content) to it[2].jsonPrimitive.int },
        LtWalks(walks, data.getValue("stationWalks").jsonObject.mapValues { it.value.jsonPrimitive.int }),
        daySets(data.getValue("exact").jsonObject),
        hopRows.associate { row ->
            val run =
                row.getOrNull(3)?.jsonPrimitive?.int ?: maxOf(row[2].jsonPrimitive.int - LtProblem.DEFAULT_DWELL, 1)
            (row[0].jsonPrimitive.content to row[1].jsonPrimitive.content) to run
        },
        data["sourceMargin"]?.jsonPrimitive?.int ?: LT_SOURCE_MARGIN,
        daySets(data["exactNumbered"]?.jsonObject),
        data["rebuild"]?.jsonPrimitive?.content == "true",
        DayType.entries.associateWith { day ->
            data["proven"]?.jsonObject?.get(day.id)?.jsonArray.orEmpty().map {
                val row = it.jsonArray
                LtProven(
                    row[0].jsonPrimitive.content,
                    row[1].jsonPrimitive.content,
                    row[2].jsonPrimitive.int,
                    row[3].jsonPrimitive.content,
                    row[4].jsonPrimitive.content,
                )
            }
        },
    )
}

/** `{dayType: [name, …]}` of a problem file as a set per day type (empty for a day type or a key left out). */
private fun daySets(data: JsonObject?): Map<DayType, Set<String>> =
    DayType.entries.associateWith { day ->
        data
            ?.get(day.id)
            ?.jsonArray
            .orEmpty()
            .map { it.jsonPrimitive.content }
            .toSet()
    }

private fun ltNumbered(rows: kotlinx.serialization.json.JsonArray): List<LtNumberedStop> =
    rows.map {
        val row = it.jsonArray
        LtNumberedStop(
            row[0].jsonPrimitive.content,
            row[1].jsonPrimitive.content,
            row[2].jsonPrimitive.content,
            row[3].jsonPrimitive.int,
            row[4].jsonPrimitive.int,
            row[5].jsonPrimitive.content.ifEmpty { null },
        )
    }

/** Rows embedded in a problem file (toy fixtures; real runs read the timetable caches). */
internal fun ltRows(
    data: JsonObject,
    day: DayType,
): LtDayRows {
    val rows = data.getValue("rows").jsonObject[day.id]?.jsonObject ?: return LtDayRows(emptyMap(), emptyList())
    return LtDayRows(
        rows.getValue("unnumbered").jsonObject.mapValues { (_, list) ->
            list.jsonArray.map {
                val row = it.jsonArray
                LtRow(row[0].jsonPrimitive.int, row[1].jsonPrimitive.int, row[2].jsonPrimitive.content)
            }
        },
        ltNumbered(rows.getValue("numbered").jsonArray),
        rows["second"]?.jsonArray?.let(::ltNumbered).orEmpty(),
    )
}

internal fun ltProblemJson(problem: LtProblem): JsonObject {
    val (pairWalks, stationWalks) = problem.walks.json()
    return obj(
        "homes" to problem.homes,
        "meetings" to problem.meetings,
        "families" to problem.families.json(),
        "stations" to
            JsonObject(problem.stations.toSortedMap().mapValues { jsonValue(listOf(it.value.code, it.value.group)) }),
        "hops" to
            problem.hops.entries
                .sortedWith(compareBy({ it.key.first }, { it.key.second }))
                .map { listOf(it.key.first, it.key.second, it.value, problem.runs.getValue(it.key)) },
        "sourceMargin" to problem.sourceMargin,
        "walks" to pairWalks,
        "stationWalks" to stationWalks,
        "exact" to JsonObject(problem.exact.entries.associate { it.key.id to jsonValue(it.value.sorted()) }),
        "exactNumbered" to
            JsonObject(problem.exactNumbered.entries.associate { it.key.id to jsonValue(it.value.sorted()) }),
        "rebuild" to problem.rebuild,
        "proven" to
            JsonObject(
                problem.proven.entries.associate { (day, list) ->
                    day.id to jsonValue(list.map { listOf(it.home, it.meeting, it.minute, it.bound, it.family) })
                },
            ),
    )
}
