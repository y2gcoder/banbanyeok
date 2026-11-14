package app.banbanyeok.pipeline

import app.banbanyeok.schema.CandidateList
import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.Manifest
import app.banbanyeok.schema.ManifestCodec
import app.banbanyeok.schema.ManifestFile
import app.banbanyeok.schema.ManifestFiles
import app.banbanyeok.schema.OdBinCodec
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.RegistryCodec
import app.banbanyeok.schema.StationCode
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

internal fun publish(
    root: Path,
    net: Network,
    candidates: CandidateList,
    matrix: Pair<IntArray, IntArray>,
    clock: Clock = Clock.systemUTC(),
) {
    val od =
        OdMatrix(
            net.registry.registryVersion,
            net.origins.map { StationCode.parse(it.code).value }.toIntArray(),
            candidates.candidates.map { StationCode.parse(it).value }.toIntArray(),
            matrix.first,
            matrix.second,
        )
    ArtifactWriter(root, net, candidates, od, clock).write()
}

private class ArtifactWriter(
    private val root: Path,
    private val net: Network,
    private val candidates: CandidateList,
    private val od: OdMatrix,
    private val clock: Clock = Clock.systemUTC(),
) {
    private val output = root.resolve("data/artifacts/dev").createDirectories()
    private val previous =
        output
            .resolve("manifest.json")
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
        )

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
        val manifest =
            Manifest(
                1,
                1,
                version,
                previousDataVersion = previous?.dataVersion,
                generatedAt = now.toString(),
                registryVersion = net.registry.registryVersion,
                timeModel = "weekday-offpeak-half-headway",
                originCount = od.originCount,
                candidateCount = od.candidateCount,
                files =
                    ManifestFiles(
                        receipt("stations.json"),
                        receipt("candidates.json"),
                        receipt("od.bin"),
                        receipt("seo-pairs.json"),
                    ),
            )
        val manifestText = jsonText(ManifestCodec.encode(manifest))
        DataSetLoader.load(
            manifestText,
            files.getValue("stations.json"),
            files.getValue("candidates.json"),
            files.getValue("od.bin"),
        )
        files.forEach { (name, bytes) -> output.resolve(name).writeBytes(bytes) }
        output.resolve("manifest.json").writeText(manifestText)
        println(
            "Published dev artifacts: ${files.values.sumOf { it.size }} bytes; SEO ${files.getValue(
                "seo-pairs.json",
            ).size} bytes",
        )
    }

    private fun receipt(name: String): ManifestFile =
        files.getValue(name).let {
            ManifestFile(
                name,
                app.banbanyeok.schema.Sha256
                    .hex(it),
                it.size.toLong(),
            )
        }

    private fun unchanged(): Boolean {
        val old = previous?.files ?: return false
        val receipts =
            mapOf(
                "stations.json" to old.registry,
                "candidates.json" to old.candidates,
                "od.bin" to old.od,
                "seo-pairs.json" to old.seoPages,
            )
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
