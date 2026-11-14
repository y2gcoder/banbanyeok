package app.banbanyeok.pipeline

import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationStatus
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.hypot

internal class PhysicalStations(
    private val data: JsonObject,
) {
    private val scope = data.getValue("scope").jsonObject
    private val nearKm = data.getValue("nearKm").jsonPrimitive.double

    fun preferred(station: Station): Boolean =
        data["preferredSourcePrefix"]?.jsonPrimitive?.content?.let { prefix ->
            station.sources.keys.any { it.startsWith(prefix) }
        } ?: false

    fun inScope(station: Station): Boolean =
        station.lat in scope.getValue("minLat").jsonPrimitive.double..scope.getValue("maxLat").jsonPrimitive.double &&
            station.lng in scope.getValue("minLng").jsonPrimitive.double..scope.getValue("maxLng").jsonPrimitive.double

    fun separate(
        a: Station,
        b: Station,
    ): Boolean = configuredPair("distinctPairs", a, b)

    fun same(
        a: Station,
        b: Station,
        canonical: (String) -> String,
    ): Boolean {
        if (!inScope(a) || !inScope(b) || separate(a, b)) return false
        return canonical(a.name) == canonical(b.name) &&
            (distanceKm(a, b) < nearKm || configuredPair("samePairs", a, b))
    }

    private fun configuredPair(
        key: String,
        a: Station,
        b: Station,
    ): Boolean =
        data.getValue(key).jsonArray.any { entry ->
            entry.jsonObject
                .getValue("codes")
                .jsonArray
                .map { it.jsonPrimitive.content }
                .toSet() ==
                setOf(a.code, b.code)
        }
}

internal fun distanceKm(
    a: Station,
    b: Station,
): Double = hypot((a.lat - b.lat) * 111.0, (a.lng - b.lng) * 88.0)

/** ReplacedBy is the sole code alias source; a deprecated station without replacement is not an alias target. */
internal fun resolveReplacement(
    registry: Registry,
    code: String,
): String {
    val stations = registry.stations.associateBy { it.code }
    val visited = mutableSetOf<String>()
    var current = code
    while (true) {
        require(visited.add(current)) { "Replacement cycle from $code" }
        val station = requireNotNull(stations[current]) { "Missing replacement target $current" }
        if (station.status == StationStatus.ACTIVE) return current
        current = requireNotNull(station.replacedBy) { "Replacement ends deprecated: $current" }
    }
}

internal fun registryGate(
    registry: Registry,
    physical: PhysicalStations?,
    canonical: (String) -> String,
): List<String> {
    val issues = mutableListOf<String>()
    val active = registry.stations.filter { it.status == StationStatus.ACTIVE }
    active.groupBy { canonical(it.name) }.values.forEach { group ->
        group.forEachIndexed { index, a ->
            group.drop(index + 1).filter { physical?.same(a, it, canonical) == true }.forEach { b ->
                issues.add("Duplicate physical station ${a.name}: ${a.code},${b.code}")
            }
        }
    }
    registry.stations.filter { it.replacedBy != null }.forEach { station ->
        try {
            resolveReplacement(registry, station.code)
        } catch (failure: IllegalArgumentException) {
            issues.add(requireNotNull(failure.message))
        }
    }
    return issues
}
