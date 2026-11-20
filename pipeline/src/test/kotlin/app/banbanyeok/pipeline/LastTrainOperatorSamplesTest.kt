package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.compute.ltLatestTimetableChange
import app.banbanyeok.pipeline.lasttrain.compute.ltOperatorSamples
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_CHANGE_TITLE
import app.banbanyeok.pipeline.lasttrain.input.SHINBUNDANG_STATIONS
import app.banbanyeok.pipeline.lasttrain.input.parseShinbundangNotice
import app.banbanyeok.pipeline.lasttrain.input.parseShinbundangPage
import app.banbanyeok.pipeline.lasttrain.input.readShinbundangPages
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorTimetable
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.Sha256
import io.kotest.core.spec.style.DescribeSpec
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
        	<caption>역별시간표 $label : 강남방면, 시, 광교(경기대)방면, 시간(분), 시간(분)으로 구성된 표</caption>
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

private fun notice(
    title: String,
    effective: String?,
    newer: Pair<String, String>?,
    older: Pair<String, String>?,
) = """<table><tbody>
<tr><th scope="row">제목</th><td colspan="3">$title</td></tr>
<tr><th scope="row">등록일</th><td>2026-11-02</td></tr>
</tbody></table>
<p style="MARGIN: 0px"><span>■ 변경대상 : 신사역 ~ 광교역</span></p>
${effective?.let { "<p><span>■ 시행일자 : $it.(금) 영업개시부터 적용</span></p>" }.orEmpty()}
<table><tbody>
<tr><th scope="row">이전</th>
    <td colspan="3">${newer?.let {
    "<a href=\"javascript:goView('${it.first}')\">${it.second}</a>"
} ?: "<a href=\"javascript:void\">이전 글이 없습니다.</a>"}</td></tr>
<tr><th scope="row">다음</th>
    <td colspan="3">${older?.let {
    "<a href=\"javascript:goView('${it.first}')\">${it.second}</a>"
} ?: "<a href=\"javascript:void\">다음 글이 없습니다.</a>"}</td></tr>
</tbody></table>"""

private const val CHANGE = "신분당선 열차운행시각표 변경 시행"
private const val DRILL = "2026 신분당선 안전한국훈련"

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
                dir.resolve("notice-1358.html").writeBytes(notice(CHANGE, "2026.11.06", null, null).toByteArray(EUC_KR))
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

        describe("the operator's latest timetable change") {
            fun read(
                viewNo: String,
                html: String,
            ) = parseShinbundangNotice(viewNo, html)

            it("isTheNewestNoticeWhenThatNoticeIsAChange") {
                val newest = read("1358", notice(CHANGE, "2026.11.06", null, "1357" to DRILL))
                val older = read("1356", notice(CHANGE, "2026.09.28", "1357" to DRILL, "1347" to "공개검증"))
                assertEquals("2026-11-06", newest.effective)
                assertEquals("2026-11-06", ltLatestTimetableChange(listOf(older, newest), SHINBUNDANG_CHANGE_TITLE))
            }

            it("walksPastNoticesWhoseTitleIsNoChangeToTheLatestChange") {
                // The newest is a drill notice; the one after it (1357) is not fetched but its title is known.
                val newest = read("1359", notice(DRILL, null, null, "1357" to DRILL))
                val change = read("1356", notice(CHANGE, "2026.09.28", "1357" to DRILL, null))
                assertEquals(null, newest.effective)
                assertEquals("2026-09-28", ltLatestTimetableChange(listOf(newest, change), SHINBUNDANG_CHANGE_TITLE))
            }

            it("refusesAListWithoutItsNewestNoticeOrWithAChangeNotFetched") {
                val middle = read("1356", notice(CHANGE, "2026.09.28", "1357" to DRILL, null))
                assertFailsWith<IllegalArgumentException> {
                    ltLatestTimetableChange(
                        listOf(middle),
                        SHINBUNDANG_CHANGE_TITLE,
                    )
                }
                val newest = read("1360", notice(DRILL, null, null, "1359" to CHANGE))
                assertFailsWith<IllegalArgumentException> {
                    ltLatestTimetableChange(listOf(newest, middle), SHINBUNDANG_CHANGE_TITLE)
                }
                // A change notice without the date it takes effect is not read at all.
                assertFailsWith<IllegalArgumentException> { read("1361", notice(CHANGE, null, null, null)) }
            }
        }
    })
