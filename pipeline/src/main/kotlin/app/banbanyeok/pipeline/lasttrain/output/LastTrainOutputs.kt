package app.banbanyeok.pipeline.lasttrain.output

import app.banbanyeok.pipeline.jsonText
import app.banbanyeok.pipeline.jsonValue
import app.banbanyeok.pipeline.lasttrain.model.LT_OPERATOR_LOCK
import app.banbanyeok.pipeline.lasttrain.model.LtArtifact
import app.banbanyeok.pipeline.lasttrain.model.LtFetchedFile
import app.banbanyeok.pipeline.lasttrain.model.LtOfficialSample
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorBaseline
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorReceiptFiles
import app.banbanyeok.pipeline.lasttrain.model.ltEvidenceDigest
import app.banbanyeok.pipeline.obj
import app.banbanyeok.pipeline.text
import app.banbanyeok.pipeline.writeJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import kotlin.io.path.createDirectories
import kotlin.io.path.readText
import kotlin.io.path.writeText

/** The report of the gates, the file the `build` command writes beside the artifacts and a human reads. */
internal fun writeLastTrainReport(
    root: Path,
    artifact: LtArtifact,
) {
    root.resolve("data/config/last-train-report.json").writeJson(artifact.report.toString())
}

/** The fixed inputs as computed, for the independent oracle (prototype/last_train.py compare): `build/last-train/problem.json`. */
internal fun writeOracleProblem(
    root: Path,
    artifact: LtArtifact,
) {
    root
        .resolve("build/last-train")
        .createDirectories()
        .resolve("problem.json")
        .writeJson(artifact.oracleProblem.toString())
}

/**
 * `data/config/last-train-official.csv` with the rows of [family] replaced by [samples], every other row kept as it
 * is. The family's rows stay where its first row was (at the top when it had none).
 */
internal fun officialSamplesText(
    root: Path,
    family: String,
    samples: List<LtOfficialSample>,
): String {
    val lines =
        root
            .resolve(SAMPLES_FILE)
            .readText()
            .lines()
            .filter(String::isNotBlank)
    val header = lines.first()
    require(header == "meeting,home,day,time,bound,family,url,checkedAt") { "last-train-official.csv: header $header" }
    val rows = lines.drop(1)
    val first = rows.indexOfFirst { it.split(',')[5] == family }.takeIf { it >= 0 } ?: 0
    val others = rows.filter { it.split(',')[5] != family }
    val ours =
        samples.map { sample ->
            val time = "${(sample.minute / 60).toString().padStart(
                2,
                '0',
            )}:${(sample.minute % 60).toString().padStart(2, '0')}"
            listOf(
                sample.meeting,
                sample.home,
                sample.day.id,
                time,
                sample.bound,
                sample.family,
                sample.url,
                sample.checkedAt,
            ).onEach { require(',' !in it) { "last-train-official.csv: comma in $it" } }
                .joinToString(",")
        }
    val kept = rows.take(first)
    return (listOf(header) + kept + ours + others.drop(kept.size)).joinToString("\n", postfix = "\n")
}

/** A fetched file in a receipt. */
private fun fileJson(
    file: LtFetchedFile,
    vararg extra: Pair<String, Any?>,
): JsonObject =
    obj(
        *extra,
        "file" to file.file,
        "source_url" to file.url,
        "fetched_at" to file.fetchedAt,
        "sha256" to file.sha256,
        "bytes" to file.bytes,
    )

/**
 * The receipt of an operator timetable fetched by a person (one entry of `source-manifest.json`): every page and
 * notice with its SHA-256 and fetch time, the date of the operator's latest timetable change, and the bundle it was
 * written with (run, sample digest, baseline digest). Its `fetched_at` is the earliest page's, its `sha256` the digest
 * of the pages' and notices' hashes in order.
 */
internal fun operatorReceiptJson(receipt: LtOperatorReceiptFiles): JsonObject {
    val files = receipt.pages.map { it.second } + receipt.notices.map { it.second }
    return obj(
        "id" to receipt.source.id,
        "file" to receipt.source.directory,
        "source_url" to receipt.source.sourceUrl,
        "request_body" to null,
        "fetched_at" to receipt.pages.minOf { it.second.fetchedAt },
        "sha256" to ltEvidenceDigest(files.map { it.sha256 to it.file }),
        "bytes" to files.sumOf { it.bytes },
        "content_type" to "text/html; charset=EUC-KR",
        "rows" to receipt.bundle.samples.rows,
        "license" to receipt.source.license,
        "effective_date" to "${receipt.latestChange} (${receipt.source.operator} 공지의 최신 시각표 변경 시행일)",
        "latest_timetable_change" to receipt.latestChange,
        "estimated" to false,
        "run" to receipt.bundle.run,
        "samples_rows" to receipt.bundle.samples.rows,
        "samples_sha256" to receipt.bundle.samples.sha256,
        "baseline_file" to receipt.bundle.baselineFile,
        "baseline_sha256" to receipt.bundle.baselineSha256,
        "pages" to receipt.pages.map { (station, file) -> fileJson(file, "station" to station) },
        "notices" to
            receipt.notices.map { (notice, file) ->
                fileJson(
                    file,
                    "viewNo" to notice.viewNo,
                    "title" to notice.title,
                    "registered" to notice.registered,
                    "effective" to notice.effective,
                    "newest" to (notice.newer == null),
                )
            },
    )
}

