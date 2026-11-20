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
private val TABS = listOf("평일" to DayType.WEEKDAY, "주말 및 공휴일" to DayType.HOLIDAY)
private val HEADERS = listOf("신사방면", "시", "광교(경기대)방면")
internal const val SHINBUNDANG_CHANGE_TITLE = "열차운행시각표 변경"
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

/**
 * The minutes of one cell of a station page: tokens like `13` or `13(정자)`, the bracket naming a terminal short of
 * the line's end. Anything else (a mark never seen, a passing or express sign, minutes out of order) stops.
 */
private fun minutes(
    code: String,
    cell: String,
): List<Pair<Int, String?>> {
    val plain = cell.replace(Regex("<font style='color:red;'>([^<]*)</font>"), " $1 ")
    if ('<' in plain || '&' in plain.replace("&nbsp;", "")) stop(code, "unexpected markup in a cell: $cell")
    val tokens =
        plain
            .replace("&nbsp;", " ")
            .trim()
            .split(Regex("\\s+"))
            .filter(String::isNotEmpty)
    val parsed =
        tokens.map { token ->
            val match = Regex("""([0-5][0-9])(?:\(([^()]+)\))?""").matchEntire(token) ?: stop(code, "token $token")
            val mark = match.groupValues[2].ifEmpty { null }
            if (mark != null && mark !in KNOWN_MARKS) stop(code, "unknown bracket mark ($mark)")
            match.groupValues[1].toInt() to mark
        }
    // A marked minute is printed red, an unmarked one is not: a red minute without a bracket is a sign we do not know.
    val red = Regex("<font style='color:red;'>([^<]*)</font>").findAll(cell).map { it.groupValues[1].trim() }.toList()
    if (red.any { !it.endsWith(")") } || red.size != parsed.count { it.second != null }) {
        stop(code, "red minutes without a bracket: $cell")
    }
    if (parsed.zipWithNext().any { (a, b) -> a.first >= b.first }) stop(code, "minutes out of order: $cell")
    return parsed
}

/**
 * One station page (EUC-KR decoded): two tabs, 평일 and 주말 및 공휴일, each a table of hours (05 … 01) with the
 * minutes toward 신사 on the left and toward 광교 on the right. Unmarked trains run to the end of the line.
 */
internal fun parseShinbundangPage(
    code: String,
    name: String,
    html: String,
): LtOperatorStation {
    val tabs =
        Regex("""<dt[^>]*>\s*<a[^>]*><span class="tab_btn_r">([^<]*)</span></a></dt>\s*<dd>(.*?)</dd>""", DOT)
            .findAll(html)
            .map { it.groupValues[1].trim() to it.groupValues[2] }
            .toList()
    if (tabs.map { it.first } != TABS.map { it.first }) stop(code, "tabs ${tabs.map { it.first }}")
    val departures =
        tabs.zip(TABS).flatMap { (tab, known) ->
            val headers = Regex("""<th scope="col"[^>]*>([^<]*)</th>""").findAll(tab.second).map { it.groupValues[1] }
            if (headers.toList().take(3) != HEADERS) stop(code, "headers ${headers.toList()}")
            val body =
                Regex("<tbody>(.*?)</tbody>", DOT).find(tab.second)?.groupValues?.get(1) ?: stop(code, "no tbody")
            val rows =
                Regex("<tr>(.*?)</tr>", DOT)
                    .findAll(body)
                    .map { row ->
                        Regex("<td[^>]*>(.*?)</td>", DOT).findAll(row.groupValues[1]).map { it.groupValues[1] }.toList()
                    }.toList()
            if (rows.isEmpty() || rows.any { it.size != 3 }) stop(code, "a row without three cells")
            val hours =
                rows.map { cells ->
                    val hour = text(cells[1]).toIntOrNull() ?: stop(code, "hour ${cells[1]}")
                    if (hour < 3) hour + 24 else hour
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

/**
 * One notice page: its title, registration date, the date a timetable change takes effect (`시행일자`, only on a
 * notice whose title is a timetable change) and the links to its neighbours in the list.
 */
internal fun parseShinbundangNotice(
    viewNo: String,
    html: String,
): LtOperatorNotice {
    fun field(label: String) =
        Regex("""<th scope="row">$label</th>\s*<td[^>]*>(.*?)</td>""", DOT).find(html)?.groupValues?.get(1)

    fun link(label: String): LtNoticeLink? {
        val cell = field(label) ?: stop("notice $viewNo", "no $label row")
        val match = Regex("""goView\('(\d+)'\)">([^<]*)</a>""").find(cell) ?: return null
        return LtNoticeLink(match.groupValues[1], match.groupValues[2].trim())
    }
    val title = field("제목")?.let(::text) ?: stop("notice $viewNo", "no title")
    val registered = field("등록일")?.let(::text) ?: stop("notice $viewNo", "no registration date")
    val effective =
        Regex("""시행일자 : (\d{4})\.(\d{2})\.(\d{2})\.""").find(html)?.destructured?.let { (y, m, d) -> "$y-$m-$d" }
    if (SHINBUNDANG_CHANGE_TITLE in title &&
        effective == null
    ) {
        stop("notice $viewNo", "a timetable change without 시행일자")
    }
    return LtOperatorNotice(
        viewNo,
        title,
        registered,
        effective.takeIf { SHINBUNDANG_CHANGE_TITLE in title },
        link("이전"),
        link("다음"),
    )
}

private val DOT = setOf(RegexOption.DOT_MATCHES_ALL)

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
