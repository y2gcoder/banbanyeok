package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.compute.ltBaselineDifferences
import app.banbanyeok.pipeline.lasttrain.compute.ltLatestTimetableChange
import app.banbanyeok.pipeline.lasttrain.compute.ltOperatorSamples
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_BASELINE
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_STATIONS
import app.banbanyeok.pipeline.lasttrain.input.ltOfficialSamples
import app.banbanyeok.pipeline.lasttrain.input.parseShinbundangNotice
import app.banbanyeok.pipeline.lasttrain.input.parseShinbundangPage
import app.banbanyeok.pipeline.lasttrain.input.readShinbundangBaseline
import app.banbanyeok.pipeline.lasttrain.input.readShinbundangPages
import app.banbanyeok.pipeline.lasttrain.input.readShinbundangRaw
import app.banbanyeok.pipeline.lasttrain.input.shinbundangNoticeFingerprint
import app.banbanyeok.pipeline.lasttrain.input.shinbundangPageFingerprint
import app.banbanyeok.pipeline.lasttrain.input.shinbundangTimetableTitle
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorBaseline
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorTimetable
import app.banbanyeok.pipeline.lasttrain.model.LtReviewedNotice
import app.banbanyeok.pipeline.lasttrain.output.writeOperatorBaseline
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.Sha256
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.charset.Charset
import java.nio.file.Files
import kotlin.io.path.writeBytes
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

// Hand-made fragments in the shape of the operator's station pages (#82). The real pages have no terms of use, so
// none of them is committed: these only copy the markup the reader relies on, with invented minutes.

private val EUC_KR = Charset.forName("EUC-KR")

/** One hour row: minutes toward 신사 (left), the hour, minutes toward 광교 (right). */
private fun row(
    north: String,
    hour: String,
    south: String,
) = """
                <tr>
                	<td class="ar">$north</td>
            	   	<td class="ac time">$hour</td>
                    <td class="al">$south</td>
                </tr>"""

private fun tab(
    label: String,
    rows: List<String>,
    last: Boolean = false,
) = """
    <dt${if (last) " class=\"last\"" else ""}><a href="javascript:tab('tab_d03',0);" class="tab_btn_l"><span class="tab_btn_r">$label</span></a></dt>
    <dd>
        <table class="tb_st01">
        	<caption>역별시간표 ${if (label == "평일") label else "주말"} : 강남방면, 시, 광교(경기대)방면, 시간(분), 시간(분)으로 구성된 표</caption>
            <thead>
            	<tr>
                	<th scope="col">신사방면</th>
                    <th scope="col" rowspan="2">시</th>
                    <th scope="col">광교(경기대)방면</th>
                </tr>
                <tr>
                    <th scope="col">시간(분)</th>
                    <th scope="col">시간(분)</th>
                </tr>
            </thead>
            <tbody>${rows.joinToString("")}
            </tbody>
        </table>
    </dd>"""

private fun page(
    weekday: List<String>,
    holiday: List<String>,
) = """<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1" />
<dl id="tab_d03" class="tab_d01" style="padding-top: 45px;">${tab("평일", weekday)}${tab("주말 및 공휴일", holiday, true)}
</dl>"""

private fun red(minute: String) = "<font style='color:red;'>$minute</font>"

/** A middle station: both ways, a short train to 정자 each way, the last trains after midnight (00 and 01 rows). */
private val MIDDLE =
    page(
        listOf(
            row("30 45", "23", "10 ${red("40(정자)")} 50"),
            row("05", "00", "15 ${red("30(정자)")}"),
            row("", "01", ""),
        ),
        listOf(
            row("10 40", "23", "20 ${red("45(정자)")}"),
            row("", "00", "05"),
            row("", "01", ""),
        ),
    )

private fun station(
    code: String,
    name: String,
    html: String,
) = parseShinbundangPage(code, name, html)

