package app.banbanyeok.pipeline

import app.banbanyeok.schema.CandidateList
import app.banbanyeok.schema.DataSetBytes
import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.schema.LtBinCodec
import app.banbanyeok.schema.MANIFEST_SCHEMA_VERSION
import app.banbanyeok.schema.Manifest
import app.banbanyeok.schema.ManifestCodec
import app.banbanyeok.schema.ManifestFile
import app.banbanyeok.schema.ManifestFiles
import app.banbanyeok.schema.ManifestNames
import app.banbanyeok.schema.OdBinCodec
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.RegistryCodec
import app.banbanyeok.schema.Sha256
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.schema.generationOne
import app.banbanyeok.schema.generationTwo
import kotlinx.serialization.json.JsonObject
import java.nio.file.Path
import java.time.Clock
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.readBytes
import kotlin.io.path.readText
import kotlin.io.path.writeBytes
import kotlin.io.path.writeText

/** Reads and fully validates the dev artifact set (manifest, registry, candidates, every slot matrix). */
internal fun loadDevArtifacts(output: Path): app.banbanyeok.schema.DataSet {
    val manifestText = latestManifest(output).readText()
    val manifest = ManifestCodec.parse(manifestText)
    return DataSetLoader.load(
        DataSetBytes(
            manifestText,
            output.resolve(manifest.files.registry.path).readBytes(),
            output.resolve(manifest.files.candidates.path).readBytes(),
            output.resolve(manifest.files.od.path).readBytes(),
            manifest.files.odSlots
                .orEmpty()
                .mapValues { output.resolve(it.value.path).readBytes() },
        ),
    )
}

/** The newest manifest generation present in [dir] (generation 3, then 2, then the generation-1 `manifest.json`). */
internal fun latestManifest(dir: Path): Path =
    ManifestNames.NEWEST_FIRST.map(dir::resolve).firstOrNull { it.exists() }
        ?: dir.resolve(ManifestNames.GENERATION_ONE)

/** The dev artifact set's last-train table, validated against [dataSet] (null for data before generation 3). */
internal fun loadDevLastTrains(
    output: Path,
    dataSet: app.banbanyeok.schema.DataSet,
): LastTrainTable? =
    dataSet.manifest.files.lastTrain
        ?.let { DataSetLoader.lastTrains(dataSet, output.resolve(it.path).readBytes()) }

/** Dev file name of the last-train table. */
internal const val LT_FILE = "lt.bin"

/** Dev file name of a slot matrix: `od.bin` for the default slot, `od-<slot>.bin` for the others. */
internal fun odFileName(slot: TimeSlot): String = if (slot == TimeSlot.DEFAULT) "od.bin" else "od-${slot.id}.bin"

internal fun publish(
    root: Path,
    net: Network,
    candidates: CandidateList,
    matrices: Map<TimeSlot, Pair<IntArray, IntArray>>,
    lastTrains: LtArtifact,
) {
    require(matrices.keys == TimeSlot.ALL.toSet()) { "Every time slot needs a matrix" }
    val ods =
        matrices.mapValues { (_, matrix) ->
            OdMatrix(
                net.registry.registryVersion,
                net.origins.map { StationCode.parse(it.code).value }.toIntArray(),
                candidates.candidates.map { StationCode.parse(it).value }.toIntArray(),
                matrix.first,
                matrix.second,
            )
        }
    ArtifactWriter(root, net, candidates, ods, lastTrains).write()
}

