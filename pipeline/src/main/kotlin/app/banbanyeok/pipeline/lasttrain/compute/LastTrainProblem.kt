package app.banbanyeok.pipeline.lasttrain.compute

import app.banbanyeok.pipeline.Network
import app.banbanyeok.pipeline.PipelineInput
import app.banbanyeok.pipeline.lasttrain.model.LtConfig
import app.banbanyeok.pipeline.lasttrain.model.LtFamilies
import app.banbanyeok.pipeline.lasttrain.model.LtProblem
import app.banbanyeok.pipeline.lasttrain.model.LtStation
import app.banbanyeok.pipeline.lasttrain.model.LtWalks
import app.banbanyeok.pipeline.network
import app.banbanyeok.pipeline.sources
import app.banbanyeok.pipeline.text
import app.banbanyeok.schema.Station
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/** The computation's fixed inputs taken from the travel network, so both use the same stations, order and walks. */
internal fun ltProblemFromNetwork(
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
        ltHops(requireNotNull(net.tagoReport) { "Last trains need the TAGO network" }, "seconds"),
        LtWalks(pairWalks, stationWalks),
        config.exact,
        ltHops(net.tagoReport, "runSeconds"),
        rebuild = config.rebuild,
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

/**
 * Directed times of neighbouring TAGO stations from the network's evidence (tago-report.json `edges`): `seconds`
 * is departure to departure (run + dwell on arrival), `runSeconds` departure to arrival.
 */
private fun ltHops(
    report: JsonObject,
    field: String,
): Map<Pair<String, String>, Int> =
    report
        .getValue("edges")
        .jsonArray
        .flatMap { element ->
            val edge = element.jsonObject
            val from = edge.text("from").substringBefore(' ')
            val to = edge.text("to").substringBefore(' ')

            fun seconds(key: String) = (edge[key] as? JsonObject)?.text(field)?.toInt()
            listOfNotNull(
                seconds("forward")?.let { (from to to) to it },
                seconds("reverse")?.let { (to to from) to it },
            )
        }.toMap()
