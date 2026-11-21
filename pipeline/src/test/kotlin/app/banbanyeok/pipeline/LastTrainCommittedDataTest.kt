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
                assertEquals(311, samples.size)
                assertEquals(3, ceilings.size)
                assertTrue(
                    samples.all { it.url.startsWith("https://") } && ceilings.all { it.url.startsWith("https://") },
                )
            }

            it("holdsTheWholeShinbundangLineFromTheReceiptsPagesButNoSaturday") {
                // #82: 8 meeting stations × 15 other stations × weekday and holiday, made by `shinbundang-samples`
                // from the 16 station pages of receipt S8 (comparison only: the pages themselves are not committed).
                val samples =
                    ltOfficialSamples(repo.resolve("data/config/last-train-official.csv").readText())
                        .filter { it.family == "신분당" }
                assertEquals(240, samples.size)
                assertEquals(240, samples.map { Triple(it.meeting, it.home, it.day) }.toSet().size)
                assertEquals(setOf(DayType.WEEKDAY, DayType.HOLIDAY), samples.map { it.day }.toSet())
                assertEquals(setOf("2026-11-21"), samples.map { it.checkedAt }.toSet())
                assertEquals(mapOf("신분당" to "S8"), config.exactReceipts)
                val receipt =
                    parseObject("""{"r":${repo.resolve("data/config/source-manifest.json").readText()}}""")
                        .getValue("r")
                        .jsonArray
                        .map { it.jsonObject }
                        .single { it.text("id") == "S8" }
                val pages = receipt.getValue("pages").jsonArray.map { it.jsonObject }
                assertEquals(
                    (1..16).map { "data/raw/shinbundang/SB${it.toString().padStart(3, '0')}.html" },
                    pages.map { it.text("file") },
                )
                assertTrue(pages.all { Regex("[0-9a-f]{64}").matches(it.text("sha256")) && "fetched_at" in it })
                // Each sample names the page of its meeting station, one of the receipt's pages.
                assertTrue(pages.map { it.text("source_url") }.containsAll(samples.map { it.url }.toSet()))
                assertEquals("2026-11-06", receipt.text("latest_timetable_change"))
                // The reviewed baseline (#100 re-review): one skeleton for all 16 pages, and the newest notice it names
                // is the one the receipt's pages show as newest. Only fingerprints and counts, no text of the pages.
                assertEquals(mapOf("신분당" to "data/config/shinbundang-baseline.json"), config.exactBaselines)
                val baseline = parseObject(repo.resolve("data/config/shinbundang-baseline.json").readText())
                assertEquals(
                    setOf("receipt", "reviewedOn", "basis", "structure", "pageSkeleton", "latestNotice"),
                    baseline.keys,
                )
                val skeletons = baseline.getValue("pageSkeleton").jsonObject
                assertEquals((1..16).map { "SB${it.toString().padStart(3, '0')}" }, skeletons.keys.toList())
                assertEquals(1, skeletons.values.toSet().size)
                val reviewed = baseline.getValue("latestNotice").jsonObject
                val newest =
                    receipt.getValue("notices").jsonArray.map { it.jsonObject }.single {
                        it.text("newest") ==
                            "true"
                    }
                assertEquals(
                    newest.text("viewNo") to newest.text("title"),
                    reviewed.text("viewNo") to reviewed.text("title"),
                )
                assertEquals(newest.text("sha256"), reviewed.text("sha256"))
                assertEquals("240", receipt.text("rows"))
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

            it("confirmsEveryShinbundangCellWithItsFamilySwitchedOnBothDays") {
                val switches = report.getValue("exactSwitches").jsonArray.map { it.jsonObject }
                assertEquals(
                    listOf("weekday" to true, "holiday" to true),
                    switches.map {
                        it.text("day") to
                            it.text("on").toBoolean()
                    },
                )
                val days = report.getValue("days").jsonObject
                assertEquals(
                    listOf(120, 0, 120),
                    DayType.entries.map {
                        days
                            .getValue(it.id)
                            .jsonObject
                            .text("provenDirectCells")
                            .toInt()
                    },
                )
                assertTrue(report.getValue("official").jsonArray.all { it.jsonObject.text("passed") == "true" })
            }
        }
    })
