package app.banbanyeok.pipeline

import io.kotest.core.spec.style.DescribeSpec
import kotlin.test.assertEquals

/** The `build` and `validate` commands run this list (#92): a new product is a new entry, not an edit of Main. */
class ArtifactStagesTest :
    DescribeSpec({
        describe("the artifact stage list") {
            it("runsTheProductsInTheOrderTheirChecksUsedToRun") {
                assertEquals(listOf("seo-pairs", "travel-matrix", "last-train"), ARTIFACT_STAGES.map { it.name })
            }

            it("nameEveryStageOnce") {
                assertEquals(ARTIFACT_STAGES.size, ARTIFACT_STAGES.map { it.name }.toSet().size)
            }
        }
    })
