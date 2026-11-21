package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.gate.ltEvidenceReasons
import app.banbanyeok.pipeline.lasttrain.model.LtSampleDigest
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * #100 fourth review: the build switches an exact family on only by one complete bundle of one sample run. Each case
 * changes one thing of a consistent evidence; each must give a reason (and any reason switches the family off).
 */
class LastTrainOperatorEvidenceTest :
    DescribeSpec({
        fun reasons(evidence: app.banbanyeok.pipeline.lasttrain.model.LtOperatorEvidence) =
            ltEvidenceReasons("S8", evidence)

        fun off(
            why: String,
            evidence: app.banbanyeok.pipeline.lasttrain.model.LtOperatorEvidence,
        ) = assertTrue(reasons(evidence).isNotEmpty(), why)

        describe("one bundle of one run") {
            it("switchesOnlyAConsistentBundleOn") {
                assertEquals(emptyList(), reasons(operatorEvidence()))
                assertEquals(emptyList(), reasons(operatorEvidence(raw = EVIDENCE_RAW)))
                assertEquals(listOf("no operator evidence"), ltEvidenceReasons("S8", null))
            }

            it("tellsRunsApart") {
                // The review's case: a new receipt with the samples file of the run before (its rows were 24:10).
                off("old samples, new receipt", operatorEvidence(samples = LtSampleDigest(4, "0".repeat(64))))
                off("a row more or less", operatorEvidence(samples = LtSampleDigest(5, "c".repeat(64))))
                off("no sample at all", operatorEvidence(rows = 0))
                off(
                    "the baseline of another run",
                    operatorEvidence(baseline = { it["lastRun"] = JsonPrimitive("other") }),
                )
                off("a baseline written by a person since", operatorEvidence(baseline = { it.remove("lastRun") }))
                off("another baseline file", operatorEvidence(baselineSha = "9".repeat(64)))
                off("no baseline file", operatorEvidence(baselineSha = null))
                off("a receipt without its run", operatorEvidence(receipt = { it.remove("run") }))
                off("a receipt without its sample digest", operatorEvidence(receipt = { it.remove("samples_sha256") }))
                off("rows written as text", operatorEvidence(receipt = { it["samples_rows"] = JsonPrimitive("4") }))
            }
        }

        describe("a receipt with all its evidence") {
            it("refusesAReceiptStrippedOfItsPages") {
                // The review's case: id, dates and the newest notice kept, the 16 pages and the digest removed.
                off("no pages", operatorEvidence(receipt = { it.remove("pages") }))
                off("no digest", operatorEvidence(receipt = { it.remove("sha256") }))
                off(
                    "15 pages",
                    operatorEvidence(receipt = {
                        it["pages"] =
                            JsonArray(it.getValue("pages").jsonArray.drop(1))
                    }),
                )
                off(
                    "pages out of order",
                    operatorEvidence(receipt = { it["pages"] = JsonArray(it.getValue("pages").jsonArray.reversed()) }),
                )
                off(
                    "a page without its SHA-256",
                    operatorEvidence(receipt = {
                        val pages = it.getValue("pages").jsonArray
                        it["pages"] = JsonArray(listOf(JsonObject(pages[0].jsonObject - "sha256")) + pages.drop(1))
                    }),
                )
                off(
                    "a list the digest does not cover",
                    operatorEvidence(receipt = {
                        val pages = it.getValue("pages").jsonArray
                        val changed = JsonObject(pages[0].jsonObject + ("sha256" to JsonPrimitive("f".repeat(64))))
                        it["pages"] = JsonArray(listOf(changed) + pages.drop(1))
                    }),
                )
            }

            it("needsExactlyTheReviewedNoticeAsTheNewest") {
                fun notice(change: (JsonObject) -> JsonObject) =
                    operatorEvidence(receipt = {
                        it["notices"] =
                            JsonArray(it.getValue("notices").jsonArray.map { n -> change(n.jsonObject) })
                    })
                off("no notice", operatorEvidence(receipt = { it["notices"] = JsonArray(emptyList()) }))
                off("not marked newest", notice { JsonObject(it + ("newest" to JsonPrimitive(false))) })
                off("newest written as text", notice { JsonObject(it + ("newest" to JsonPrimitive("true"))) })
                off("another notice", notice { JsonObject(it + ("viewNo" to JsonPrimitive("1359"))) })
                off(
                    "two newest",
                    operatorEvidence(receipt = {
                        val one = it.getValue("notices").jsonArray
                        it["notices"] = JsonArray(one + one)
                    }),
                )
            }

            it("refusesABaselineStrippedOfItsFingerprints") {
                // The review's case: only the newest notice's number, title and SHA-256 kept.
                off("no skeletons", operatorEvidence(baseline = { it.remove("pageSkeleton") }))
                off(
                    "15 skeletons",
                    operatorEvidence(baseline = {
                        it["pageSkeleton"] = JsonObject(it.getValue("pageSkeleton").jsonObject - "SB016")
                    }),
                )
                off(
                    "no notice fingerprint",
                    operatorEvidence(baseline = {
                        it["latestNotice"] = JsonObject(it.getValue("latestNotice").jsonObject - "fingerprint")
                    }),
                )
                val missing = operatorEvidence()
                off(
                    "a baseline that is not JSON",
                    app.banbanyeok.pipeline.lasttrain.model.LtOperatorEvidence(
                        missing.receipt,
                        missing.baselineFile.copy(json = null),
                        missing.samples,
                        missing.expectedPages,
                        null,
                    ),
                )
            }
        }

        describe("the raw folder when it is there") {
            it("mustHoldExactlyTheFilesTheReceiptLists") {
                // The review's case: the first write of a run failed, the old receipt stayed, the pages had changed.
                val changed = EVIDENCE_RAW + (EVIDENCE_PAGES[0] to "0".repeat(64))
                off("a page changed since the receipt", operatorEvidence(raw = changed))
                off("a page gone", operatorEvidence(raw = EVIDENCE_RAW - EVIDENCE_PAGES[0]))
                off(
                    "a notice fetched but never made into samples",
                    operatorEvidence(raw = EVIDENCE_RAW + ("data/raw/shinbundang/notice-1359.html" to "1".repeat(64))),
                )
            }
        }
    })
