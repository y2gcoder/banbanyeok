package app.banbanyeok.pipeline

import app.banbanyeok.schema.ManifestNames
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.readBytes
import kotlin.io.path.readText
import kotlin.test.assertEquals

private val repo: Path = Path.of("..")

/**
 * The committed regional generation (ADR-0008): the web turns regions on from the same pointer the deploy turns
 * REGIONAL_ARTIFACTS on from, so the committed station index has regions exactly when the pointer is committed. A
 * committed regional set must read back as the regional server reads it and equal the capital set on the capital axes.
 */
class RegionalArtifactsCommittedTest :
    DescribeSpec({
        val dev = repo.resolve("data/artifacts/dev")
        val pointer = dev.resolve(ManifestNames.REGIONAL)
        val index = Json.parseToJsonElement(repo.resolve("web/src/lib/stations/index.gen.json").readText()).jsonObject

        describe("the committed regional generation") {
            it("is in the web station index exactly when its pointer is committed") {
                assertEquals(pointer.exists(), "regions" in index)
            }

            it("reads back as the regional server reads it and keeps every capital cell") {
                if (pointer.exists()) {
                    val regional = verifyRegionalSet(pointer.readText()) { dev.resolve(it).readBytes() }
                    val capital = loadDevArtifacts(dev)
                    verifyRegionalProjection(capital, requireNotNull(loadDevLastTrains(dev, capital)), regional)
                }
            }
        }
    })
