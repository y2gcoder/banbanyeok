package app.banbanyeok.pipeline.lasttrain.model

import app.banbanyeok.schema.DayType

/** One stop of one train in the operator's file. Times are service-day seconds, -1 when the file has none. */
internal data class OfficialRow(
    val line: String,
    val station: String,
    val day: DayType,
    /** Unique within a day: line, direction, train code, first and last station. */
    val train: String,
    val arrival: Int,
    val departure: Int,
    val terminal: String,
)

/** One row of data/config/last-train-official.csv: a last direct train read from the operator's own timetable. */
internal data class LtOfficialSample(
    val meeting: String,
    val home: String,
    val day: DayType,
    /** Minute of the service day as the operator publishes it. */
    val minute: Int,
    val bound: String,
    val family: String,
    val url: String,
    val checkedAt: String,
)

/** One row of data/config/last-train-ceilings.csv: a cell that must never show a time later than the operator's. */
internal data class LtCeiling(
    val meeting: String,
    val home: String,
    val day: DayType,
    val notAfter: Int,
    val url: String,
    val checkedAt: String,
)

/**
 * The operator's own published timetable as checks on the table: samples that must match and ceilings it must not
 * pass. [receipts] are the receipts of the exact families' timetables (family → receipt), [tagoFetchedOn] the Seoul
 * date the TAGO cache (S6) was fetched: an exact family is switched off when the two are too far apart or the
 * operator changed its timetable after TAGO was fetched.
 */
internal class LtOperatorChecks(
    val samples: List<LtOfficialSample>,
    val ceilings: List<LtCeiling>,
    val receipts: Map<String, LtOperatorReceipt> = emptyMap(),
    val tagoFetchedOn: String? = null,
    /** The newest notice a person reviewed, per exact family (from its baseline). */
    val reviewed: Map<String, LtNoticeSeen> = emptyMap(),
    /** The operator evidence of each exact family: a family without it is switched off. */
    val evidence: Map<String, LtOperatorEvidence> = emptyMap(),
)

/**
 * One departure in an operator's station timetable: [minute] of the service day, toward the end of the line
 * ([towardEnd]) or its start, bound for [terminal] (a station name of the line).
 */
internal data class LtOperatorDeparture(
    val day: DayType,
    val towardEnd: Boolean,
    val minute: Int,
    val terminal: String,
)

/** One station page of an operator's timetable (`name` as the registry spells it). */
internal data class LtOperatorStation(
    val code: String,
    val name: String,
    val url: String,
    val departures: List<LtOperatorDeparture>,
)

/** An operator's station timetables of one line family, stations in line order (start first). */
internal data class LtOperatorTimetable(
    val family: String,
    val stations: List<LtOperatorStation>,
)

/** A link from a notice to its neighbour in the operator's notice list. */
internal data class LtNoticeLink(
    val viewNo: String,
    val title: String,
)

/**
 * One notice page of the operator. [effective] is the date a timetable change takes effect, null for a notice that
 * changes no timetable. [newer] is null on the newest notice of the list.
 */
internal data class LtOperatorNotice(
    val viewNo: String,
    val title: String,
    val registered: String,
    val effective: String?,
    val newer: LtNoticeLink?,
    val older: LtNoticeLink?,
)

/**
 * What the receipt of an exact family's operator timetable says: the Seoul date its pages were fetched and the date
 * the operator's latest timetable change took effect (from its notice list, as fetched with the pages).
 */
internal data class LtOperatorReceipt(
    val id: String,
    val fetchedOn: String,
    val latestChange: String,
    /** The notice the receipt's pages say is the newest of the list, null when none does. */
    val newestNotice: LtNoticeSeen? = null,
)

/**
 * A notice as one fetch saw it: number, title and the SHA-256 of the file. The build compares the receipt's newest
 * notice with the baseline's in full: the sample command writes both from the same fetch, after the notice's
 * fingerprint matched the reviewed one, so a receipt from any other fetch does not match.
 */
internal data class LtNoticeSeen(
    val viewNo: String,
    val title: String,
    val sha256: String,
)

/**
 * What a person reviewed of an operator's pages (#100 review: an allowlist, not a list of bad patterns): the
 * fingerprint of every station page with its minute cells left out, and the newest notice of the list then. Pages
 * that differ in anything but their minutes, or a notice list with anything newer, are not used until a person has
 * looked at them and updated this baseline.
 */
internal data class LtOperatorBaseline(
    val receipt: String,
    val reviewedOn: String,
    /** `sb_cd` to the SHA-256 of the page's skeleton (see `shinbundangSkeleton`). */
    val pages: Map<String, String>,
    val latestNotice: LtReviewedNotice,
)

/**
 * The newest notice at the review: its number, title, the fingerprint the reader compares (view count left out) and
 * the SHA-256 of the file as last fetched with that fingerprint (the sample command refreshes it with each fetch).
 */
internal data class LtReviewedNotice(
    val viewNo: String,
    val title: String,
    val fingerprint: String,
    val sha256: String,
)

/** One file of an operator's timetable as fetched by a person, as its receipt records it. */
internal data class LtFetchedFile(
    /** Path from the repository root (git-excluded). */
    val file: String,
    val url: String,
    val sha256: String,
    val bytes: Int,
    /** When the file was written by whoever fetched it (its modification time, UTC). */
    val fetchedAt: String,
)

/** Who publishes an operator timetable fetched by a person, where it is kept and on what terms ([id]: receipt id). */
internal class LtOperatorSource(
    val id: String,
    val operator: String,
    val directory: String,
    val sourceUrl: String,
    val license: String,
)

