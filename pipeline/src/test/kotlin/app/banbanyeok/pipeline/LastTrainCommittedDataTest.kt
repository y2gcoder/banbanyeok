package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.input.ltCeilings
import app.banbanyeok.pipeline.lasttrain.input.ltOfficialSamples
import app.banbanyeok.pipeline.lasttrain.model.LtConfig
import app.banbanyeok.pipeline.lasttrain.model.ltModel
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.ManifestCodec
import app.banbanyeok.schema.Sha256
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
import kotlin.io.path.readBytes
import kotlin.io.path.readText
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private val repo: Path = Path.of("..")

/**
 * The last-train inputs and outputs that are committed (#92): what the build reads from `data/config` and what it
 * wrote to `data/artifacts/dev`. The raw timetable caches are not committed, so these pin what CI can see.
 */
class LastTrainCommittedDataTest :
    DescribeSpec({
        val config =
            LtConfig(
                parseObject(repo.resolve("data/config/last-train.json").readText()),
                MetroLines(parseObject(repo.resolve("data/config/metro-lines.json").readText())).groups.values.toSet(),
            )

        describe("the committed last-train configuration") {
            it("keepsRebuildingOffAndTheWeekdayAndSaturdayPartial") {
                assertEquals(false, config.rebuild)
                assertEquals(listOf(DayType.WEEKDAY, DayType.SATURDAY), config.partialDays)
                assertEquals((1..9).map { it.toString() }.toSet(), config.secondSourceLines)
                assertEquals(setOf("신분당"), config.exact.getValue(DayType.WEEKDAY))
                assertEquals(emptySet(), config.exact.getValue(DayType.SATURDAY))
                assertEquals(emptySet(), config.tagoGroups.getValue(DayType.SATURDAY))
                assertEquals((1..8).map { it.toString() }.toSet(), config.seoulLines.getValue(DayType.SATURDAY))
            }

            it("readsTheOperatorSamplesAndCeilings") {
                val samples = ltOfficialSamples(repo.resolve("data/config/last-train-official.csv").readText())
                val ceilings = ltCeilings(repo.resolve("data/config/last-train-ceilings.csv").readText())
                assertEquals(95, samples.size)
                assertEquals(3, ceilings.size)
                assertTrue(
                    samples.all { it.url.startsWith("https://") } && ceilings.all { it.url.startsWith("https://") },
                )
            }
        }

        describe("the committed dev artifacts") {
            val dev = repo.resolve("data/artifacts/dev")
            val manifest = ManifestCodec.parse(dev.resolve("manifest.v3.json").readText())
            val report = parseObject(repo.resolve("data/config/last-train-report.json").readText())

            it("holdsTheTableTheManifestReceiptDescribes") {
                val receipt = requireNotNull(manifest.files.lastTrain)
                assertTrue(receipt.matches(dev.resolve(receipt.path).readBytes()))
                assertEquals(receipt.sha256, Sha256.hex(dev.resolve("lt.bin").readBytes()))
            }

            it("saysTheSameInTheReportAndTheManifest") {
                assertEquals(true, report.text("passed").toBoolean())
                assertEquals(ltModel(rebuild = false), manifest.lastTrainModel)
                assertEquals(manifest.lastTrainModel, report.text("model"))
                assertEquals(manifest.lastTrainAsOf, report.text("asOf"))
                assertEquals(config.partialDays.map { it.id }, manifest.lastTrainPartialDays)
                assertEquals(
                    config.partialDays.map { it.id },
                    report.getValue("partialDays").jsonArray.map { it.toString().trim('"') },
                )
                assertEquals(DayType.entries.map { it.id }.toSet(), report.getValue("days").jsonObject.keys)
            }
        }
    })
