package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.compileLastTrains
import app.banbanyeok.pipeline.lasttrain.compute.ltBaselineDifferences
import app.banbanyeok.pipeline.lasttrain.compute.ltLatestTimetableChange
import app.banbanyeok.pipeline.lasttrain.compute.ltOperatorSamples
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_BASELINE
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_DIR
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_ID
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_LICENSE
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_OPERATOR
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_SOURCE_URL
import app.banbanyeok.pipeline.lasttrain.input.parseShinbundangRaw
import app.banbanyeok.pipeline.lasttrain.input.readLastTrainInputs
import app.banbanyeok.pipeline.lasttrain.input.readShinbundangBaseline
import app.banbanyeok.pipeline.lasttrain.input.readShinbundangRaw
import app.banbanyeok.pipeline.lasttrain.input.shinbundangTimetableTitle
import app.banbanyeok.pipeline.lasttrain.model.LtFetchedFile
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorBaseline
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorReceiptFiles
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorSource
import app.banbanyeok.pipeline.lasttrain.model.LtReviewedNotice
import app.banbanyeok.pipeline.lasttrain.output.removeOperatorReceipt
import app.banbanyeok.pipeline.lasttrain.output.writeLastTrainReport
import app.banbanyeok.pipeline.lasttrain.output.writeOfficialSamples
import app.banbanyeok.pipeline.lasttrain.output.writeOperatorBaseline
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

/** The Seoul day all of [files] were fetched on; stops when they were not fetched on one day. */
private fun fetchDay(files: List<LtFetchedFile>): String =
    requireNotNull(
        files
            .map {
                Instant
                    .parse(it.fetchedAt)
                    .atZone(ZoneId.of("Asia/Seoul"))
                    .toLocalDate()
                    .toString()
            }.distinct()
            .singleOrNull(),
    ) { "$SHINBUNDANG_ID: the pages were not fetched on one Seoul day" }

/**
 * `shinbundang-samples`: makes the 신분당선 official samples (last-train-official.csv) from the operator's station
 * pages a person fetched into `data/raw/shinbundang/` (S8, never fetched here), and writes the S8 receipt.
 *
 * **Only pages a person reviewed are read** (an allowlist): every page's skeleton and the newest notice must be the
 * ones in the reviewed baseline. Whenever it stops (a page or notice that differs, anything the reader does not
 * know), it removes the S8 receipt, so the next `build` switches 신분당 off until a person has looked at the pages
 * and run `shinbundang-baseline`. Run `build` afterwards.
 */
internal fun shinbundangSamples(root: Path) {
    try {
        val baseline =
            requireNotNull(readShinbundangBaseline(root, SHINBUNDANG_BASELINE)) { "no reviewed $SHINBUNDANG_BASELINE" }
        val raw = readShinbundangRaw(root)
        val differences = ltBaselineDifferences(baseline, raw.pageFingerprints, raw.noticeFingerprints)
        require(differences.isEmpty()) { differences.joinToString("; ") }
        val fetch = parseShinbundangRaw(raw)
        val dataset = loadDevArtifacts(root.resolve("data/artifacts/dev"))
        val names = dataset.registry.stations.associate { it.code to it.name }
        val meetings =
            dataset.candidates.candidates
                .map(names::getValue)
                .toSet()
        val fetchedOn = fetchDay(fetch.pages)
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
            "$SHINBUNDANG_ID: ${samples.size} samples of ${fetch.timetable.family} from ${fetch.pages.size} reviewed " +
                "pages fetched on $fetchedOn; latest timetable change $latest",
        )
    } catch (stop: IllegalArgumentException) {
        removeOperatorReceipt(root, SHINBUNDANG_ID)
        throw IllegalStateException(
            "$SHINBUNDANG_ID: ${stop.message}. Receipt $SHINBUNDANG_ID removed from source-manifest.json: 신분당 is " +
                "switched off at the next build until a person looks at the pages, runs shinbundang-baseline " +
                "and this command again (docs/setup/w21-notes.md §5)",
            stop,
        )
    }
}

/**
 * `shinbundang-baseline`: after a person has looked at the fetched pages and notices, records them as the reviewed
 * baseline (fingerprints and structure counts only). The pages must still be readable and give samples.
 */
internal fun shinbundangBaseline(root: Path) {
    val raw = readShinbundangRaw(root)
    val fetch = parseShinbundangRaw(raw)
    ltOperatorSamples(
        fetch.timetable,
        fetch.timetable.stations
            .map { it.name }
            .toSet(),
        "0000-00-00",
    )
    ltLatestTimetableChange(fetch.noticeList, ::shinbundangTimetableTitle)
    val newest = fetch.noticeList.zip(fetch.notices).single { it.first.newer == null }
    val baseline =
        LtOperatorBaseline(
            SHINBUNDANG_ID,
            fetchDay(fetch.pages),
            fetch.pageFingerprints,
            LtReviewedNotice(
                newest.first.viewNo,
                newest.first.title,
                fetch.noticeFingerprints.getValue(newest.first.viewNo),
                newest.second.sha256,
            ),
        )
    writeOperatorBaseline(root, SHINBUNDANG_BASELINE, baseline, raw.structure)
    println(
        "$SHINBUNDANG_ID: baseline of ${fetch.pages.size} pages (${fetch.pageFingerprints.values.distinct().size} " +
            "skeletons) and notice ${newest.first.viewNo} written to $SHINBUNDANG_BASELINE",
    )
}
