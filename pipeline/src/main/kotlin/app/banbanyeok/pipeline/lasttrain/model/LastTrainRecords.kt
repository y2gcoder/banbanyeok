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
    val reviewed: Map<String, LtNoticeLink> = emptyMap(),
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
    val newestNotice: LtNoticeLink? = null,
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

/** The newest notice at the review: its number, title, the fingerprint the reader compares and its raw SHA-256. */
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
    /** Official samples made from the pages. */
    val rows: Int,
)
