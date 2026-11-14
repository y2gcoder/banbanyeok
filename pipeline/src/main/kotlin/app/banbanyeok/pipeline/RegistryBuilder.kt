package app.banbanyeok.pipeline
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.RegistryCodec
import app.banbanyeok.schema.RegistryCompatibility
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.StationStatus
import kotlin.math.hypot

internal fun interface CodeSource {
    fun nextValue(): Int
}

internal class RegistryBuilder(
    private val previous: Registry,
    private val records: List<Record>,
    private val rules: NetworkRules,
    private val codes: CodeSource,
) {
    val stations = previous.stations.toMutableList()
    val used = stations.mapTo(mutableSetOf()) { it.code }
    val newVersion = previous.registryVersion + 1

    private fun canonical(name: String) = rules.canonical(name)

    private fun assign() {
        records.forEach { record ->
            val sourceKey = "kric:${record.operator}:${record.line}"
            val bySource =
                stations.indexOfFirst {
                    it.status == StationStatus.ACTIVE &&
                        it.sources[sourceKey] == record.id
                }
            // A normalized name is only a candidate: coordinates AND operator/line source identity are checked.
            val byLocation =
                stations.indexOfFirst {
                    matches(it, record, sourceKey)
                }
            val index = if (bySource >= 0) bySource else byLocation
            if (index >= 0) {
                val old = stations[index]
                stations[index] =
                    old.copy(
                        name = record.name,
                        lines = (old.lines + record.line).distinct().sorted(),
                        sources =
                            old.sources + (sourceKey to record.id),
                        aliases =
                            (old.aliases + old.name + record.original)
                                .filter {
                                    it !=
                                        record.name
                                }.distinct()
                                .sorted(),
                    )
            } else {
                require(used.size < StationCode.CAPACITY) { "Station code capacity exhausted" }
                var code: String
                do {
                    code = StationCode.ofValue(codes.nextValue()).toString()
                } while (!used.add(code))
                stations.add(
                    Station(
                        code,
                        record.name,
                        StationStatus.ACTIVE,
                        record.lat,
                        record.lng,
                        listOf(record.line),
                        listOf(record.original).filter {
                            it !=
                                record.name
                        },
                        mapOf(sourceKey to record.id),
                        newVersion,
                    ),
                )
            }
        }
    }

    private fun retireDuplicates() {
        // Prefer the configured source anchor, then oldest addedIn/code. Never allocate a replacement code.
        val order =
            stations.indices.sortedWith(
                compareBy(
                    { index: Int -> rules.physical?.preferred(stations[index]) == false },
                    { index -> stations[index].addedIn },
                    { index -> stations[index].code },
                ),
            )
        order.forEachIndexed { position, i ->
            if (stations[i].status == StationStatus.ACTIVE) {
                order.drop(position + 1).filter { canMerge(stations[i], stations[it]) }.forEach { j -> merge(i, j) }
            }
        }
    }

    private fun merge(
        survivor: Int,
        retired: Int,
    ) {
        val a = stations[survivor]
        val b = stations[retired]
        require(
            a.sources.keys
                .intersect(b.sources.keys)
                .all { a.sources[it] == b.sources[it] },
        ) {
            "Conflicting source identities in physical station ${a.name}"
        }
        stations[survivor] =
            a.copy(
                lines = (a.lines + b.lines).distinct().sorted(),
                aliases = (a.aliases + b.aliases + b.name).filter { it != a.name }.distinct().sorted(),
                sources = a.sources + b.sources,
            )
        stations[retired] = b.copy(status = StationStatus.DEPRECATED, deprecatedIn = newVersion, replacedBy = a.code)
    }

    private fun supplement() {
        rules.sourceOverrides.forEach { (identity, originalLine) ->
            val (line, name) = identity.split(':')
            val index =
                stations.indexOfFirst {
                    it.name == name && "${originalLine}호선" in it.lines && it.status == StationStatus.ACTIVE
                }
            require(index >= 0) { "Missing configured source override station" }
            val old = stations[index]
            stations[index] =
                old.copy(
                    lines = (old.lines + "${line}호선").distinct().sorted(),
                    sources = old.sources + ("seoul:S3:$line" to name),
                )
        }
    }

    fun build(): Registry {
        assign()
        retireDuplicates()
        supplement()
        val sorted = stations.sortedBy { it.code }
        val registry = Registry(1, if (sorted == previous.stations) previous.registryVersion else newVersion, sorted)
        RegistryCodec.validate(registry)
        val issues = registryGate(registry, rules.physical, rules::canonical)
        require(issues.isEmpty()) { issues.joinToString("; ") }
        require(
            RegistryCompatibility.checkAppendOnly(previous, registry).isEmpty(),
        ) { "Registry append-only violation" }
        return registry
    }

    private fun matches(
        station: Station,
        record: Record,
        key: String,
    ): Boolean {
        val identity = station.sources[key]
        val related =
            records.any { existing ->
                existing.id in station.sources.values && related(existing, record)
            }
        return station.status == StationStatus.ACTIVE && canonical(station.name) == record.name &&
            close(station.lat, station.lng, record.lat, record.lng) &&
            (identity == null || identity == record.id) && related
    }

    private fun canMerge(
        a: Station,
        b: Station,
    ): Boolean {
        if (b.status != StationStatus.ACTIVE || rules.physical?.separate(a, b) == true) return false
        if (rules.physical?.same(a, b, rules::canonical) == true) return true
        val ar = records.filter { it.id in a.sources.values }
        val br = records.filter { it.id in b.sources.values }
        val linked = ar.any { x -> br.any { y -> related(x, y) } }
        return b.status == StationStatus.ACTIVE && canonical(a.name) == canonical(b.name) &&
            close(a.lat, a.lng, b.lat, b.lng) && linked
    }

    private fun close(
        lat: Double,
        lng: Double,
        otherLat: Double,
        otherLng: Double,
    ): Boolean = hypot((lat - otherLat) * 111.0, (lng - otherLng) * 88.0) < 0.85

    private fun related(
        a: Record,
        b: Record,
    ): Boolean = a.lineId in b.transferLines || b.lineId in a.transferLines || a.id == b.id
}
