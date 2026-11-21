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
import app.banbanyeok.pipeline.lasttrain.input.ShinbundangFetch
import app.banbanyeok.pipeline.lasttrain.input.ltOperatorInputsDigest
import app.banbanyeok.pipeline.lasttrain.input.ltOperatorRunInProgress
import app.banbanyeok.pipeline.lasttrain.input.parseShinbundangRaw
import app.banbanyeok.pipeline.lasttrain.input.readLastTrainInputs
import app.banbanyeok.pipeline.lasttrain.input.readShinbundangBaseline
import app.banbanyeok.pipeline.lasttrain.input.readShinbundangRaw
import app.banbanyeok.pipeline.lasttrain.input.shinbundangTimetableTitle
import app.banbanyeok.pipeline.lasttrain.model.LtFetchedFile
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorBaseline
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorBundle
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorReceiptFiles
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorSource
import app.banbanyeok.pipeline.lasttrain.model.LtReviewedNotice
import app.banbanyeok.pipeline.lasttrain.model.ltSampleDigest
import app.banbanyeok.pipeline.lasttrain.output.commitFiles
import app.banbanyeok.pipeline.lasttrain.output.manifestText
import app.banbanyeok.pipeline.lasttrain.output.officialSamplesText
import app.banbanyeok.pipeline.lasttrain.output.operatorBaselineText
import app.banbanyeok.pipeline.lasttrain.output.operatorReceiptJson
import app.banbanyeok.pipeline.lasttrain.output.removeOperatorReceipt
import app.banbanyeok.pipeline.lasttrain.output.withOperatorLock
import app.banbanyeok.pipeline.lasttrain.output.writeLastTrainReport
import app.banbanyeok.pipeline.lasttrain.output.writeOracleProblem
import app.banbanyeok.schema.DataSet
import app.banbanyeok.schema.Sha256
import java.nio.file.Path
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.UUID

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
        requireNoOperatorRun(context)
        val operatorInputs = ltOperatorInputsDigest(context.root)
        val lastTrains =
            compileLastTrains(
                readLastTrainInputs(context.root, context.input),
                context.net,
                parts.candidates.candidates,
            )
        // The operator evidence must be what it was when it was read: a sample or baseline run in between makes the
        // switches of this build meaningless (#100 fourth review), so it stops instead of publishing them.
        requireNoOperatorRun(context)
        require(ltOperatorInputsDigest(context.root) == operatorInputs) {
            "The operator evidence (S8 receipt, samples, baseline or raw pages) changed during the build; build again"
        }
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
        requireNoOperatorRun(context)
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

private fun requireNoOperatorRun(context: StageContext) =
    require(!ltOperatorRunInProgress(context.root)) {
        "A sample or baseline run holds the operator files' lock; build when it has finished"
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
 * ones in the reviewed baseline. One run at a time ([withOperatorLock]). It writes one **bundle**: the family's sample
 * rows, the baseline (marked with the run) and the receipt (naming the run, the rows' digest and the baseline's
 * digest), staged in a folder of their own and moved into place together, the receipt last. The build switches the
 * line on only when all three match (`ltEvidenceReasons`), so a run that stops, dies or is overtaken leaves it off
 * whatever it did or did not remove. It removes the old receipt first all the same. Run `build` afterwards.
 */
internal fun shinbundangSamples(root: Path) =
    withOperatorLock(root) {
        removeOperatorReceipt(root, SHINBUNDANG_ID)
        println("$SHINBUNDANG_ID: receipt removed; a new one comes only with a complete bundle of this run")
        try {
            makeShinbundangBundle(root)
        } catch (stop: IllegalArgumentException) {
            throw IllegalStateException(
                "$SHINBUNDANG_ID: ${stop.message}. No receipt was written: 신분당 is switched off at the next build " +
                    "until a person looks at the pages, runs shinbundang-baseline and this command again " +
                    "(docs/setup/w21-notes.md §5)",
                stop,
            )
        }
    }

private fun makeShinbundangBundle(root: Path) {
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
    val reviewed = fetch.notices.single { it.url.endsWith("viewNo=${baseline.latestNotice.viewNo}") }
    val run = "${Instant.now().truncatedTo(ChronoUnit.SECONDS)}-${UUID.randomUUID().toString().take(8)}"
    val samplesText = officialSamplesText(root, fetch.timetable.family, samples)
    // The reviewed notice as this fetch saw it (same fingerprint; its view count may differ), marked with this run.
    val baselineText =
        operatorBaselineText(
            baseline.copy(latestNotice = baseline.latestNotice.copy(sha256 = reviewed.sha256)),
            raw.structure,
            run,
        )
    val bundle =
        LtOperatorBundle(
            run,
            ltSampleDigest(samplesText, fetch.timetable.family),
            SHINBUNDANG_BASELINE,
            Sha256.hex(baselineText.toByteArray()),
        )
    val receipt = shinbundangReceipt(fetch, latest, bundle)
    commitFiles(
        root,
        listOf(
            "data/config/last-train-official.csv" to samplesText,
            SHINBUNDANG_BASELINE to baselineText,
            "data/config/source-manifest.json" to manifestText(root, SHINBUNDANG_ID, receipt),
        ),
    )
    println(
        "$SHINBUNDANG_ID: run $run, ${samples.size} samples of ${fetch.timetable.family} from ${fetch.pages.size} " +
            "reviewed pages fetched on $fetchedOn; latest timetable change $latest",
    )
}

/** The S8 receipt of [fetch], bound to [bundle]. */
private fun shinbundangReceipt(
    fetch: ShinbundangFetch,
    latest: String,
    bundle: LtOperatorBundle,
) = operatorReceiptJson(
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
        bundle,
    ),
)

/**
 * `shinbundang-baseline`: after a person has looked at the fetched pages and notices, records them as the reviewed
 * baseline (fingerprints and structure counts only). The pages must still be readable and give samples. The new
 * baseline belongs to no sample run, so no receipt matches it: `shinbundang-samples` must run again before 신분당 is
 * switched on (it removes the old receipt too).
 */
internal fun shinbundangBaseline(root: Path) =
    withOperatorLock(root) {
        removeOperatorReceipt(root, SHINBUNDANG_ID)
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
        commitFiles(root, listOf(SHINBUNDANG_BASELINE to operatorBaselineText(baseline, raw.structure, null)))
        println(
            "$SHINBUNDANG_ID: baseline of ${fetch.pages.size} pages " +
                "(${fetch.pageFingerprints.values.distinct().size} skeletons) and notice ${newest.first.viewNo} " +
                "written to $SHINBUNDANG_BASELINE; receipt " +
                "$SHINBUNDANG_ID removed, run shinbundang-samples next",
        )
    }
