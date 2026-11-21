package app.banbanyeok.pipeline.lasttrain.input

import app.banbanyeok.pipeline.lasttrain.model.LtFetchedFile
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorBaseline
import app.banbanyeok.pipeline.lasttrain.model.LtReviewedNotice
import app.banbanyeok.pipeline.parseObject
import app.banbanyeok.pipeline.text
import app.banbanyeok.schema.Sha256
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.readText

// The reviewed baseline of the 신분당선 operator's pages (#100 re-review): an allowlist. A page is read only when
// everything but its minutes is what a person looked at, and the notice list only when its newest notice is the one a
// person looked at. Anything else, however harmless, waits for a person.

private val DOT = setOf(RegexOption.DOT_MATCHES_ALL)
private val VIEW_COUNT = Regex("""(<th scope="row">\s*조회수\s*</th>\s*<td[^>]*>)(.*?)(</td>)""", DOT)

/** The minute cells of a station page: the only parts of it that may change without a person looking at it. */
private val MINUTE_CELL = Regex("""(<td class="a[rl]">)(.*?)(</td>)""", DOT)

/**
 * A station page with its minute cells emptied and its blanks normalized: everything else (the markup, the tabs,
 * captions, heads, the hour column, the number of tables and bodies, any legend or note anywhere) as it is. The
 * reviewed baseline keeps the SHA-256 of this ([shinbundangPageFingerprint]); a page whose skeleton differs is not
 * read until a person has looked at it. All 16 pages fetched on 2026-11-21 have the same skeleton.
 */
internal fun shinbundangSkeleton(html: String): String =
    html
        .replace(MINUTE_CELL, "$1{minutes}$3")
        .replace(Regex("\\s+"), " ")
        .replace(Regex(">\\s+<"), "><")
        .trim()

internal fun shinbundangPageFingerprint(html: String): String = Sha256.hex(shinbundangSkeleton(html).toByteArray())

/**
 * A notice page with its blanks normalized and its view count (조회수, which grows with every visit) emptied. The
 * newest notice's fingerprint covers its "이전 글이 없습니다" cell: any newer notice in the list changes it.
 */
internal fun shinbundangNoticeFingerprint(html: String): String {
    // The view count is the one value left out, and only when it is a count: digits and nothing else. Anything else
    // in that cell ("2476 · 정정일 …") is a notice the reader does not know.
    VIEW_COUNT.findAll(html).forEach { cell ->
        require(Regex("""\s*[0-9]+\s*""").matches(cell.groupValues[2])) {
            "$SHINBUNDANG_ID: the view count of a notice is not a number: ${cell.groupValues[2].trim()}"
        }
    }
    return Sha256.hex(
        html
            .replace(VIEW_COUNT, "$1$3")
            .replace(Regex("\\s+"), " ")
            .replace(Regex(">\\s+<"), "><")
            .trim()
            .toByteArray(),
    )
}

/** Counts of a page's structure, for the baseline's summary (no text of the page). */
internal fun shinbundangStructure(html: String): Map<String, Int> =
    listOf("dt", "dd", "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "p", "div", "span")
        .associateWith { tag -> Regex("<$tag[\\s>]").findAll(html).count() }

/** The pages as fetched, before anything is parsed: what the baseline is compared with first. */
internal class ShinbundangRaw(
    val pages: List<Pair<LtFetchedFile, String>>,
    val notices: List<Pair<LtFetchedFile, String>>,
) {
    val pageFingerprints: Map<String, String>
        get() =
            pages.associate { (file, html) ->
                file.file.substringAfterLast('/').removeSuffix(".html") to shinbundangPageFingerprint(html)
            }

    val noticeFingerprints: Map<String, String>
        get() =
            notices.associate { (file, html) ->
                file.url.substringAfter("viewNo=") to
                    shinbundangNoticeFingerprint(html)
            }

    /** The distinct structure counts of the pages, for the baseline's summary. */
    val structure: List<Map<String, Int>> get() = pages.map { shinbundangStructure(it.second) }.distinct()
}

/** The reviewed baseline of the operator's pages (null when there is none: nothing is then read or switched on). */
internal fun readShinbundangBaseline(
    root: Path,
    path: String,
): LtOperatorBaseline? {
    val file = root.resolve(path)
    if (!file.exists()) return null
    val data = parseObject(file.readText())
    val notice = data.getValue("latestNotice").jsonObject
    return LtOperatorBaseline(
        data.text("receipt"),
        data.text("reviewedOn"),
        data.getValue("pageSkeleton").jsonObject.mapValues { it.value.jsonPrimitive.content },
        LtReviewedNotice(
            notice.text("viewNo"),
            notice.text("title"),
            notice.text("fingerprint"),
            notice.text("sha256"),
        ),
    )
}
