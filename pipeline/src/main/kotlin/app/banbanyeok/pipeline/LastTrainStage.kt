package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.compileLastTrains
import app.banbanyeok.pipeline.lasttrain.compute.ltLatestTimetableChange
import app.banbanyeok.pipeline.lasttrain.compute.ltOperatorSamples
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_DIR
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_ID
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_LICENSE
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_OPERATOR
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_SOURCE_URL
import app.banbanyeok.pipeline.lasttrain.input.readLastTrainInputs
import app.banbanyeok.pipeline.lasttrain.input.readShinbundangPages
import app.banbanyeok.pipeline.lasttrain.input.shinbundangTimetableTitle
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorReceiptFiles
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorSource
import app.banbanyeok.pipeline.lasttrain.output.writeLastTrainReport
import app.banbanyeok.pipeline.lasttrain.output.writeOfficialSamples
import app.banbanyeok.pipeline.lasttrain.output.writeOperatorReceipt
import app.banbanyeok.pipeline.lasttrain.output.writeOracleProblem
import app.banbanyeok.schema.DataSet
import java.nio.file.Path
import java.time.Instant
import java.time.ZoneId

/**
 * The last-train table (lt.bin): read the timetables, compute, run the gates, write the report. The computation
 * itself is `lasttrain.compileLastTrains`, which touches no file.
 */
internal object LastTrainStage : ArtifactStage {
    override val name = "last-train"

    override fun build(
        context: StageContext,
        parts: ReleaseParts,
    ) {
        val started = System.nanoTime()
        val lastTrains =
            compileLastTrains(
                readLastTrainInputs(context.root, context.input),
                context.net,
                parts.candidates.candidates,
            )
        writeOracleProblem(context.root, lastTrains)
        writeLastTrainReport(context.root, lastTrains)
        println(
            "Last trains as of ${lastTrains.asOf}: computed and gated in " +
                "${(System.nanoTime() - started) / 1_000_000} ms; gates ${if (lastTrains.passed) "passed" else "FAILED"}",
        )
        require(lastTrains.passed) {
            "Last-train gate failed; no artifacts written. See data/config/last-train-report.json"
        }
        parts.lastTrains = lastTrains
    }

    override fun validate(
        context: StageContext,
        dataset: DataSet,
    ) {
        val lastTrains =
            compileLastTrains(
                readLastTrainInputs(context.root, context.input),
                context.net,
                dataset.candidates.candidates,
            )
        require(lastTrains.passed) { "Last-train gate failed" }
        require(lastTrains.table == loadDevLastTrains(context.root.resolve("data/artifacts/dev"), dataset)) {
            "Artifact last-train table differs from the current timetables; rebuild required"
        }
        require(
            lastTrains.asOf == dataset.manifest.lastTrainAsOf,
        ) { "Artifact last-train date differs; rebuild required" }
        require(lastTrains.partialDays == dataset.manifest.lastTrainPartialDays) {
            "Artifact last-train partial day types differ; rebuild required"
        }
    }
}

/**
 * `shinbundang-samples`: makes the 신분당선 official samples (last-train-official.csv) from the operator's station
 * pages a person fetched into `data/raw/shinbundang/` (S8, never fetched here), and writes the S8 receipt. Stops when
 * a page or the notice list is not what the reader knows. Run `build` afterwards.
 */
internal fun shinbundangSamples(root: Path) {
    val fetch = readShinbundangPages(root)
    val dataset = loadDevArtifacts(root.resolve("data/artifacts/dev"))
    val names = dataset.registry.stations.associate { it.code to it.name }
    val meetings =
        dataset.candidates.candidates
            .map(names::getValue)
            .toSet()
    val fetchedOn =
        fetch.pages
            .map {
                Instant
                    .parse(it.fetchedAt)
                    .atZone(ZoneId.of("Asia/Seoul"))
                    .toLocalDate()
                    .toString()
            }.distinct()
            .singleOrNull()
    requireNotNull(fetchedOn) { "$SHINBUNDANG_ID: the pages were not fetched on one Seoul day" }
    val samples = ltOperatorSamples(fetch.timetable, meetings, fetchedOn)
    val latest = ltLatestTimetableChange(fetch.noticeList, ::shinbundangTimetableTitle)
    writeOfficialSamples(root, fetch.timetable.family, samples)
    writeOperatorReceipt(
        root,
        LtOperatorReceiptFiles(
            LtOperatorSource(
                SHINBUNDANG_ID,
                SHINBUNDANG_OPERATOR,
                SHINBUNDANG_DIR,
                SHINBUNDANG_SOURCE_URL,
                SHINBUNDANG_LICENSE,
            ),
            fetch.timetable.stations
                .map { it.name }
                .zip(fetch.pages),
            fetch.noticeList.zip(fetch.notices),
            latest,
            samples.size,
        ),
    )
    println(
        "$SHINBUNDANG_ID: ${samples.size} samples of ${fetch.timetable.family} from ${fetch.pages.size} pages " +
            "fetched on $fetchedOn; latest timetable change $latest",
    )
}
