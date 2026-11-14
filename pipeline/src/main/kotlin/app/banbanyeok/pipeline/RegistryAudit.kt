package app.banbanyeok.pipeline

import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.StationStatus
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.io.path.writeText

/** Human-review inventory of every metropolitan active station, line list and source count. */
internal fun writeRegistryAudit(
    root: Path,
    registry: Registry,
) {
    val rules = NetworkRules(parseObject(root.resolve("data/config/network-rules.json").readText()))
    val physical = requireNotNull(rules.physical)
    val issues = registryGate(registry, physical, rules::canonical)
    require(issues.isEmpty()) { issues.joinToString("; ") }
    val scoped = registry.stations.filter { it.status == StationStatus.ACTIVE && physical.inScope(it) }
    val stations =
        scoped.map { station ->
            obj(
                "code" to station.code,
                "name" to station.name,
                "lines" to station.lines,
                "sourceCount" to station.sources.size,
                "multipleLines" to (station.lines.size > 1),
            )
        }
    val sameNames =
        scoped.groupBy { rules.canonical(it.name) }.values.filter { it.size > 1 }.map { group ->
            obj(
                "name" to group.first().name,
                "codes" to group.map { it.code },
                "pairDistancesKm" to
                    group.flatMapIndexed { index, a ->
                        group.drop(index + 1).map { b -> obj("a" to a.code, "b" to b.code, "km" to distanceKm(a, b)) }
                    },
            )
        }
    root.resolve("data/config/physical-station-audit.json").writeText(
        obj(
            "registryVersion" to registry.registryVersion,
            "scopedActiveStations" to scoped.size,
            "multipleLineStations" to scoped.count { it.lines.size > 1 },
            "violations" to issues,
            "replacementChainsChecked" to registry.stations.count { it.replacedBy != null },
            "remainingSameNames" to sameNames,
            "stations" to stations,
        ).toString() + "\n",
    )
}
