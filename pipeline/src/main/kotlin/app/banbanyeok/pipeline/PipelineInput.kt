package app.banbanyeok.pipeline

import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.RegistryCodec
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
    val headways: Map<String, Int>,
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
    val headways =
        parseObject(root.resolve("data/config/headways.json").readText())
            .getValue("lines")
            .jsonObject
            .mapValues {
                it.value.jsonObject
                    .getValue("seconds")
                    .jsonPrimitive.content
                    .toInt()
            }
    require(headways.size == 8 && headways.values.all { it in 60..1800 }) { "Missing/invalid headways" }
    return PipelineInput(
        RegistryCodec.parse(root.resolve("data/registry/stations.json").readText()),
        parseRecords(xlsx(raw.resolve("kric.xlsx").readBytes()), rules),
        csvBytes(raw.resolve("runtime.csv").readBytes()).drop(1),
        csvBytes(raw.resolve("transfer.csv").readBytes()).drop(1),
        rules,
        headways,
    )
}

internal fun network(
    input: PipelineInput,
    codes: CodeSource,
): Network {
    val registry = RegistryBuilder(input.previous, input.records, input.rules, codes).build()
    return NetworkBuilder(registry, input).build()
}

internal fun network(root: Path): Network {
    val random = SecureRandom()
    return network(readInput(root), CodeSource { random.nextInt(app.banbanyeok.schema.StationCode.CAPACITY) })
}
