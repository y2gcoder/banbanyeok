package app.banbanyeok.pipeline.lasttrain.input

import app.banbanyeok.pipeline.lasttrain.model.LtFetchedFile
import app.banbanyeok.pipeline.lasttrain.model.LtNoticeLink
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorDeparture
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorNotice
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorStation
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorTimetable
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.Sha256
import java.nio.charset.Charset
import java.nio.file.Path
import java.time.temporal.ChronoUnit
import kotlin.io.path.exists
import kotlin.io.path.getLastModifiedTime
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readBytes

// S8: the station timetables of the 신분당선 operator (DX라인), one page per station, and its notices of timetable
// changes. **For comparison only** (operator decision 2026-11-21, on the #64 legal review list): the pages have no
// terms of use (`ALL RIGHTS RESERVED` only), so they are never committed and nothing in lt.bin comes from them. What
// is committed is the last departure of each cell (last-train-official.csv) and this receipt. The pages are fetched
// by a person (one page every 15 s), never by the pipeline: see docs/setup/w21-notes.md §5.

internal const val SHINBUNDANG_ID = "S8"
internal const val SHINBUNDANG_FAMILY = "신분당"
internal const val SHINBUNDANG_DIR = "data/raw/shinbundang"
internal const val SHINBUNDANG_OPERATOR = "신분당선 운영사 DX라인"
private const val SHINBUNDANG_PAGE_URL = "https://www.shinbundang.co.kr/dxline/dxline_time_gy.jsp?sb_cd="
private const val SHINBUNDANG_NOTICE_URL = "https://www.shinbundang.co.kr/notice/notice1_view.jsp?viewNo="
private val EUC_KR: Charset = Charset.forName("EUC-KR")

/** `sb_cd` of each station in line order (신사 first) and the station's name in the registry. */
internal val SHINBUNDANG_STATIONS =
    listOf(
        "신사",
        "논현",
        "신논현",
        "강남",
        "양재",
        "양재시민의숲",
        "청계산입구",
        "판교",
        "정자",
        "미금",
        "동천",
        "수지구청",
        "성복",
        "상현",
        "광교중앙",
        "광교",
    ).mapIndexed { index, name -> "SB${(index + 1).toString().padStart(3, '0')}" to name }

/** The only destinations the pages mark in brackets so far (a train that turns back short of the line's end). */
private val KNOWN_MARKS = setOf("정자")
private val DOT = setOf(RegexOption.DOT_MATCHES_ALL)
private val TABS = listOf("평일" to DayType.WEEKDAY, "주말 및 공휴일" to DayType.HOLIDAY)
private val HEADERS = listOf("신사방면", "시", "광교(경기대)방면")
internal const val SHINBUNDANG_SOURCE_URL =
    "https://www.shinbundang.co.kr/dxline/dxline_time_gy.jsp?sb_cd=SB001 … SB016"
internal const val SHINBUNDANG_LICENSE =
    "이용 조건 표기 없음(사이트 하단 'COPYRIGHT ⓒ DXLINE. ALL RIGHTS RESERVED.'만, 2026-11-21 확인). 대조용으로만 쓴다: " +
        "원문은 커밋하지 않고 칸마다 막차 출발 분·행선지만 last-train-official.csv에 적는다. lt.bin의 값은 TAGO(S6)에서 " +
        "계산한다(2026-11-21 운영자 결정, #64 법률 검토 목록)"

internal fun shinbundangPageUrl(code: String): String = SHINBUNDANG_PAGE_URL + code

internal fun shinbundangNoticeUrl(viewNo: String): String = SHINBUNDANG_NOTICE_URL + viewNo

private fun stop(
    code: String,
    message: String,
): Nothing = throw IllegalArgumentException("$SHINBUNDANG_ID $code: $message; the page is not what the reader knows")

private fun text(html: String): String =
    html
        .replace(Regex("<[^>]*>"), " ")
        .replace("&nbsp;", " ")
        .replace(Regex("\\s+"), " ")
        .trim()

/** Text with every blank removed: titles are compared this way, so `열차 운행시각표` is `열차운행시각표`. */
private fun squeezed(text: String): String = text.replace("&nbsp;", "").replace(Regex("\\s+"), "")

