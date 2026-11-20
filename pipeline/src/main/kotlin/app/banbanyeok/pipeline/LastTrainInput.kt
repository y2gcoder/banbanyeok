package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.Station
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path
import java.time.Instant
import java.time.ZoneId
import kotlin.io.path.readText

private val SEOUL_LINES = (1..8).map { it.toString() }.toSet()
private val SEOUL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

/**
 * data/config/last-train.json: which lines may produce last trains on each day type, and which line families show
 * the exact minute of a direct train. A day type never borrows another day type's timetable, so a line is listed
 * for a day type only when its own timetable of that day type is cached. Adding a line here and rebuilding is all
 * it takes to turn it on.
 */
internal class LtConfig(
    data: JsonObject,
    families: Set<String>,
) {
    /** Seoul Metro lines (S5, train numbers) per day type. */
    val seoulLines: Map<DayType, Set<String>>

    /** TAGO line families (no train numbers) per day type. */
    val tagoGroups: Map<DayType, Set<String>>

    /** Families whose direct trains matched the operator's published timetable, per day type. */
    val exact: Map<DayType, Set<String>>

    init {
        val days = data.getValue("days").jsonObject
        require(days.keys == DayType.entries.map { it.id }.toSet()) { "last-train.json: days must list every day type" }

        fun list(
            day: DayType,
            key: String,
        ) = days
            .getValue(day.id)
            .jsonObject
            .getValue(key)
            .jsonArray
            .map { it.jsonPrimitive.content }
            .toSet()
        seoulLines = DayType.entries.associateWith { list(it, "seoulLines") }
        tagoGroups = DayType.entries.associateWith { list(it, "tagoGroups") }
        require(seoulLines.values.all { SEOUL_LINES.containsAll(it) }) { "last-train.json: unknown Seoul line" }
        require(tagoGroups.values.all { families.containsAll(it) }) { "last-train.json: unknown TAGO line family" }
        val entries = data.getValue("exact").jsonObject
        entries.forEach { (family, value) ->
            val rule = value.jsonObject
            require(family in families || family in SEOUL_LINES) { "last-train.json: unknown exact family $family" }
            require(
                rule.text("source").startsWith("https://") &&
                    Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(rule.text("checkedAt")),
            ) {
                "last-train.json: exact family $family needs a source URL and the date it was checked"
            }
        }
        exact =
            DayType.entries.associateWith { day ->
                entries
                    .filterValues { rule ->
                        rule.jsonObject
                            .getValue("days")
                            .jsonArray
                            .any { it.jsonPrimitive.content == day.id }
                    }.keys
            }
    }
}

internal fun readLtConfig(
    root: Path,
    input: PipelineInput,
): LtConfig =
    LtConfig(
        parseObject(root.resolve("data/config/last-train.json").readText()),
        input.tago
            ?.lines
            ?.groups
            ?.values
            .orEmpty()
            .toSet(),
    )

/** The computation's fixed inputs taken from the travel network, so both use the same stations, order and walks. */
internal fun ltProblem(
    net: Network,
    input: PipelineInput,
    meetings: List<String>,
    config: LtConfig,
): LtProblem {
    val tagoGroups =
        input.tago
            ?.lines
            ?.groups
            .orEmpty()

    fun group(service: String) = tagoGroups[service] ?: service.take(1)
    val rides = mutableMapOf<String, MutableSet<Pair<String, String>>>()
    val pairWalks = mutableMapOf<Triple<String, String, String>, Int>()
    val stationWalks = mutableMapOf<String, Int>()
    net.graph.forEachIndexed { from, edges ->
        val (code, service) = net.nodes[from]
        edges.forEach { edge ->
            val (otherCode, otherService) = net.nodes[edge.to]
            if (edge.changes == 0) {
                require(group(service) == group(otherService)) { "Ride edge between line families at $code" }
                rides.getOrPut(group(service)) { mutableSetOf() }.add(code to otherCode)
            } else {
                require(code == otherCode) { "Transfer edge between physical stations $code and $otherCode" }
                val walk = edge.seconds - net.waits.getValue(requireNotNull(edge.wait))
                require(walk >= 0) { "Negative transfer walk at $code" }
                pairWalks.merge(Triple(code, group(service), group(otherService)), walk, ::maxOf)
                stationWalks.merge(code, walk, ::maxOf)
            }
        }
    }
    return LtProblem(
        net.origins.map { it.code },
        meetings,
        LtFamilies(rides),
        ltStations(net.origins, input),
        ltHops(requireNotNull(net.tagoReport) { "Last trains need the TAGO network" }),
        LtWalks(pairWalks, stationWalks),
        config.exact,
    )
}

/** TAGO station id → physical code (registry `tago:` sources) and line family (first service listing the id). */
private fun ltStations(
    origins: List<Station>,
    input: PipelineInput,
): Map<String, LtStation> {
    val services =
        input.tago
            ?.lines
            ?.services
            .orEmpty()
    val family = mutableMapOf<String, String>()
    services.forEach { service -> service.stations.forEach { family.putIfAbsent(it, service.group) } }
    return origins
        .flatMap { station ->
            station.sources
                .filterKeys { it.startsWith("tago:") }
                .values
                .map { it to station.code }
        }.mapNotNull { (id, code) -> family[id]?.let { id to LtStation(code, it) } }
        .toMap()
}

