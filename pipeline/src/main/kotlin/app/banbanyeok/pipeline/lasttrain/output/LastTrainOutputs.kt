package app.banbanyeok.pipeline.lasttrain.output

import app.banbanyeok.pipeline.jsonValue
import app.banbanyeok.pipeline.lasttrain.model.LtArtifact
import app.banbanyeok.pipeline.lasttrain.model.LtFetchedFile
import app.banbanyeok.pipeline.lasttrain.model.LtOfficialSample
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorReceiptFiles
import app.banbanyeok.pipeline.obj
import app.banbanyeok.pipeline.text
import app.banbanyeok.pipeline.writeJson
import app.banbanyeok.schema.Sha256
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
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
 * Replaces the rows of [family] in `data/config/last-train-official.csv` with [samples], keeping every other row as
 * it is. The family's rows stay where its first row was (at the top when it had none).
 */
internal fun writeOfficialSamples(
    root: Path,
    family: String,
    samples: List<LtOfficialSample>,
) {
    val path = root.resolve("data/config/last-train-official.csv")
    val lines = path.readText().lines().filter(String::isNotBlank)
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
    path.writeText((listOf(header) + kept + ours + others.drop(kept.size)).joinToString("\n", postfix = "\n"))
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
 * Writes the receipt [id] of an operator timetable fetched by a person (one entry of `source-manifest.json`): every
 * page and notice with its SHA-256 and fetch time, and the date of the operator's latest timetable change. Its
 * `fetched_at` is the earliest page's, its `sha256` the digest of the pages' and notices' hashes in order.
 */
internal fun writeOperatorReceipt(
    root: Path,
    receipt: LtOperatorReceiptFiles,
) {
    val files = receipt.pages.map { it.second } + receipt.notices.map { it.second }
    val digest = Sha256.hex(files.joinToString("") { "${it.sha256}  ${it.file}\n" }.toByteArray())
    val json =
        obj(
            "id" to receipt.source.id,
            "file" to receipt.source.directory,
            "source_url" to receipt.source.sourceUrl,
            "request_body" to null,
            "fetched_at" to receipt.pages.minOf { it.second.fetchedAt },
            "sha256" to digest,
            "bytes" to files.sumOf { it.bytes },
            "content_type" to "text/html; charset=EUC-KR",
            "rows" to receipt.rows,
            "license" to receipt.source.license,
            "effective_date" to "${receipt.latestChange} (${receipt.source.operator} 공지의 최신 시각표 변경 시행일)",
            "latest_timetable_change" to receipt.latestChange,
            "estimated" to false,
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
    val path = root.resolve("data/config/source-manifest.json")
    val others =
        Json
            .parseToJsonElement(path.readText())
            .jsonArray
            .map { it.jsonObject }
            .filter { it.text("id") != receipt.source.id }
    path.writeJson(jsonValue(others + json).toString())
}