private class ArtifactWriter(
    private val root: Path,
    private val net: Network,
    private val candidates: CandidateList,
    ods: Map<TimeSlot, OdMatrix>,
    private val lastTrains: LtArtifact,
    private val clock: Clock = Clock.systemUTC(),
) {
    /** SEO pages stay on the default slot (weekday daytime): static pages carry no time choice. */
    private val od = ods.getValue(TimeSlot.DEFAULT)
    private val slots = TimeSlot.ALL.filter { it != TimeSlot.DEFAULT }

    private val output = root.resolve("data/artifacts/dev").createDirectories()
    private val previous =
        latestManifest(output)
            .takeIf {
                it.exists()
            }?.let { ManifestCodec.parse(it.readText()) }
    private val seo = seoPairs(net.registry, od, readSeoHubs(root, net.registry), previous?.dataVersion ?: "20000101.1")
    private val files =
        linkedMapOf(
            "stations.json" to jsonText(RegistryCodec.encode(net.registry)).toByteArray(),
            "candidates.json" to jsonText(RegistryCodec.encodeCandidates(candidates)).toByteArray(),
            "od.bin" to OdBinCodec.encode(od),
            "seo-pairs.json" to jsonText(seo).toByteArray(),
            LT_FILE to LtBinCodec.encode(lastTrains.table),
        )

    /**
     * Slot → dev file name. A slot whose matrix is byte-identical to an earlier slot's (Saturday and Sunday/holiday
     * run the same weekend timetables) shares that file: one upload, one matrix in server memory.
     */
    private val slotFiles: Map<TimeSlot, String> =
        buildMap {
            val byContent = mutableMapOf(Sha256.hex(files.getValue("od.bin")) to "od.bin")
            slots.forEach { slot ->
                val bytes = OdBinCodec.encode(ods.getValue(slot))
                val name = byContent.getOrPut(Sha256.hex(bytes)) { odFileName(slot).also { files[it] = bytes } }
                put(slot, name)
            }
        }

    fun write() {
        writeGlyphs()
        if (unchanged()) {
            println("Artifacts unchanged (including SEO pairs)")
            return
        }
        val now = clock.instant().truncatedTo(java.time.temporal.ChronoUnit.SECONDS)
        val date = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(ZoneOffset.UTC).format(now)
        val revision =
            previous
                ?.dataVersion
                ?.takeIf { it.startsWith("$date.") }
                ?.substringAfter('.')
                ?.toInt()
                ?.plus(1) ?: 1
        require(revision <= 999) { "Daily dataVersion revision exhausted" }
        val version = "$date.$revision"
        files["seo-pairs.json"] = jsonText(JsonObject(seo + ("dataVersion" to jsonValue(version)))).toByteArray()
        require(files.getValue("seo-pairs.json").size <= 1_048_576) { "SEO pairs exceed 1 MiB; reduce selected hubs" }
        val manifest = manifest(version, now.toString())
        val manifestText = jsonText(ManifestCodec.encode(manifest))
        DataSetLoader
            .load(
                DataSetBytes(
                    manifestText,
                    files.getValue("stations.json"),
                    files.getValue("candidates.json"),
                    files.getValue("od.bin"),
                    slots.associate { it.id to files.getValue(slotFiles.getValue(it)) },
                ),
            ).also { DataSetLoader.lastTrains(it, files.getValue(LT_FILE)) }
        files.forEach { (name, bytes) -> output.resolve(name).writeBytes(bytes) }
        removeStaleSlotFiles()
        // Newest generation first, the generation-1 pointer last: older readers keep reading the name they know
        // (same data version, same files, without the parts they do not understand).
        output.resolve(ManifestNames.GENERATION_THREE).writeText(manifestText)
        output.resolve(ManifestNames.GENERATION_TWO).writeText(jsonText(ManifestCodec.encode(manifest.generationTwo())))
        output.resolve(ManifestNames.GENERATION_ONE).writeText(jsonText(ManifestCodec.encode(manifest.generationOne())))
        println(
            "Published dev artifacts: ${files.values.sumOf { it.size }} bytes; SEO ${files.getValue(
                "seo-pairs.json",
            ).size} bytes",
        )
    }

    private fun manifest(
        version: String,
        generatedAt: String,
    ) = Manifest(
        MANIFEST_SCHEMA_VERSION,
        MANIFEST_SCHEMA_VERSION,
        version,
        previousDataVersion = previous?.dataVersion,
        generatedAt = generatedAt,
        registryVersion = net.registry.registryVersion,
        timeModel = "slot-half-headway",
        originCount = od.originCount,
        candidateCount = od.candidateCount,
        files =
            ManifestFiles(
                receipt("stations.json"),
                receipt("candidates.json"),
                receipt("od.bin"),
                receipt("seo-pairs.json"),
                slots.associate { it.id to receipt(slotFiles.getValue(it)) },
                receipt(LT_FILE),
            ),
        lastTrainAsOf = lastTrains.asOf,
        lastTrainModel = lastTrains.model,
        lastTrainPartialDays = lastTrains.partialDays,
    )

    private fun receipt(name: String): ManifestFile =
        files.getValue(name).let {
            ManifestFile(
                name,
                Sha256.hex(it),
                it.size.toLong(),
            )
        }

    /** Slot files no longer referenced (content now shared) must not linger next to the manifest. */
    private fun removeStaleSlotFiles() =
        output
            .toFile()
            .listFiles { file -> file.name.startsWith("od-") && file.name.endsWith(".bin") && file.name !in files }
            .orEmpty()
            .forEach { it.delete() }

    private fun unchanged(): Boolean {
        if (!output.resolve(ManifestNames.GENERATION_THREE).exists()) return false
        if (previous?.lastTrainAsOf != lastTrains.asOf || previous.lastTrainModel != lastTrains.model) return false
        if (previous.lastTrainPartialDays != lastTrains.partialDays) return false
        val old = previous.files
        if (old.odSlots?.mapValues { it.value.path } !=
            slots.associate { it.id to slotFiles.getValue(it) }
        ) {
            return false
        }
        val receipts =
            mapOf(
                "stations.json" to old.registry,
                "candidates.json" to old.candidates,
                "od.bin" to old.od,
                "seo-pairs.json" to old.seoPages,
                LT_FILE to old.lastTrain,
            ) + slots.associate { slotFiles.getValue(it) to old.odSlots?.get(it.id) }
        return files.all { (name, bytes) ->
            val path = output.resolve(name)
            receipts[name]?.matches(bytes) == true && path.exists() && path.readBytes().contentEquals(bytes)
        }
    }

    private fun writeGlyphs() {
        val glyphs =
            (
                net.registry.stations.joinToString("") { it.name } +
                    root.resolve("data/config/og-copy.txt").readText()
            ).filter { !it.isISOControl() }
                .toSet()
                .sorted()
                .joinToString("")
        output.resolve("og-glyphs.txt").writeText(glyphs + "\n")
    }
}
