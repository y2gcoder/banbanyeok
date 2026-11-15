package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.StationStatus
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal data class MetroService(
    val id: String,
    val group: String,
    val label: String,
    /** TAGO ids in running order. */
    val stations: List<String>,
    /** TAGO station names as written in the config; checked against the cached station list. */
    val names: List<String>,
    val kric: List<String>,
    /** TAGO id → existing S3 service whose node is used at that station. */
    val joins: Map<String, String>,
    val s3Line: String?,
    /** Shared section of several services: boards any of their trains, so its headway counts all of them. */
    val trunk: Boolean = false,
)

internal data class NewStation(
    val name: String,
    val lines: List<String>,
    val lat: Double,
    val lng: Double,
    val source: String,
)

/** data/config/metro-lines.json: running order, physical joins and transfer defaults for TAGO lines. */
internal class MetroLines(
    data: JsonObject,
) {
    val services: List<MetroService> =
        data.getValue("services").jsonObject.map { (id, value) ->
            val rule = value.jsonObject
            val entries = rule.getValue("stations").jsonArray.map { it.jsonPrimitive.content }
            MetroService(
                id,
                rule.text("group"),
                rule.text("label"),
                entries.map { it.substringBefore(' ') },
                entries.map { it.substringAfter(' ') },
                rule.getValue("kric").jsonArray.map { it.jsonPrimitive.content },
                rule["joins"]?.jsonObject?.mapValues { it.value.jsonPrimitive.content }.orEmpty(),
                rule["s3Line"]?.jsonPrimitive?.content,
                rule["trunk"]?.jsonPrimitive?.content == "true",
            )
        }
    val nameAliases: Map<String, String> =
        data.getValue("nameAliases").jsonObject.mapValues { it.value.jsonObject.text("kric") }

    /** TAGO id → (kric operator:line, name) for stations without a same-line S1 record (GTX-A). */
    val explicit: Map<String, Pair<String, String>> =
        data.getValue("explicitStations").jsonObject.mapValues {
            it.value.jsonObject.text("kric") to it.value.jsonObject.text("name")
        }
    val newStations: Map<String, NewStation> =
        data.getValue("newStations").jsonObject.mapValues { (_, value) ->
            val rule = value.jsonObject
            NewStation(
                rule.text("name"),
                rule.getValue("lines").jsonArray.map { it.jsonPrimitive.content },
                rule.getValue("lat").jsonPrimitive.double,
                rule.getValue("lng").jsonPrimitive.double,
                rule.text("source"),
            )
        }
    private val lineNames: Map<String, String> =
        data.getValue("lineNames").jsonObject.mapValues { it.value.jsonPrimitive.content }

    /** Registry line names for TAGO routes that S1 does not list at all (GTX-A). */
    fun newLineNames(route: String): List<String> = listOfNotNull(lineNames[route])

    private val transfers = data.getValue("transfers").jsonObject
    val s4LineGroups: Map<String, String> =
        transfers.getValue("s4LineGroups").jsonObject.mapValues { it.value.jsonPrimitive.content }
    val defaultWalkSeconds: Int = transfers.getValue("defaultWalkSeconds").jsonPrimitive.int
    val groupWalkSeconds: Map<String, Int> =
        transfers.getValue("groupWalkSeconds").jsonObject.mapValues { it.value.jsonPrimitive.int }

    /** (station name, line groups) → sourced walk seconds that replace the rule-based default. */
    val transferOverrides: Map<Pair<String, Set<String>>, Int> =
        transfers["overrides"]
            ?.jsonArray
            .orEmpty()
            .flatMap { entry ->
                val rule = entry.jsonObject
                val groups =
                    rule
                        .getValue("groups")
                        .jsonArray
                        .map { it.jsonPrimitive.content }
                        .toSet()
                rule.getValue("stations").jsonArray.map {
                    (it.jsonPrimitive.content to groups) to rule.getValue("walkSeconds").jsonPrimitive.int
                }
            }.toMap()

    val groups: Map<String, String> = services.associate { it.id to it.group }

    /** Every TAGO id whose timetable the graph reads. */
    val stationIds: Set<String> = services.flatMap { it.stations }.toSet()

    fun walkSeconds(
        a: String,
        b: String,
    ): Int = maxOf(groupWalkSeconds[a] ?: defaultWalkSeconds, groupWalkSeconds[b] ?: defaultWalkSeconds)
}

