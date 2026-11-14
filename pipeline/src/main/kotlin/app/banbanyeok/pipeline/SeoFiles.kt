package app.banbanyeok.pipeline

import app.banbanyeok.schema.Manifest
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.StationStatus
import java.nio.file.Path
import kotlin.io.path.readBytes
import kotlin.io.path.readText

internal fun readSeoHubs(
    root: Path,
    registry: Registry,
): List<String> {
    val names = csv(root.resolve("data/config/seo-hubs.csv").readText()).drop(1).map { it[0] }
    require(names.size == names.distinct().size) { "Duplicate SEO hub names" }
    return names.map { name ->
        registry.stations
            .single {
                it.status == StationStatus.ACTIVE && it.name == name &&
                    it.sources.keys.any { key -> key.startsWith("kric:서울교통공사:") }
            }.code
    }
}

internal fun validateSeo(
    root: Path,
    registry: Registry,
    od: OdMatrix,
    manifest: Manifest,
) {
    val receipt = requireNotNull(manifest.files.seoPages) { "Manifest is missing SEO pairs receipt" }
    val bytes = root.resolve("data/artifacts/dev").resolve(receipt.path).readBytes()
    require(receipt.matches(bytes)) { "SEO pairs hash/size mismatch" }
    require(
        parseObject(bytes.toString(Charsets.UTF_8)) ==
            seoPairs(
                registry,
                od,
                readSeoHubs(root, registry),
                manifest.dataVersion,
            ),
    ) { "SEO pairs differ from shared rank/reason computation or manifest version" }
}
