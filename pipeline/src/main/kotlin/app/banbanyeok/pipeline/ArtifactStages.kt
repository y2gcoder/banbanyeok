package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.model.LtArtifact
import app.banbanyeok.schema.CandidateList
import app.banbanyeok.schema.DataSet
import app.banbanyeok.schema.TimeSlot
import java.nio.file.Path

/**
 * What every stage reads: the raw inputs and the networks (one per time slot) the products are computed from. They
 * are read when a stage first asks, not before: a check that needs no raw source (the SEO pairs, the control
 * registry) fails with its own message even where the raw caches are missing.
 */
internal class StageContext(
    val root: Path,
) {
    val input: PipelineInput by lazy { readInput(root) }
    val slots: Map<TimeSlot, Network> by lazy { slotNetworks(input) }

    /** The default slot's network (weekday daytime): the registry and the axes come from it. */
    val net: Network by lazy { slots.getValue(TimeSlot.DEFAULT) }
}

/** What a build hands to the release writer ([publish]): each stage fills in its own part. */
internal class ReleaseParts {
    lateinit var candidates: CandidateList
    lateinit var matrices: Map<TimeSlot, Pair<IntArray, IntArray>>
    lateinit var lastTrains: app.banbanyeok.pipeline.lasttrain.model.LtArtifact

    /** The encoded route graph (rg.bin), checked against [matrices] by its gate. */
    lateinit var routeGraph: ByteArray
}

/**
 * One product of the pipeline. `build` computes it and runs its gate (an exception stops the build before anything is
 * published); `validate` recomputes it from the raw sources and requires it to equal the dev artifact set. The
 * commands `build` and `validate` run [ARTIFACT_STAGES] in order, so a new product is a new entry in that list.
 */
internal interface ArtifactStage {
    val name: String

    fun build(
        context: StageContext,
        parts: ReleaseParts,
    )

    fun validate(
        context: StageContext,
        dataset: DataSet,
    )
}

/**
 * The SEO pairs are derived from the default slot's matrix while the release is written (they carry its data
 * version), so there is nothing to build here: only the published file is checked.
 */
internal object SeoPairsStage : ArtifactStage {
    override val name = "seo-pairs"

    override fun build(
        context: StageContext,
        parts: ReleaseParts,
    ) = Unit

    override fun validate(
        context: StageContext,
        dataset: DataSet,
    ) = validateSeo(context.root, dataset.registry, dataset.od, dataset.manifest)
}

/** In running order: the order products are built and the order their checks fail. */
internal val ARTIFACT_STAGES: List<ArtifactStage> =
    listOf(SeoPairsStage, TravelMatrixStage, LastTrainStage, RouteGraphStage)