/**
 * Requires that [html] shows no text once [known] parts are taken out: a note, a legend or a remark anywhere the
 * reader does not read ("※ 00시 22분 정자행은 청계산입구역을 통과합니다") may change what a minute means, so it stops.
 */
private fun requireNoText(
    code: String,
    html: String,
    where: String,
    vararg known: Regex,
) {
    val rest =
        known.fold(html.replace(Regex("<!--.*?-->", DOT), " ").replace(Regex("<script[^>]*>.*?</script>", DOT), " ")) {
            acc,
            part,
            ->
            acc.replace(part, " ")
        }
    val shown = text(rest)
    if (shown.isNotEmpty()) stop(code, "text the reader does not know $where: $shown")
}

private val RED = Regex("<font style='color:red;'>([^<]*)</font>")
private val MINUTE = Regex("""([0-5][0-9])(?:\(([^()]+)\))?""")

/**
 * The minutes of one cell of a station page: tokens like `13` or `13(정자)`, the bracket naming a terminal short of
 * the line's end. **Every** red minute must carry a known bracket and no other minute may carry one: a red minute
 * without a bracket, even one sharing its tag with a marked minute (`<font …>10 22(정자)</font>`), is a sign the
 * reader does not know. Anything else (a mark never seen, a passing or express sign, minutes out of order) stops.
 */
private fun minutes(
    code: String,
    cell: String,
): List<Pair<Int, String?>> {
    val pieces = mutableListOf<Pair<String, Boolean>>()
    var at = 0
    RED.findAll(cell).forEach { red ->
        pieces += cell.substring(at, red.range.first) to false
        pieces += red.groupValues[1] to true
        at = red.range.last + 1
    }
    pieces += cell.substring(at) to false
    val parsed =
        pieces.flatMap { (piece, red) ->
            if ('<' in piece || '&' in piece.replace("&nbsp;", "")) stop(code, "unexpected markup in a cell: $cell")
            piece.replace("&nbsp;", " ").trim().split(Regex("\\s+")).filter(String::isNotEmpty).map { token ->
                val match = MINUTE.matchEntire(token) ?: stop(code, "token $token")
                val mark = match.groupValues[2].ifEmpty { null }
                if (mark != null && mark !in KNOWN_MARKS) stop(code, "unknown bracket mark ($mark)")
                if (red && mark == null) stop(code, "a red minute without a bracket ($token): $cell")
                if (!red && mark != null) stop(code, "a bracket not printed red ($token): $cell")
                match.groupValues[1].toInt() to mark
            }
        }
    if (parsed.zipWithNext().any { (a, b) -> a.first >= b.first }) stop(code, "minutes out of order: $cell")
    return parsed
}

private val TAB =
    Regex("""<dt[^>]*>\s*<a[^>]*><span class="tab_btn_r">([^<]*)</span></a></dt>\s*<dd>(.*?)</dd>""", DOT)
private val CAPTION =
    Regex("""역별시간표 (평일|주말) : [가-힣]+방면, 시, 광교\(경기대\)방면, 시간\(분\), 시간\(분\)으로 구성된 표""")