/** Cached TAGO inputs read once by [readInput]. */
internal data class TagoInput(
    val lines: MetroLines,
    /** TAGO id → (station name, route name) from the keyword-less station list. */
    val stations: Map<String, Pair<String, String>>,
    /** Weekday rows: run times, dwell and direction learning always use the weekday timetable. */
    val timetable: TagoTimetable,
    /** Rows per day type for slot headways. Weekday is [timetable]; others are empty until fetched. */
    val timetables: Map<DayType, TagoTimetable> = mapOf(DayType.WEEKDAY to timetable),
)

/** Name key used only to pair a TAGO row with an S1 row of the same operator line (never across lines). */
internal fun tagoNameKey(
    name: String,
    rules: NetworkRules,
): String = rules.canonical(name).filterNot { it in ".·∙ " }

/**
 * Joins TAGO stations to physical registry stations. S1 rows are restricted to the operator lines listed for
 * the service, so a name is never joined across lines or operators; S1 already carries the coordinates and
 * transfer-line evidence used for physical merging. Missing or ambiguous rows fail.
 */
internal class TagoRegistry(
    private val records: List<Record>,
    private val rules: NetworkRules,
    private val tago: TagoInput,
) {
    fun codes(stations: List<Station>): Map<String, String> {
        val active = stations.filter { it.status == StationStatus.ACTIVE }
        val bySource = active.flatMap { station -> station.sources.values.map { it to station.code } }.toMap()
        val result = mutableMapOf<String, String>()
        tago.lines.services.forEach { service ->
            service.stations.zip(service.names).forEach { (id, configured) ->
                val (name, route) = requireNotNull(tago.stations[id]) { "TAGO station $id missing from station list" }
                require(name == configured) { "TAGO station $id is $name, config says $configured" }
                val code =
                    active.singleOrNull { it.sources["tago:$route"] == id && "wikidata" in it.sources }?.code
                        ?: tago.lines.explicit[id]?.let { (line, explicitName) ->
                            resolve(bySource, listOf(line), explicitName, id)
                        }
                        ?: resolve(bySource, service.kric, tago.lines.nameAliases[tagoNameKey(name, rules)] ?: name, id)
                require(result.getOrPut(id) { code } == code) { "TAGO station $id resolves to two physical stations" }
            }
        }
        return result
    }

    private fun resolve(
        bySource: Map<String, String>,
        lines: List<String>,
        name: String,
        id: String,
    ): String {
        val key = tagoNameKey(name, rules)
        val codes =
            records
                .filter { "${it.operator}:${it.line}" in lines && tagoNameKey(it.name, rules) == key }
                .mapNotNull { bySource[it.id] }
                .distinct()
        require(codes.size == 1) { "TAGO station $id ($name) maps to ${codes.size} physical stations" }
        return codes.single()
    }

    /**
     * Adds TAGO ids, the TAGO display alias and new line names to resolved stations, and creates the few
     * stations S1 does not list (coordinates from config). Existing codes are never reassigned.
     */
    fun supplement(
        stations: MutableList<Station>,
        used: MutableSet<String>,
        version: Int,
        codes: CodeSource,
    ) {
        tago.lines.newStations.forEach { (id, station) ->
            val route = requireNotNull(tago.stations[id]) { "New TAGO station $id missing" }.second
            if (stations.none { it.sources["tago:$route"] == id && it.status == StationStatus.ACTIVE }) {
                require(used.size < StationCode.CAPACITY) { "Station code capacity exhausted" }
                var code: String
                do {
                    code = StationCode.ofValue(codes.nextValue()).toString()
                } while (!used.add(code))
                stations.add(
                    Station(
                        code,
                        station.name,
                        StationStatus.ACTIVE,
                        station.lat,
                        station.lng,
                        station.lines.sorted(),
                        emptyList(),
                        mapOf("tago:$route" to id, "wikidata" to station.source.removePrefix("wikidata:")),
                        version,
                    ),
                )
            }
        }
        codes(stations).forEach { (id, code) ->
            val index = stations.indexOfFirst { it.code == code }
            val old = stations[index]
            val (name, route) = tago.stations.getValue(id)
            val existing = old.sources["tago:$route"]
            require(existing == null || existing == id) { "Two TAGO ids for ${old.name} on $route" }
            val display = name.substringBefore('(').trim()
            stations[index] =
                old.copy(
                    lines = (old.lines + tago.lines.newLineNames(route)).distinct().sorted(),
                    sources = old.sources + ("tago:$route" to id),
                    aliases =
                        (
                            old.aliases +
                                listOf(
                                    display,
                                ).filter { tagoNameKey(it, rules) != tagoNameKey(old.name, rules) }
                        ).distinct()
                            .sorted(),
                )
        }
    }
}