/** A line of four stations: 신사 (start), 양재, 정자 (where short trains turn back) and 광교 (end). */
private fun line(middle: String = MIDDLE): LtOperatorTimetable {
    val start =
        page(
            listOf(row("", "23", "00 30"), row("", "00", "10 ${red("20(정자)")}")),
            listOf(row("", "23", "10"), row("", "00", "")),
        )
    val turn = page(listOf(row("50", "23", ""), row("", "00", "00")), listOf(row("40", "23", "10"), row("", "00", "")))
    val end = page(listOf(row("40", "23", ""), row("10", "00", "")), listOf(row("50", "23", ""), row("", "00", "")))
    return LtOperatorTimetable(
        "신분당",
        listOf(
            station("SB001", "신사", start),
            station("SB005", "양재", middle),
            station("SB009", "정자", turn),
            station("SB016", "광교", end),
        ),
    )
}

class LastTrainOperatorSamplesTest :
    DescribeSpec({
        describe("reading a station page of the operator") {
            it("readsBothTabsBothWaysAndHoursAfterMidnightAsServiceDayMinutes") {
                val middle = station("SB005", "양재", MIDDLE)
                assertEquals("https://www.shinbundang.co.kr/dxline/dxline_time_gy.jsp?sb_cd=SB005", middle.url)
                val weekdaySouth = middle.departures.filter { it.day == DayType.WEEKDAY && it.towardEnd }
                assertEquals(
                    listOf(23 * 60 + 10 to "광교", 23 * 60 + 40 to "정자", 23 * 60 + 50 to "광교", 24 * 60 + 15 to "광교") +
                        listOf(24 * 60 + 30 to "정자"),
                    weekdaySouth.map { it.minute to it.terminal },
                )
                val holidayNorth = middle.departures.filter { it.day == DayType.HOLIDAY && !it.towardEnd }
                assertEquals(
                    listOf(23 * 60 + 10 to "신사", 23 * 60 + 40 to "신사"),
                    holidayNorth.map {
                        it.minute to
                            it.terminal
                    },
                )
                // The page has no Saturday: its 주말 및 공휴일 tab is read as the holiday only.
                assertEquals(setOf(DayType.WEEKDAY, DayType.HOLIDAY), middle.departures.map { it.day }.toSet())
            }

            it("stopsAtAnythingItDoesNotKnow") {
                fun fails(
                    cell: String,
                    hours: List<String> = listOf("23", "00"),
                ) = assertFailsWith<IllegalArgumentException> {
                    station("SB005", "양재", page(hours.map { row(cell, it, "") }, listOf(row("", "23", ""))))
                }
                // A bracket never seen before, even one naming a station of the line.
                fails("10 ${red("20(미금)")}")
                // Passing and express signs.
                fails("10 20통과")
                fails("10 ${red("20(급행)")}")
                fails("10 ↓")
                // A red minute without a bracket, minutes and hours out of order, a row with a missing cell.
                fails("10 ${red("20")}")
                fails("30 20")
                fails("10", listOf("00", "23"))
                fails("10", listOf("22", "00"))
                assertFailsWith<IllegalArgumentException> {
                    station("SB005", "양재", page(listOf("<tr><td>10</td><td>23</td></tr>"), emptyList()))
                }
                // Tabs and headers other than the two the reader knows.
                assertFailsWith<IllegalArgumentException> {
                    station("SB005", "양재", MIDDLE.replace("주말 및 공휴일", "토요일"))
                }
                assertFailsWith<IllegalArgumentException> {
                    station("SB005", "양재", MIDDLE.replace("광교(경기대)방면</th>", "광교방면</th>"))
                }
            }

            it("decodesTheFetchedPagesAsEucKrAndRecordsWhatTheReceiptNeeds") {
                val root = Files.createTempDirectory("sb")
                val dir = root.resolve("data/raw/shinbundang")
                Files.createDirectories(dir)
                val ends = page(listOf(row("", "23", "10")), listOf(row("", "23", "20")))
                SHINBUNDANG_STATIONS.forEach { (code, _) ->
                    dir.resolve("$code.html").writeBytes(MIDDLE.toByteArray(EUC_KR))
                }
                dir.resolve("SB001.html").writeBytes(ends.toByteArray(EUC_KR))
                dir
                    .resolve(
                        "notice-1358.html",
                    ).writeBytes(operatorNotice(CHANGE, "2026.11.06", null, null).toByteArray(EUC_KR))
                val fetch = readShinbundangPages(root)
                assertEquals(16, fetch.pages.size)
                assertEquals("data/raw/shinbundang/SB001.html", fetch.pages.first().file)
                assertEquals(Sha256.hex(ends.toByteArray(EUC_KR)), fetch.pages.first().sha256)
                assertEquals("양재", fetch.timetable.stations[4].name)
                assertTrue(
                    fetch.timetable.stations[4]
                        .departures
                        .any { it.terminal == "정자" },
                )
                assertEquals("1358", fetch.noticeList.single().viewNo)
                assertEquals(
                    "https://www.shinbundang.co.kr/notice/notice1_view.jsp?viewNo=1358",
                    fetch.notices.single().url,
                )
            }
        }

        describe("the last direct train of each cell") {
            val samples = ltOperatorSamples(line(), setOf("신사", "양재"), "2026-11-21")

            fun last(
                meeting: String,
                home: String,
                day: DayType,
            ) = samples.single { it.meeting == meeting && it.home == home && it.day == day }

            it("takesTheLastTrainThatGoesAsFarAsTheHomeStation") {
                fun ride(
                    meeting: String,
                    home: String,
                    day: DayType = DayType.WEEKDAY,
                ) = last(meeting, home, day).let { it.minute to it.bound }
                // 양재 → 광교 weekday: the 24:30 train turns back at 정자, so the last one to 광교 is 24:15.
                assertEquals(24 * 60 + 15 to "광교", ride("양재", "광교"))
                assertEquals(24 * 60 + 30 to "정자", ride("양재", "정자"))
                // 신사 → 양재 and 정자: the 24:20 train to 정자 stops at both and is the last one; not to 광교.
                assertEquals(24 * 60 + 20 to "정자", ride("신사", "양재"))
                assertEquals(24 * 60 + 20 to "정자", ride("신사", "정자"))
                assertEquals(24 * 60 + 10 to "광교", ride("신사", "광교"))
                // Toward the start every train runs to 신사.
                assertEquals(24 * 60 + 5 to "신사", ride("양재", "신사"))
                assertEquals(23 * 60 + 40 to "신사", ride("양재", "신사", DayType.HOLIDAY))
                // Holiday 양재 → 정자: the 24:05 train to 광교 is later than the 23:45 one that turns back there.
                assertEquals(24 * 60 + 5 to "광교", ride("양재", "정자", DayType.HOLIDAY))
            }

            it("givesEveryMeetingStationOfTheLineEveryOtherStationOnBothDays") {
                // Two meeting stations × three other stations × weekday and holiday; 정자 and 광교 are not meetings.
                assertEquals(12, samples.size)
                assertTrue(samples.none { it.meeting == "광교" || it.meeting == "정자" || it.day == DayType.SATURDAY })
                assertTrue(samples.all { it.family == "신분당" && it.checkedAt == "2026-11-21" })
                assertEquals(
                    "https://www.shinbundang.co.kr/dxline/dxline_time_gy.jsp?sb_cd=SB001",
                    last("신사", "광교", DayType.HOLIDAY).url,
                )
            }

            it("stopsWhenAPageIsNotThePageOfItsStation") {
                // An end station page (trains one way only) read as a middle station.
                val swapped =
                    line().let {
                        it.copy(
                            stations =
                                listOf(it.stations[1], it.stations[0]) + it.stations.drop(2),
                        )
                    }
                assertFailsWith<IllegalArgumentException> { ltOperatorSamples(swapped, setOf("신사"), "2026-11-21") }
                // A short terminal behind the train: a 정자 mark on a train toward 신사 from 양재 cannot be.
                val behind =
                    line(MIDDLE.replace("<td class=\"ar\">30 45</td>", "<td class=\"ar\">30 ${red("45(정자)")}</td>"))
                assertFailsWith<IllegalArgumentException> { ltOperatorSamples(behind, setOf("신사"), "2026-11-21") }
            }
        }

        describe("what the reader does not know stops it (#100 review)") {
            fun fails(html: String) = assertFailsWith<IllegalArgumentException> { station("SB001", "신사", html) }

            it("readsTheFixtureItself") {
                // The cases below change one thing of a page the reader accepts.
                assertTrue(station("SB005", "양재", MIDDLE).departures.isNotEmpty())
            }

            it("stopsAtANoteOrALegendAnywhereOnThePage") {
                val passing = "<p>※ 평일 00시 22분 정자행은 청계산입구역을 통과합니다.</p>"
                // Right after the weekday table, where the review put it: the minutes alone look the same.
                fails(MIDDLE.replaceFirst("</table>", "</table>$passing"))
                // Before the table, between the tabs, after the list of tabs.
                fails(MIDDLE.replaceFirst("<table class=\"tb_st01\">", "$passing<table class=\"tb_st01\">"))
                fails(MIDDLE.replaceFirst("</dd>", "</dd>$passing"))
                fails(MIDDLE.replace("</dl>", "</dl>$passing"))
                // Inside the table: a row of one cell, a footer, a note between head and body, a note in a row.
                fails(MIDDLE.replaceFirst("</tbody>", "<tr><td colspan=\"3\">$passing</td></tr></tbody>"))
                fails(MIDDLE.replaceFirst("</tbody>", "</tbody><tfoot><tr><td>$passing</td></tr></tfoot>"))
                fails(MIDDLE.replaceFirst("<tbody>", "<p>※ 급행</p><tbody>"))
                fails(MIDDLE.replaceFirst("<tr>", "<tr><th>※</th>"))
                // A caption other than the one the reader knows.
                fails(MIDDLE.replaceFirst("으로 구성된 표", "으로 구성된 표(급행 포함)"))
            }

            it("stopsAtAnUnmarkedRedMinuteEvenWhenItSharesItsTagWithAMarkedOne") {
                // The review's case: SB001's two red minutes of 00 in one tag. The 10 is red with no bracket.
                fails(MIDDLE.replace("15 ${red("30(정자)")}", red("15 30(정자)")))
                // On its own the same red minute stopped before too; a bracket outside red is not known either.
                fails(MIDDLE.replace("15 ${red("30(정자)")}", "${red("15")} ${red("30(정자)")}"))
                fails(MIDDLE.replace("15 ${red("30(정자)")}", "15 30(정자)"))
            }
        }

        describe("the operator's latest timetable change") {
            fun read(
                viewNo: String,
                html: String,
            ) = parseShinbundangNotice(viewNo, html)

            it("isTheNewestNoticeWhenThatNoticeIsAChange") {
                val newest = read("1358", operatorNotice(CHANGE, "2026.11.06", null, "1357" to DRILL))
                val older = read("1356", operatorNotice(CHANGE, "2026.09.28", "1357" to DRILL, "1347" to "공개검증"))
                assertEquals("2026-11-06", newest.effective)
                assertEquals("2026-11-06", ltLatestTimetableChange(listOf(older, newest), ::shinbundangTimetableTitle))
            }

            it("walksPastNoticesWhoseTitleIsNoChangeToTheLatestChange") {
                // The newest is a drill notice; the one after it (1357) is not fetched but its title is known.
                val newest = read("1359", operatorNotice(DRILL, null, null, "1357" to DRILL))
                val change = read("1356", operatorNotice(CHANGE, "2026.09.28", "1357" to DRILL, null))
                assertEquals(null, newest.effective)
                assertEquals("2026-09-28", ltLatestTimetableChange(listOf(newest, change), ::shinbundangTimetableTitle))
            }

            it("refusesAListWithoutItsNewestNoticeOrWithAChangeNotFetched") {
                val middle = read("1356", operatorNotice(CHANGE, "2026.09.28", "1357" to DRILL, null))
                assertFailsWith<IllegalArgumentException> {
                    ltLatestTimetableChange(
                        listOf(middle),
                        ::shinbundangTimetableTitle,
                    )
                }
                val newest = read("1360", operatorNotice(DRILL, null, null, "1359" to CHANGE))
                assertFailsWith<IllegalArgumentException> {
                    ltLatestTimetableChange(listOf(newest, middle), ::shinbundangTimetableTitle)
                }
                // A change notice without the date it takes effect is not read at all.
                assertFailsWith<IllegalArgumentException> { read("1361", operatorNotice(CHANGE, null, null, null)) }
            }
        }

        describe("notices the reader cannot place stop it (#100 review)") {
            fun read(
                viewNo: String,
                html: String,
            ) = parseShinbundangNotice(viewNo, html)

            it("readsATimetableNoticeWhateverTheBlanksInItsTitle") {
                // The review's case: one blank more after 열차 hid the 11-20 date, and 11-06 was kept.
                listOf("신분당선 열차 운행시각표 변경 시행", "신분당선 열차운행 시각표 변경시행", "신분당선  열차운행시각표\t변경 시행")
                    .forEach { title ->
                        val newest = read("1359", operatorNotice(title, "2026.11.20", null, "1358" to CHANGE))
                        val before = read("1358", operatorNotice(CHANGE, "2026.11.06", "1359" to title, null))
                        assertEquals("2026-11-20", newest.effective, title)
                        assertEquals(
                            "2026-11-20",
                            ltLatestTimetableChange(listOf(before, newest), ::shinbundangTimetableTitle),
                        )
                    }
            }

            it("stopsAtANoticeAboutTheTimetableWithoutADateItCanRead") {
                // Any title about the timetable, blanks ignored, needs one date it takes effect.
                listOf("신분당선 열차 운행 시간표 조정 안내", "막차 연장 운행 안내", "열차운행시각표 변경 시행").forEach { title ->
                    assertFailsWith<IllegalArgumentException>(title) {
                        read("1359", operatorNotice(title, null, null, null))
                    }
                }
                assertFailsWith<IllegalArgumentException> {
                    read("1359", operatorNotice(CHANGE, "2026.11.20", null, null).replace("2026.11.20.", "11월 20일"))
                }
                // A title about something else whose body speaks of a date it takes effect is not one the reader can place.
                assertFailsWith<IllegalArgumentException> {
                    read(
                        "1360",
                        operatorNotice(DRILL, "2026.11.20", null, null),
                    )
                }
            }

            it("takesAnyLinkToANewerNoticeAsANewerNotice") {
                // The review's case: an unquoted javascript:goView(1359) was read as "no newer notice".
                val cell = "<a href=\"javascript:goView(1359)\">$CHANGE (11월 20일)</a>"
                val unquoted =
                    read("1358", operatorNotice(CHANGE, "2026.11.06", null, "1357" to DRILL, newerCell = cell))
                assertEquals("1359", unquoted.newer?.viewNo)
                val older = read("1356", operatorNotice(CHANGE, "2026.09.28", "1357" to DRILL, null))
                assertFailsWith<IllegalArgumentException> {
                    ltLatestTimetableChange(listOf(unquoted, older), ::shinbundangTimetableTitle)
                }
                // Only the explicit end of the list counts as one; anything else in its place stops.
                assertFailsWith<IllegalArgumentException> {
                    read("1358", operatorNotice(CHANGE, "2026.11.06", null, null, newerCell = "<a href=\"#\">새 공지</a>"))
                }
                assertFailsWith<IllegalArgumentException> {
                    read("1358", operatorNotice(CHANGE, "2026.11.06", null, null, newerCell = ""))
                }
            }

            it("stopsWhenTheNeighboursDoNotLinkBack") {
                val newest = read("1358", operatorNotice(DRILL, null, null, "1356" to CHANGE))
                val other = read("1356", operatorNotice(CHANGE, "2026.09.28", "1350" to DRILL, null))
                assertFailsWith<IllegalArgumentException> {
                    ltLatestTimetableChange(listOf(newest, other), ::shinbundangTimetableTitle)
                }
            }
        }

        describe("only pages and notices a person reviewed are read (#100 re-review: an allowlist)") {
            val ends = page(listOf(row("", "23", "10")), listOf(row("", "23", "20")))
            val newest = operatorNotice(CHANGE, "2026.11.06", null, "1357" to DRILL)

            /** A fetched set in [root]: 16 pages (SB001 an end page, the rest [MIDDLE]) and notice 1358. */
            fun fetched(
                root: java.nio.file.Path,
                pages: Map<String, String> = emptyMap(),
                notices: Map<String, String> = mapOf("1358" to newest),
            ) {
                val dir = root.resolve("data/raw/shinbundang")
                Files.createDirectories(dir)
                dir.toFile().listFiles()?.forEach { it.delete() }
                SHINBUNDANG_STATIONS.forEach { (code, _) ->
                    val html = pages[code] ?: if (code == "SB001") ends else MIDDLE
                    dir.resolve("$code.html").writeBytes(html.toByteArray(EUC_KR))
                }
                notices.forEach { (no, html) -> dir.resolve("notice-$no.html").writeBytes(html.toByteArray(EUC_KR)) }
            }

            /** The baseline of the set [fetched] writes with no changes, as `shinbundang-baseline` would record it. */
            fun reviewed(): LtOperatorBaseline {
                val root = Files.createTempDirectory("sb-reviewed")
                fetched(root)
                val raw = readShinbundangRaw(root)
                return LtOperatorBaseline(
                    "S8",
                    "2026-11-21",
                    raw.pageFingerprints,
                    LtReviewedNotice("1358", CHANGE, raw.noticeFingerprints.getValue("1358"), "-"),
                )
            }
            val baseline = reviewed()

            fun differences(
                pages: Map<String, String> = emptyMap(),
                notices: Map<String, String> = mapOf("1358" to newest),
            ): List<String> {
                val root = Files.createTempDirectory("sb-fetched")
                fetched(root, pages, notices)
                val raw = readShinbundangRaw(root)
                return ltBaselineDifferences(baseline, raw.pageFingerprints, raw.noticeFingerprints)
            }

            it("acceptsThePagesItReviewedWithOtherMinutesAndAnotherViewCount") {
                assertEquals(emptyList(), differences())
                // Minutes change at every revision: the skeleton does not.
                val other = MIDDLE.replace("10 ${red("40(정자)")} 50", "12 ${red("41(정자)")} 55")
                assertEquals(emptyList(), differences(pages = mapOf("SB005" to other)))
                assertEquals(shinbundangPageFingerprint(MIDDLE), shinbundangPageFingerprint(other))
                // The view count of a notice grows with every visit.
                val viewed =
                    newest.replace(
                        "<tr><th scope=\"row\">등록일</th>",
                        "<tr><th scope=\"row\">조회수</th><td>1</td></tr><tr><th scope=\"row\">등록일</th>",
                    )
                val more = viewed.replace("<td>1</td>", "<td>2476</td>")
                assertEquals(shinbundangNoticeFingerprint(viewed), shinbundangNoticeFingerprint(more))
            }

            it("refusesAPageThatChangedAnywhereButItsMinutes") {
                val passing = "※ 평일 00시 22분 정자행은 청계산입구역을 통과합니다."
                // Counterexamples 1 (a note after the table) and 6 (a second body), and markup the reader never saw.
                listOf(
                    MIDDLE.replaceFirst("</table>", "</table><p>$passing</p>"),
                    MIDDLE.replaceFirst("</tbody>", "</tbody><tbody><tr><td colspan=\"3\">$passing</td></tr></tbody>"),
                    MIDDLE.replaceFirst("<td class=\"ac time\">23</td>", "<td class=\"ac time\">23*</td>"),
                    MIDDLE.replaceFirst("광교(경기대)방면</th>", "광교방면</th>"),
                    MIDDLE.replaceFirst("<td class=\"al\">", "<td class=\"al note\">"),
                ).forEach { changed ->
                    assertEquals(
                        listOf("SB005: page is not the reviewed one (all but its minutes changed)"),
                        differences(pages = mapOf("SB005" to changed)),
                    )
                }
                // The second body stops the reader itself too: one body per tab.
                assertFailsWith<IllegalArgumentException> {
                    station(
                        "SB005",
                        "양재",
                        MIDDLE.replaceFirst(
                            "</tbody>",
                            "</tbody><tbody><tr><td>1</td><td>23</td><td>2</td></tr></tbody>",
                        ),
                    )
                }
            }

            it("refusesANoticeListWithAnythingNewerThanTheReviewedNotice") {
                // Counterexamples 2 (a timetable notice with an odd title), 3 (an unquoted link) and 7 (a plain title
                // over a table of new last trains): the reviewed notice's "이전" cell is no longer the end of the list.
                val linked = operatorNotice(CHANGE, "2026.11.06", "1359" to "고객 안내", "1357" to DRILL)
                val customer =
                    operatorNotice("고객 안내", null, null, "1358" to CHANGE).replace(
                        "■ 변경대상 : 신사역 ~ 광교역",
                        "<table><caption>변경 시간표</caption><tr><td>2026년 11월20일</td><td>신사→정자</td><td>00:10</td></tr></table>",
                    )
                val unquoted =
                    operatorNotice(
                        CHANGE,
                        "2026.11.06",
                        null,
                        "1357" to DRILL,
                        newerCell = "<a href=\"javascript:goView(1359)\">$CHANGE (11월 20일)</a>",
                    )
                val spaced = operatorNotice("신분당선 열차 운행시각표 변경 시행", "2026.11.20", null, "1358" to CHANGE)
                assertTrue(differences(notices = mapOf("1358" to linked, "1359" to customer)).size == 2)
                assertTrue(differences(notices = mapOf("1358" to unquoted)).single().startsWith("notice 1358 is not"))
                assertTrue(differences(notices = mapOf("1358" to linked, "1359" to spaced)).isNotEmpty())
                // The reviewed notice not fetched, or one notice newer fetched on its own, are differences too.
                assertEquals(
                    listOf("notice 1358, the newest reviewed, is not among the pages"),
                    differences(notices = mapOf("1356" to operatorNotice(CHANGE, "2026.09.28", "1357" to DRILL, null))),
                )
                assertEquals(
                    listOf("notice 1360 is newer than the reviewed 1358"),
                    differences(notices = mapOf("1358" to newest, "1360" to operatorNotice(DRILL, null, null, null))),
                )
            }

            it("stopsTheSampleCommandAndRemovesTheReceiptSoThatTheBuildSwitchesTheLineOff") {
                val root = Files.createTempDirectory("sb-command")
                Files.createDirectories(root.resolve("data/config"))
                writeOperatorBaseline(root, SHINBUNDANG_BASELINE, baseline, emptyList())
                val manifest = root.resolve("data/config/source-manifest.json")
                Files.writeString(manifest, """[{"id":"S6","fetched_at":"2026-11-15T16:06:45Z"},{"id":"S8"}]""")
                fetched(root, pages = mapOf("SB005" to MIDDLE.replaceFirst("</table>", "</table><p>※ 통과</p>")))
                val stop = assertFailsWith<IllegalStateException> { shinbundangSamples(root) }
                assertTrue("SB005" in stop.message.orEmpty() && "removed" in stop.message.orEmpty(), stop.message)
                assertEquals(
                    listOf(
                        "S6",
                    ),
                    parseObject("""{"r":${Files.readString(manifest)}}""").getValue("r").jsonArray.map {
                        it.jsonObject.text("id")
                    },
                )
                // Without a reviewed baseline nothing is read either.
                Files.writeString(manifest, """[{"id":"S8"}]""")
                Files.delete(root.resolve(SHINBUNDANG_BASELINE))
                fetched(root)
                assertFailsWith<IllegalStateException> { shinbundangSamples(root) }
                assertEquals("[]", Files.readString(manifest).trim().replace(Regex("\\s"), ""))
            }

            it("removesTheReceiptFirstSoThatNoFailureLeavesTheOldOneOn") {
                // #100 third review: a page that could not be read (permissions) ended the run before the old receipt
                // was removed, and the build kept it on. Now the receipt goes first and comes back only at the end.
                val root = Files.createTempDirectory("sb-line")
                val repo =
                    java.nio.file.Path
                        .of("..")
                Files.createDirectories(root.resolve("data/config"))
                Files.copy(
                    repo.resolve("data/config/last-train-official.csv"),
                    root.resolve("data/config/last-train-official.csv"),
                )
                Files.createDirectories(root.resolve("data/artifacts/dev"))
                Files.list(repo.resolve("data/artifacts/dev")).use { files ->
                    files.forEach { Files.copy(it, root.resolve("data/artifacts/dev").resolve(it.fileName)) }
                }
                val manifest = root.resolve("data/config/source-manifest.json")

                fun ids() =
                    parseObject("""{"r":${Files.readString(manifest)}}""").getValue("r").jsonArray.map {
                        it.jsonObject.text("id")
                    }

                fun oldReceipt() =
                    Files.writeString(manifest, """[{"id":"S6","fetched_at":"2026-11-15T16:06:45Z"},{"id":"S8"}]""")
                // A whole line without short trains: start, 14 middle stations, end.
                val start =
                    page(
                        listOf(row("", "23", "10 40"), row("", "00", "05")),
                        listOf(row("", "23", "20"), row("", "00", "")),
                    )
                val middle =
                    page(
                        listOf(row("30", "23", "40"), row("05", "00", "15")),
                        listOf(row("20", "23", "25"), row("", "00", "")),
                    )
                val end =
                    page(
                        listOf(row("50", "23", ""), row("10", "00", "")),
                        listOf(row("30", "23", ""), row("", "00", "")),
                    )
                val line =
                    SHINBUNDANG_STATIONS.associate { (code, _) -> code to middle } + ("SB001" to start) +
                        ("SB016" to end)
                fetched(root, pages = line)
                // A person reviewed these pages: the baseline command removes the old receipt (it was not made from them).
                oldReceipt()
                shinbundangBaseline(root)
                assertEquals(listOf("S6"), ids())
                // The samples come back with the receipt, which names the reviewed notice exactly as the baseline does.
                shinbundangSamples(root)
                assertEquals(listOf("S6", "S8"), ids())
                val receipt =
                    parseObject(
                        """{"r":${Files.readString(manifest)}}""",
                    ).getValue("r").jsonArray.last().jsonObject
                val newestEntry =
                    receipt.getValue("notices").jsonArray.map { it.jsonObject }.single {
                        it.text("newest") == "true"
                    }
                val reviewedNotice = readShinbundangBaseline(root, SHINBUNDANG_BASELINE)!!.latestNotice
                assertEquals(newestEntry.text("sha256"), reviewedNotice.sha256)
                assertEquals(
                    240,
                    ltOfficialSamples(Files.readString(root.resolve("data/config/last-train-official.csv"))).count {
                        it.family ==
                            "신분당"
                    },
                )
                assertTrue(
                    Files.list(root.resolve("data/config")).use { files ->
                        files.noneMatch { it.fileName.toString().endsWith(".next") }
                    },
                )

                fun stopsAndRemoves(change: () -> Unit) {
                    fetched(root, pages = line)
                    oldReceipt()
                    change()
                    assertFailsWith<Exception> { shinbundangSamples(root) }
                    assertEquals(listOf("S6"), ids())
                }
                val dir = root.resolve("data/raw/shinbundang")
                // A page the run cannot read: an I/O error, not a page that differs, and still the line goes off.
                stopsAndRemoves {
                    val page = dir.resolve("SB001.html")
                    Files.setPosixFilePermissions(page, emptySet())
                    if (Files.isReadable(page)) Files.delete(page) // running as a user who reads anything: gone instead
                }
                Files.setPosixFilePermissions(
                    dir.resolve("SB001.html"),
                    java.nio.file.attribute.PosixFilePermissions
                        .fromString("rw-r--r--"),
                )
                // The view count of the reviewed notice is left out only when it is a number (the review's case).
                stopsAndRemoves {
                    val viewed =
                        newest.replace(
                            "<tr><th scope=\"row\">등록일</th>",
                            "<tr><th scope=\"row\">조회수</th><td>2476 · 정정일 2026-11-20 (평일 신사발 정자행 막차 00:10으로 변경)</td></tr><tr><th scope=\"row\">등록일</th>",
                        )
                    dir.resolve("notice-1358.html").writeBytes(viewed.toByteArray(EUC_KR))
                }
                // The reviewed notice corrected in place (same number and title, another date): not the reviewed one.
                stopsAndRemoves {
                    dir
                        .resolve(
                            "notice-1358.html",
                        ).writeBytes(newest.replace("2026.11.06", "2026.11.20").toByteArray(EUC_KR))
                }
                // A person runs only the baseline command on the corrected notice: the old receipt is removed with it.
                oldReceipt()
                shinbundangBaseline(root)
                assertEquals(listOf("S6"), ids())
            }

            it("leavesOutTheViewCountOnlyWhenItIsANumber") {
                fun counted(count: String) =
                    newest.replace(
                        "<tr><th scope=\"row\">등록일</th>",
                        "<tr><th scope=\"row\">조회수</th><td>$count</td></tr><tr><th scope=\"row\">등록일</th>",
                    )
                assertEquals(
                    shinbundangNoticeFingerprint(counted("2476")),
                    shinbundangNoticeFingerprint(counted(" 4011 ")),
                )
                val notCounts =
                    listOf("2476 · 정정일 2026-11-20 (막차 00:10으로 변경)", "2,476", "", "2476<span>*</span>", "２４７６")
                notCounts.forEach { count ->
                    assertFailsWith<IllegalArgumentException>(count) { shinbundangNoticeFingerprint(counted(count)) }
                }
            }
        }
    })