/** One tab's table: its rows of (toward 신사, hour, toward 광교) cells. Everything else in the tab must be known. */
private fun tabRows(
    code: String,
    tab: String,
): List<List<String>> {
    val caption =
        Regex("<caption>(.*?)</caption>", DOT)
            .find(tab)
            ?.groupValues
            ?.get(1)
            ?.let(::text)
    if (caption == null || !CAPTION.matches(caption)) stop(code, "caption $caption")
    val thead = Regex("<thead>(.*?)</thead>", DOT).find(tab)?.groupValues?.get(1) ?: stop(code, "no thead")
    val headers = Regex("""<th scope="col"[^>]*>([^<]*)</th>""").findAll(thead).map { it.groupValues[1] }.toList()
    if (headers != HEADERS + listOf("시간(분)", "시간(분)")) stop(code, "headers $headers")
    requireNoText(code, thead, "in the table head", Regex("""<th scope="col"[^>]*>[^<]*</th>"""))
    val body = Regex("<tbody>(.*?)</tbody>", DOT).find(tab)?.groupValues?.get(1) ?: stop(code, "no tbody")
    // Nothing besides the caption, the column widths, the head and the body: no note before or after the table.
    requireNoText(
        code,
        tab,
        "in a tab",
        Regex("<caption>.*?</caption>", DOT),
        Regex("<thead>.*?</thead>", DOT),
        Regex("<tbody>.*?</tbody>", DOT),
    )
    requireNoText(code, body, "in a table body", Regex("<tr>.*?</tr>", DOT))
    return Regex("<tr>(.*?)</tr>", DOT)
        .findAll(body)
        .map { row ->
            requireNoText(code, row.groupValues[1], "in a row", Regex("<td[^>]*>.*?</td>", DOT))
            Regex("<td[^>]*>(.*?)</td>", DOT).findAll(row.groupValues[1]).map { it.groupValues[1] }.toList()
        }.toList()
}

/**
 * One station page (EUC-KR decoded): two tabs, 평일 and 주말 및 공휴일, each a table of hours (05 … 01) with the
 * minutes toward 신사 on the left and toward 광교 on the right. Unmarked trains run to the end of the line. The page
 * shows nothing else: any text outside the two tables (a legend, a note on a passing train) stops the reader.
 */
internal fun parseShinbundangPage(
    code: String,
    name: String,
    html: String,
): LtOperatorStation {
    val tabs = TAB.findAll(html).map { it.groupValues[1].trim() to it.groupValues[2] }.toList()
    if (tabs.map { it.first } != TABS.map { it.first }) stop(code, "tabs ${tabs.map { it.first }}")
    requireNoText(code, html, "outside the tabs", TAB, Regex("<style[^>]*>.*?</style>", DOT))
    val departures =
        tabs.zip(TABS).flatMap { (tab, known) ->
            val rows = tabRows(code, tab.second)
            if (rows.isEmpty() || rows.any { it.size != 3 }) stop(code, "a row without three cells")
            val hours =
                rows.map { cells ->
                    val hour = text(cells[1]).takeIf { Regex("[0-9]{2}").matches(it) } ?: stop(code, "hour ${cells[1]}")
                    hour.toInt().let { if (it < 3) it + 24 else it }
                }
            if (hours.zipWithNext().any { (a, b) -> b != a + 1 }) stop(code, "hours out of order: $hours")
            rows.zip(hours).flatMap { (cells, hour) ->
                listOf(false to cells[0], true to cells[2]).flatMap { (towardEnd, cell) ->
                    minutes(code, cell).map { (minute, mark) ->
                        val end = if (towardEnd) SHINBUNDANG_STATIONS.last().second else SHINBUNDANG_STATIONS[0].second
                        LtOperatorDeparture(known.second, towardEnd, hour * 60 + minute, mark ?: end)
                    }
                }
            }
        }
    return LtOperatorStation(code, name, shinbundangPageUrl(code), departures)
}

/** Words in a title (blanks removed) that make a notice one about the timetable, which must then say when it applies. */
private val TIMETABLE_WORDS = listOf("시각표", "시간표", "운행", "막차", "첫차", "배차", "증편", "감편", "열차")

/** Whether a notice title, blanks ignored, is about the timetable (and so may change it). */
internal fun shinbundangTimetableTitle(title: String): Boolean = TIMETABLE_WORDS.any { it in squeezed(title) }

/**
 * One notice page: its title, registration date, the date it takes effect (`시행일자`) when it is about the timetable,
 * and the links to its neighbours in the list. A notice about the timetable (by its title, blanks ignored) whose date
 * the reader cannot read stops: that date is what switches the line off.
 */