/** Everything the receipt of an operator timetable fetched by a person records ([pages]: station name to its page). */
internal class LtOperatorReceiptFiles(
    val source: LtOperatorSource,
    val pages: List<Pair<String, LtFetchedFile>>,
    val notices: List<Pair<LtOperatorNotice, LtFetchedFile>>,
    val latestChange: String,
    /** The run that made the bundle, and what the receipt binds of the other files written with it. */
    val bundle: LtOperatorBundle,
)

/**
 * What one run of the sample command binds together (#100 fourth review): the receipt, the family's sample rows of
 * last-train-official.csv and the reviewed baseline are written by the same run, and the build switches the family
 * on only when the receipt's run, sample digest and baseline digest match the files it finds. A mix of runs, a stale
 * receipt, a missing piece: all switch the family off, whatever was or was not removed before.
 */
internal data class LtOperatorBundle(
    val run: String,
    val samples: LtSampleDigest,
    val baselineFile: String,
    val baselineSha256: String,
)

/** The rows of one family in last-train-official.csv: how many, and the SHA-256 of those lines as they are written. */
internal data class LtSampleDigest(
    val rows: Int,
    val sha256: String,
)

/** The [family] rows of last-train-official.csv ([csv] as written: header first, one sample per line). */
internal fun ltSampleDigest(
    csv: String,
    family: String,
): LtSampleDigest {
    val rows = csv.lines().drop(1).filter { it.isNotBlank() && it.split(',').getOrNull(5) == family }
    return LtSampleDigest(
        rows.size,
        app.banbanyeok.schema.Sha256
            .hex(rows.joinToString("") { "$it\n" }.toByteArray()),
    )
}

/** The digest a receipt keeps of its pages and notices: their SHA-256 and file, a line each, in order. */
internal fun ltEvidenceDigest(files: List<Pair<String, String>>): String =
    app.banbanyeok.schema.Sha256
        .hex(files.joinToString("") { (sha, file) -> "$sha  $file\n" }.toByteArray())

/**
 * Everything the build checks an exact family's operator evidence with, read as it is: the receipt and the baseline
 * as JSON (null when missing or not JSON), the baseline file's SHA-256, the family's rows in the samples file, the
 * page files the receipt must list, and the raw files present (path to SHA-256; null when the raw folder is absent,
 * as in CI: then only the committed files are checked).
 */
internal class LtOperatorEvidence(
    val receipt: kotlinx.serialization.json.JsonObject?,
    val baselineFile: LtBaselineFile,
    val samples: LtSampleDigest,
    val expectedPages: List<String>,
    val raw: Map<String, String>?,
) {
    val baseline: kotlinx.serialization.json.JsonObject? get() = baselineFile.json
}

/** The reviewed baseline file as the build finds it: its path, its JSON (null when missing or not JSON), its SHA-256. */
internal data class LtBaselineFile(
    val path: String,
    val json: kotlinx.serialization.json.JsonObject?,
    val sha256: String?,
)

/** The lock of the operator files: held by a sample or baseline run; a build does not start or finish while it exists. */
internal const val LT_OPERATOR_LOCK = "data/config/.operator.lock"

/**
 * Most hours between the first and the last file of one collection (16 pages and the notices). A person fetches them
 * in one sitting (2026-11-21: 14 minutes); notices kept from an earlier sitting next to new pages are not evidence
 * that the newest notice was looked at with them (#100 final review).
 */
internal const val LT_COLLECTION_HOURS = 6L

/** What a file of an operator's raw folder is to the evidence. */
internal enum class LtRawFile {
    /** A station page (`SB001.html`) or a notice (`notice-1358.html`): must be in the receipt, as it is. */
    EVIDENCE,

    /** A file half fetched or saved under a name the reader does not know as evidence (`notice-1359.html.part`). */
    SUSPECT,

    /** Anything else a person keeps beside them (a log, an index page, notes): not evidence, not read. */
    OTHER,
}

private val EVIDENCE_NAME = Regex("""SB[0-9]{3}\.html|notice-[0-9]+\.html""")
private val PARTIAL_NAME = Regex("""(?i)^[.~].*|.*(\.part|\.partial|\.tmp|\.temp|\.crdownload|\.download|\.swp|~)$""")
private val EVIDENCE_LIKE = Regex("""(?i).*(notice|sb[0-9]{3}|viewno).*""")

/** The kind of one file of the raw folder, by its name (the sample command and the build use the same rule). */
internal fun ltRawFile(name: String): LtRawFile =
    when {
        EVIDENCE_NAME.matches(name) -> LtRawFile.EVIDENCE
        PARTIAL_NAME.matches(name) || EVIDENCE_LIKE.matches(name) -> LtRawFile.SUSPECT
        else -> LtRawFile.OTHER
    }

/** Why fetch times (ISO instants) are not of one collection, null when they are. */
internal fun ltCollectionProblem(times: List<String>): String? {
    val instants = times.map { runCatching { java.time.Instant.parse(it) }.getOrNull() ?: return "a fetch time $it" }
    if (instants.isEmpty()) return "no fetch time"
    val hours =
        java.time.Duration
            .between(instants.min(), instants.max())
            .toMinutes() / 60.0
    if (hours <= LT_COLLECTION_HOURS) return null
    return "pages and notices were fetched ${"%.1f".format(java.util.Locale.ROOT, hours)} hours apart, more than " +
        "$LT_COLLECTION_HOURS: not one collection"
}