/** `source-manifest.json` with receipt [id] replaced by [receipt] (removed when null), every other receipt as it is. */
internal fun manifestText(
    root: Path,
    id: String,
    receipt: JsonObject?,
): String {
    val others =
        Json
            .parseToJsonElement(root.resolve(MANIFEST_FILE).readText())
            .jsonArray
            .map { it.jsonObject }
            .filter { it.text("id") != id }
    return jsonText(jsonValue(others + listOfNotNull(receipt)).toString())
}

/**
 * Removes receipt [id] from `source-manifest.json`. Not what keeps a family off (the build checks the receipt
 * against the files it binds), only a sign that a run started or a baseline changed.
 */
internal fun removeOperatorReceipt(
    root: Path,
    id: String,
) {
    val text = manifestText(root, id, null)
    if (text != root.resolve(MANIFEST_FILE).readText()) commitFiles(root, listOf(MANIFEST_FILE to text))
}

/**
 * The reviewed baseline of an operator's pages: fingerprints and counts of their structure only, never their text
 * (the pages have no terms of use and are not committed). [run] is the sample run that wrote it (null when a person
 * wrote it with `shinbundang-baseline`: no receipt matches it until the samples are made again).
 */
internal fun operatorBaselineText(
    baseline: LtOperatorBaseline,
    structure: List<Map<String, Int>>,
    run: String?,
): String {
    val notice = baseline.latestNotice
    val json =
        obj(
            "receipt" to baseline.receipt,
            "reviewedOn" to baseline.reviewedOn,
            "lastRun" to run,
            "basis" to
                "사람이 운영사 페이지를 보고 확인한 기준(#100 검토, 허용 목록). pageSkeleton은 역 페이지에서 분 칸만 비우고 " +
                "공백을 정규화한 전체(표 구조·머리글·표 제목·범례·주석·tbody 수·표 밖 글자)의 SHA-256이다. latestNotice는 " +
                "그때의 가장 새 공지다(fingerprint는 조회수(숫자만)를 비운 본문의 SHA-256, sha256은 그 지문으로 마지막에 받은 " +
                "파일 그대로). lastRun은 이 파일을 함께 쓴 표본 실행이고, 영수증 ${baseline.receipt}은 같은 실행 id와 이 " +
                "파일의 SHA-256을 적는다. 하나라도 다르면 build가 신분당을 끈다. 사람이 페이지를 보고 shinbundang-baseline으로 " +
                "다시 쓰고 shinbundang-samples를 다시 돌린다(docs/setup/w21-notes.md 5절). 원문은 담지 않는다.",
            "structure" to structure.map { counts -> JsonObject(counts.mapValues { jsonValue(it.value) }) },
            "pageSkeleton" to JsonObject(baseline.pages.toSortedMap().mapValues { jsonValue(it.value) }),
            "latestNotice" to
                obj(
                    "viewNo" to notice.viewNo,
                    "title" to notice.title,
                    "fingerprint" to notice.fingerprint,
                    "sha256" to notice.sha256,
                ),
        )
    return jsonText(json.toString())
}

/**
 * Writes [files] (path below [root] to text) as one bundle: all of them into a new folder of their own first, then
 * each moved over its target in one step, in the order given (the receipt last). A run that dies half way leaves
 * whole files of two runs at worst, which the build tells apart by the digests the receipt binds.
 */
internal fun commitFiles(
    root: Path,
    files: List<Pair<String, String>>,
) {
    val stage = Files.createTempDirectory(root.resolve("data/config"), ".bundle-")
    try {
        val staged =
            files.mapIndexed { index, (target, text) ->
                stage.resolve("$index").also { it.writeText(text) } to root.resolve(target)
            }
        staged.forEach { (from, to) ->
            Files.move(from, to, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        }
    } finally {
        stage.toFile().deleteRecursively()
    }
}

/**
 * Takes the lock of the operator files (`data/config/.operator.lock`): only one sample or baseline run at a time, and
 * no build while one runs. Fails at once when it is held.
 */
internal fun <T> withOperatorLock(
    root: Path,
    body: () -> T,
): T {
    val lock = root.resolve(LT_OPERATOR_LOCK)
    try {
        Files.createFile(lock)
    } catch (held: java.nio.file.FileAlreadyExistsException) {
        throw IllegalStateException(
            "$LT_OPERATOR_LOCK exists: another sample or baseline run is in progress (remove it only if none is)",
            held,
        )
    }
    try {
        return body()
    } finally {
        Files.deleteIfExists(lock)
    }
}

private const val SAMPLES_FILE = "data/config/last-train-official.csv"
private const val MANIFEST_FILE = "data/config/source-manifest.json"