internal fun parseShinbundangNotice(
    viewNo: String,
    html: String,
): LtOperatorNotice {
    val where = "notice $viewNo"

    fun field(label: String) =
        Regex("""<th scope="row">\s*$label\s*</th>\s*<td[^>]*>(.*?)</td>""", DOT).find(html)?.groupValues?.get(1)

    // A neighbour is either a link to it or the explicit end of the list; anything else stops.
    fun link(label: String): LtNoticeLink? {
        val cell = field(label) ?: stop(where, "no $label row")
        val match = Regex("""goView\(\s*'?(\d+)'?\s*\)[^>]*>(.*?)</a>""", DOT).find(cell)
        if (match != null) return LtNoticeLink(match.groupValues[1], text(match.groupValues[2]))
        if (squeezed(text(cell)) == squeezed("$label 글이 없습니다.") && "goView" !in cell) return null
        stop(where, "the $label row is neither a link nor the end of the list: ${text(cell)}")
    }
    val title = field("제목")?.let(::text) ?: stop(where, "no title")
    val registered = field("등록일")?.let(::text) ?: stop(where, "no registration date")
    // The notice's own text: the rows linking to its neighbours carry their titles, not this notice's.
    val plain = text(html.replace(Regex("""<th scope="row">\s*(이전|다음)\s*</th>\s*<td[^>]*>.*?</td>""", DOT), " "))
    val dates =
        Regex("""시행\s*일자?\s*[:：]\s*(\d{4})\s*[.\-]\s*(\d{1,2})\s*[.\-]\s*(\d{1,2})""")
            .findAll(plain)
            .map { match ->
                val (y, m, d) = match.destructured
                "$y-${m.padStart(2, '0')}-${d.padStart(2, '0')}"
            }.distinct()
            .toList()
    val related = shinbundangTimetableTitle(title)
    if (related && dates.size != 1) stop(where, "a notice about the timetable without one 시행일자 ($dates): $title")
    if (!related && ("시행일" in squeezed(plain) || "시각표" in squeezed(plain))) {
        stop(where, "a notice that mentions the timetable or a date it takes effect under the title: $title")
    }
    return LtOperatorNotice(viewNo, title, registered, dates.singleOrNull()?.takeIf { related }, link("이전"), link("다음"))
}

/** The 16 station pages and the notice pages of S8, as fetched, with the parsed timetable and notices. */
internal class ShinbundangFetch(
    val pages: List<LtFetchedFile>,
    val notices: List<LtFetchedFile>,
    val timetable: LtOperatorTimetable,
    val noticeList: List<LtOperatorNotice>,
)

/** Reads `data/raw/shinbundang/SB001.html` … `SB016.html` and `notice-<viewNo>.html` (git-excluded, never fetched here). */
internal fun readShinbundangPages(root: Path): ShinbundangFetch {
    val dir = root.resolve(SHINBUNDANG_DIR)
    require(dir.exists()) { "$SHINBUNDANG_ID: $SHINBUNDANG_DIR is missing; see docs/setup/w21-notes.md §5" }

    fun fetched(
        path: Path,
        url: String,
    ): Pair<LtFetchedFile, ByteArray> {
        val bytes = path.readBytes()
        val at =
            path
                .getLastModifiedTime()
                .toInstant()
                .truncatedTo(ChronoUnit.SECONDS)
                .toString()
        return LtFetchedFile("$SHINBUNDANG_DIR/${path.name}", url, Sha256.hex(bytes), bytes.size, at) to bytes
    }
    val pages =
        SHINBUNDANG_STATIONS.map { (code, _) ->
            val path = dir.resolve("$code.html")
            require(path.exists()) { "$SHINBUNDANG_ID: $code.html is missing" }
            fetched(path, shinbundangPageUrl(code))
        }
    val notices =
        dir
            .listDirectoryEntries("notice-*.html")
            .sortedBy { it.name }
            .map { fetched(it, shinbundangNoticeUrl(it.name.removePrefix("notice-").removeSuffix(".html"))) }
    val stations =
        pages.zip(SHINBUNDANG_STATIONS).map { (page, station) ->
            parseShinbundangPage(station.first, station.second, String(page.second, EUC_KR))
        }
    val noticeList =
        notices.map { (file, bytes) ->
            parseShinbundangNotice(file.url.substringAfter("viewNo="), String(bytes, EUC_KR))
        }
    return ShinbundangFetch(
        pages.map { it.first },
        notices.map { it.first },
        LtOperatorTimetable(SHINBUNDANG_FAMILY, stations),
        noticeList,
    )
}
