package app.banbanyeok.pipeline

import app.banbanyeok.schema.RegistryCodec
import app.banbanyeok.schema.TimeSlot
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
import kotlin.io.path.readText

/** A source audit for the candidate regional graph. Does not write release artifacts. */
internal fun busanPreview(
    root: Path,
    input: Path,
) {
    val services = readBusanServices(root, input)
    val registry = RegistryCodec.parse(root.resolve("data/registry/stations.json").readText())
    val config = parseObject(root.resolve("data/config/busan-services.json").readText())
    val transfers = BusanTransfers(config.getValue("transfers").jsonObject)
    val serviceReport =
        services.map { service ->
            obj(
                "sourceLine" to service.id,
                "line" to service.label,
                "stations" to service.stations.size,
                "rides" to distribution(service.rides.map { it.seconds }),
                "headways" to JsonObject(service.headways.mapKeys { it.key.id }.mapValues { jsonValue(it.value) }),
                "missingSlots" to TimeSlot.ALL.filter { it !in service.headways }.map { it.id },
                "comparison" to service.comparison,
            )
        }
    val capital = StageContext(root)
    val busanSlots = TimeSlot.ALL.associateWith { busanNetwork(registry, services, transfers, it) }
    val regionalRouteGraph = busanRouteAudit(capital, busanSlots, services)
    val slots =
        TimeSlot.ALL.associateWith { slot ->
            val missing = services.filter { slot !in it.headways }.map { it.label }
            if (missing.isNotEmpty()) {
                obj("missingServices" to missing)
            } else {
                val network = busanSlots.getValue(slot)
                val costs = matrixCosts(network)
                val gate = graphGate(network, costs)
                require(gate.passed) { "Busan $slot graph gate failed: ${gate.json}" }
                obj(
                    "origins" to network.origins.size,
                    "graphGate" to gate.json,
                    "crossRegionUnreachableCells" to verifyRegionalOd(capital.slots.getValue(slot), network, costs),
                )
            }
        }
    print(
        jsonText(
            obj(
                "region" to config.text("region"),
                "services" to serviceReport,
                "regionalRouteGraph" to regionalRouteGraph,
                "slots" to JsonObject(slots.mapKeys { it.key.id }),
            ),
        ),
    )
}
