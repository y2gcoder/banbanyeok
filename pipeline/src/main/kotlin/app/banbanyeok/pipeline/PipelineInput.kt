package app.banbanyeok.pipeline

import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.RegistryCodec
import app.banbanyeok.schema.TimeSlot
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path
import java.security.SecureRandom
import kotlin.io.path.readBytes
import kotlin.io.path.readText

internal data class PipelineInput(
    val previous: Registry,
    val records: List<Record>,
    val runtime: List<List<String>>,
    val transfers: List<List<String>>,
    val rules: NetworkRules,
    /** Seoul Metro line headways of the default slot (weekday daytime). */
    val headways: Map<String, Int>,
    val tago: TagoInput? = null,
    /** Seoul Metro line headways per time slot (headways.json `slots`); only the default before T2 data. */
    val slotHeadways: Map<TimeSlot, Map<String, Int>> = mapOf(TimeSlot.DEFAULT to headways),
)

internal fun parseRecords(
    rows: List<List<String>>,
    rules: NetworkRules,
): List<Record> =
    rows.drop(1).map { row ->
        Record(
            "${row[11]}:${row[2]}:${row[0]}",
            rules.canonical(row[1]),
            row[3],
            row[9].toDouble(),
            row[10].toDouble(),
            row[11],
            row[1],
            row[2],
            row[7].split('+').toSet(),
        )
    }

internal fun readInput(root: Path): PipelineInput {
    verifyRaw(root)
    val rules = NetworkRules(parseObject(root.resolve("data/config/network-rules.json").readText()))
    val raw = root.resolve("data/raw")
    val slotHeadways = slotLineHeadways(parseObject(root.resolve("data/config/headways.json").readText()))
    require(
        slotHeadways.values.all { lines -> lines.size == 8 && lines.values.all { it in SEOUL_HEADWAY_RANGE } },
    ) { "Missing/invalid headways" }
    val headways = slotHeadways.getValue(TimeSlot.DEFAULT)
    return PipelineInput(
        RegistryCodec.parse(root.resolve("data/registry/stations.json").readText()),
        parseRecords(xlsx(raw.resolve("kric.xlsx").readBytes()), rules),
        csvBytes(raw.resolve("runtime.csv").readBytes()).drop(1),
        csvBytes(raw.resolve("transfer.csv").readBytes()).drop(1),
        rules,
        headways,
        readTago(root),
        slotHeadways,
    )
}

internal fun network(
    input: PipelineInput,
    codes: CodeSource,
): Network {
    val registry = RegistryBuilder(input.previous, input.records, input.rules, codes, input.tago).build()
    return NetworkBuilder(registry, input).build()
}

internal fun network(root: Path): Network = network(readInput(root), secureCodes())

private fun secureCodes(): CodeSource {
    val random = SecureRandom()
    return CodeSource { random.nextInt(app.banbanyeok.schema.StationCode.CAPACITY) }
}

/** Default network and the same graph re-weighted with every slot's boarding waits (default slot included). */
internal fun slotNetworks(
    input: PipelineInput,
    net: Network,
): Map<TimeSlot, Network> =
    TimeSlot.ALL.associateWith { slot ->
        if (slot == TimeSlot.DEFAULT) {
            net
        } else {
            val seoul = requireNotNull(input.slotHeadways[slot]) { "headways.json has no $slot; run headways" }
            val tago = input.tago?.let { tagoServiceHeadways(it, slot) }.orEmpty()
            net.withWaits(boardingWaits(net.waits.keys, seoul, tago))
        }
    }

internal fun slotNetworks(root: Path): Map<TimeSlot, Network> {
    val input = readInput(root)
    return slotNetworks(input, network(input, secureCodes()))
}
