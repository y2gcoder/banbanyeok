package app.banbanyeok.pipeline.lasttrain.gate

import app.banbanyeok.pipeline.lasttrain.model.LtOperatorEvidence
import app.banbanyeok.pipeline.lasttrain.model.ltEvidenceDigest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant

// #100 fourth review: an exact family is switched on only by one complete, consistent bundle of one sample run. The
// checks below look at the files as they are, so nothing depends on an old receipt having been removed in time: a
// receipt of another run, a samples file or baseline of another run, a list of pages with a gap, a raw folder that
// is not what the receipt describes, all give a reason, and any reason switches the family off.

private val SHA = Regex("[0-9a-f]{64}")

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.int(key: String): Int? =
    (this[key] as? JsonPrimitive)
        ?.takeIf {
            !it.isString
        }?.content
        ?.toIntOrNull()

private fun JsonObject.isTrue(key: String): Boolean =
    (this[key] as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true

private fun JsonObject.objects(key: String): List<JsonObject>? =
    (this[key] as? JsonArray)?.map { it as? JsonObject ?: return null }

/** A fetched file of the receipt: its path, SHA-256, size and fetch time must all be there and well formed. */
private fun fileProblem(file: JsonObject): String? {
    val sha = file.string("sha256")
    return when {
        file.string("file") == null -> {
            "a file without its path"
        }

        sha == null || !SHA.matches(sha) -> {
            "${file.string("file")} without a SHA-256"
        }

        (file.int("bytes") ?: 0) <= 0 -> {
            "${file.string("file")} without its size"
        }

        file.string("fetched_at")?.let { runCatching { Instant.parse(it) }.isSuccess } != true -> {
            "${file.string("file")} without the time it was fetched"
        }

        file.string("source_url")?.startsWith("https://") != true -> {
            "${file.string("file")} without its address"
        }

        else -> {
            null
        }
    }
}

/** What is wrong with the baseline as the build reads it (null when nothing is). */
private fun baselineProblems(
    evidence: LtOperatorEvidence,
    run: String,
): List<String> {
    val baseline =
        evidence.baseline ?: return listOf("the baseline ${evidence.baselineFile.path} is missing or not JSON")
    val skeleton = baseline["pageSkeleton"] as? JsonObject
    val codes = evidence.expectedPages.map { it.substringAfterLast('/').removeSuffix(".html") }
    val notice = baseline["latestNotice"] as? JsonObject
    return listOfNotNull(
        "the baseline was not written by run $run (${baseline.string("lastRun")})".takeIf {
            baseline.string("lastRun") !=
                run
        },
        "the baseline lacks the skeleton of some pages".takeIf {
            skeleton == null || skeleton.keys.sorted() != codes.sorted() ||
                skeleton.values.any { value -> (value as? JsonPrimitive)?.content?.let(SHA::matches) != true }
        },
        "the baseline lacks its reviewed notice".takeIf {
            notice == null || notice.string("viewNo") == null || notice.string("title") == null ||
                notice.string("fingerprint")?.let(SHA::matches) != true ||
                notice.string("sha256")?.let(SHA::matches) != true
        },
    )
}

/** What the receipt says of its own pages and notices that does not hold. */
private fun listProblems(
    evidence: LtOperatorEvidence,
    receipt: JsonObject,
): List<String> {
    val pages = receipt.objects("pages") ?: return listOf("the receipt has no list of pages")
    val notices = receipt.objects("notices") ?: return listOf("the receipt has no list of notices")
    val files = pages + notices
    val newest = notices.filter { it.isTrue("newest") }
    val reviewed = evidence.baseline?.get("latestNotice") as? JsonObject
    val digest = ltEvidenceDigest(files.map { it.string("sha256").orEmpty() to it.string("file").orEmpty() })
    return listOfNotNull(
        "the receipt does not list exactly the ${evidence.expectedPages.size} station pages".takeIf {
            pages.map { page -> page.string("file") } != evidence.expectedPages
        },
        "the receipt lists no notice".takeIf { notices.isEmpty() },
    ) + files.mapNotNull(::fileProblem) +
        listOfNotNull(
            "the receipt's digest of its files does not match the files it lists".takeIf {
                receipt.string("sha256") !=
                    digest
            },
            "the receipt does not name one newest notice".takeIf { newest.size != 1 },
            "the receipt's newest notice is not the reviewed one".takeIf {
                newest.size == 1 && reviewed != null &&
                    listOf("viewNo", "title", "sha256").any { key ->
                        newest.single().string(key) != reviewed.string(key)
                    }
            },
        )
}

/** Raw files that are not what the receipt lists (only when the raw folder is there). */
private fun rawProblems(
    evidence: LtOperatorEvidence,
    receipt: JsonObject,
): List<String> {
    val raw = evidence.raw ?: return emptyList()
    val listed =
        (receipt.objects("pages").orEmpty() + receipt.objects("notices").orEmpty())
            .associate { it.string("file").orEmpty() to it.string("sha256") }
    val changed = listed.filter { (file, sha) -> raw[file] != sha }.keys
    val extra = raw.keys - listed.keys
    return listOfNotNull(
        "raw files differ from the receipt or are missing: ${changed.sorted()}".takeIf { changed.isNotEmpty() },
        "raw files the receipt does not list (fetched but not made into samples): ${extra.sorted()}"
            .takeIf { extra.isNotEmpty() },
    )
}

/**
 * Why an exact family's operator evidence does not switch it on; empty when the receipt, the samples file and the
 * baseline are one bundle of one run, its list of pages and notices is complete and its own, and the raw folder
 * (when there) holds exactly the files the receipt lists.
 */
internal fun ltEvidenceReasons(
    id: String,
    evidence: LtOperatorEvidence?,
): List<String> {
    if (evidence == null) return listOf("no operator evidence")
    val receipt = evidence.receipt ?: return listOf("no receipt $id for the operator's timetable")
    val run = receipt.string("run")?.takeIf { it.isNotBlank() } ?: return listOf("receipt $id names no sample run")
    val bundle =
        listOfNotNull(
            "the samples file does not hold the ${receipt.int(
                "samples_rows",
            )} rows receipt $id was written with".takeIf {
                receipt.int("samples_rows") != evidence.samples.rows || evidence.samples.rows == 0 ||
                    receipt.int("rows") != evidence.samples.rows
            },
            "the samples file's rows are not the ones receipt $id was written with".takeIf {
                receipt.string("samples_sha256") != evidence.samples.sha256
            },
            "the baseline file is not the one receipt $id was written with".takeIf {
                receipt.string("baseline_file") != evidence.baselineFile.path ||
                    evidence.baselineFile.sha256 == null ||
                    receipt.string("baseline_sha256") != evidence.baselineFile.sha256
            },
        )
    return bundle + baselineProblems(evidence, run) + listProblems(evidence, receipt) + rawProblems(evidence, receipt)
}
