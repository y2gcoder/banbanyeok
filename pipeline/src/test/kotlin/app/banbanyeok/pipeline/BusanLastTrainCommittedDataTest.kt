package app.banbanyeok.pipeline

import app.banbanyeok.schema.ManifestCodec
import io.kotest.core.spec.style.DescribeSpec
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private val repo: Path = Path.of("..")

/**
 * The committed Busan last-train evidence (#180): the config, the checks and the H1/K2 receipts must switch both
 * operator tables on against the committed B1 and TAGO receipts and the dev last-train date. The raw files are not
 * committed, so this is what CI can see; `busan-preview` recomputes every cell from them.
 */
class BusanLastTrainCommittedDataTest :
    DescribeSpec({
        val evidence = readBusanLtEvidence(repo)
        val config = evidence.config
        val checks = evidence.checks
        val asOf =
            requireNotNull(
                ManifestCodec.parse(repo.resolve("data/artifacts/dev/manifest.v4.json").readText()).lastTrainAsOf,
            )

        describe("the committed Busan last-train evidence") {
            it("switches every operator table on") {
                for (table in config.tables.values) {
                    assertEquals(emptyList(), busanLtTableReasons(table, evidence, asOf), table.id)
                }
            }

            it("checks exactly the configured lines and day types, and agrees somewhere on each") {
                val configured = config.lines.flatMap { (line, rule) -> rule.days.keys.map { it to line } }.toSet()
                assertEquals(configured, checks.keys.map { it.day to it.line }.toSet())
                for ((day, line) in configured) {
                    assertTrue(
                        checks.any { (key, check) ->
                            key.day == day && key.line == line &&
                                check.verdict == "agree"
                        },
                        "$line $day",
                    )
                }
            }

            it("keeps 동해선 Saturday and 부산김해 out") {
                assertTrue(config.lines.keys.none { it == "L48B1" })
                assertTrue(
                    config.lines
                        .getValue("I26K6")
                        .days.keys
                        .none { it.id == "saturday" },
                )
            }
        }
    })
