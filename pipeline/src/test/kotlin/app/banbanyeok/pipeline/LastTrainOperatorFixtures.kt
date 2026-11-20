package app.banbanyeok.pipeline

// Hand-made fragments in the shape of the operator's notice pages (#82). The real pages have no terms of use, so none
// of them is committed: these only copy the markup the reader relies on, with invented titles and dates.

internal const val CHANGE = "신분당선 열차운행시각표 변경 시행"
internal const val DRILL = "2026 신분당선 안전한국훈련"

private fun neighbour(
    label: String,
    link: Pair<String, String>?,
) = link?.let { "<a href=\"javascript:goView('${it.first}')\">${it.second}</a>" }
    ?: "<a href=\"javascript:void\">$label 글이 없습니다.</a>"

/**
 * One notice page: its title, registration date, the date it takes effect (`2026.11.06`, none when null), and its
 * newer and older neighbours (viewNo to title; null for the end of the list). [newerCell] replaces the newer
 * neighbour's cell as it is, for markup the reader has not seen.
 */
internal fun operatorNotice(
    title: String,
    effective: String?,
    newer: Pair<String, String>?,
    older: Pair<String, String>?,
    newerCell: String? = null,
) = """<table><tbody>
<tr><th scope="row">제목</th><td colspan="3">$title</td></tr>
<tr><th scope="row">등록일</th><td>2026-11-02</td></tr>
</tbody></table>
<p style="MARGIN: 0px"><span>■ 변경대상 : 신사역 ~ 광교역</span></p>
${effective?.let { "<p><span>■ 시행일자 : $it.(금) 영업개시부터 적용</span></p>" }.orEmpty()}
<table><tbody>
<tr><th scope="row">이전</th>
    <td colspan="3">${newerCell ?: neighbour("이전", newer)}</td></tr>
<tr><th scope="row">다음</th>
    <td colspan="3">${neighbour("다음", older)}</td></tr>
</tbody></table>"""