/** Directed run times of neighbouring TAGO stations from the network's evidence (tago-report.json `edges`). */
private fun ltHops(report: JsonObject): Map<Pair<String, String>, Int> =
    report
        .getValue("edges")
        .jsonArray
        .flatMap { element ->
            val edge = element.jsonObject
            val from = edge.text("from").substringBefore(' ')
            val to = edge.text("to").substringBefore(' ')

            fun seconds(key: String) = (edge[key] as? JsonObject)?.text("seconds")?.toInt()
            listOfNotNull(
                seconds("forward")?.let { (from to to) to it },
                seconds("reverse")?.let { (to to from) to it },
            )
        }.toMap()

/** "HH:MM:SS" or "HHMMSS" → service-day seconds, -1 for blanks, zero placeholders and times outside the day. */
internal fun ltSeconds(value: String?): Int {
    val digits = value?.trim().orEmpty().replace(":", "")
    if (!Regex("[0-9]{6}").matches(digits)) return -1
    val hour = digits.take(2).toInt()
    val minute = digits.substring(2, 4).toInt()
    val second = digits.substring(4).toInt()
    if (hour >= 27 || minute > 59 || second > 59) return -1
    return (if (hour < 3) hour + 24 else hour) * 3600 + minute * 60 + second
}

/** Timetable rows of every day type, cut down to the lines the config allows on that day type. */
internal class LtSources(
    private val problem: LtProblem,
    private val config: LtConfig,
    private val input: PipelineInput,
    /** S5 rows per day type ([readSeoulTimetables]). */
    private val seoul: Map<DayType, List<JsonObject>>,
    /** Stations of the travel network (active, on the home axis). */
    private val stations: List<Station>,
) {
    private val records =
        input.records.filter { it.operator == "서울교통공사" && it.line in SEOUL_LINES.map { n -> "${n}호선" } }
    private val codes = mutableMapOf<Pair<String, String>, String>()
    private val terminals = mutableMapOf<Pair<String, String>, String?>()

    fun rows(day: DayType): LtDayRows {
        val tago =
            input.tago
                ?.raw
                ?.get(day)
                .orEmpty()
        val groups = config.tagoGroups.getValue(day)
        val unnumbered =
            problem.stations
                .filterValues { it.group in groups }
                .keys
                .associateWith { id ->
                    tago[id].orEmpty().values.flatten().map {
                        LtRow(day(it.arrival), day(it.departure), it.end.orEmpty())
                    }
                }
        val lines = config.seoulLines.getValue(day)
        return LtDayRows(unnumbered, seoul[day].orEmpty().mapNotNull { numbered(it, lines) })
    }

    private fun day(seconds: Int?): Int = seconds?.takeIf { it < LT_DAY_END } ?: -1

    private fun numbered(
        row: JsonObject,
        lines: Set<String>,
    ): LtNumberedStop? {
        val line =
            row
                .text("LINE_NUM")
                .filter(Char::isDigit)
                .toInt()
                .toString()
        if (line !in lines) return null

        // "00:00:00" is the source's "no value" (first stop has no arrival, last stop no departure).
        fun time(key: String) = row.text(key).takeIf { it != "00:00:00" }.let(::ltSeconds)
        return LtNumberedStop(
            line,
            listOf(
                "LINE_NUM",
                "INOUT_TAG",
                "TRAIN_NO",
                "ORIGINSTATION",
                "DESTSTATION",
            ).joinToString("|") { row.text(it) },
            codes.getOrPut(line to row.text("STATION_NM")) { code(line, row.text("STATION_NM")) },
            time("ARRIVETIME"),
            time("LEFTTIME"),
            terminals.getOrPut(line to row.text("SUBWAYENAME")) { terminal(line, row.text("SUBWAYENAME")) },
        )
    }

    /** Physical station of a Seoul Metro station name on a line (same rule as the travel graph's S3 mapping). */
    private fun code(
        line: String,
        name: String,
    ): String {
        val rules = input.rules
        val lookup = rules.sourceLine(line, name)
        val match = records.filter { it.line == "${lookup}호선" && it.name == rules.canonical(name) }.distinctBy { it.id }
        require(match.size == 1) { "S5 station mapping ambiguous/missing: $line $name (${match.size})" }
        return stations.single { match.single().id in it.sources.values }.code
    }

    /** A terminal name placed on its line family's graph; through trains end outside the Seoul Metro section. */
    private fun terminal(
        line: String,
        name: String,
    ): String? {
        val plain = name.substringBefore('(').trim()
        val canonical = input.rules.canonical(name)
        return stations
            .filter { it.name == name || it.name == canonical || it.name.substringBefore('(').trim() == plain }
            .map { it.code }
            .firstOrNull { problem.families.contains(line, it) }
    }
}

/** The older of the two timetable caches' fetch dates (Seoul date): the day the last-train table is "as of". */
internal fun ltAsOf(root: Path): String =
    kotlinx.serialization.json.Json
        .parseToJsonElement(root.resolve("data/config/source-manifest.json").readText())
        .jsonArray
        .map { it.jsonObject }
        .filter { it.text("id") in setOf("S5", "S6") }
        .also { require(it.size == 2) { "S5 and S6 receipts are required for last trains" } }
        .minOf { Instant.parse(it.text("fetched_at")) }
        .atZone(SEOUL_ZONE)
        .toLocalDate()
        .toString()
