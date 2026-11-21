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

internal const val EVIDENCE_RUN = "2026-11-21T01:00:00Z-test"
internal const val EVIDENCE_BASELINE = "data/config/shinbundang-baseline.json"
internal val EVIDENCE_PAGES = (1..16).map { "data/raw/shinbundang/SB${it.toString().padStart(3, '0')}.html" }
private const val EVIDENCE_NOTICE = "data/raw/shinbundang/notice-1358.html"
private val SAMPLES_SHA = "c".repeat(64)
private val BASELINE_SHA = "b".repeat(64)

private fun fakeSha(file: String) =
    app.banbanyeok.schema.Sha256
        .hex(file.toByteArray())

/**
 * A complete, consistent operator evidence of one sample run (hand-made: no page of the operator is in it), with
 * [rows] sample rows. Tests change one thing of it at a time ([receipt] and [baseline] edit the JSON as maps).
 */
internal fun operatorEvidence(
    rows: Int = 4,
    receipt: (MutableMap<String, kotlinx.serialization.json.JsonElement>) -> Unit = {},
    baseline: (MutableMap<String, kotlinx.serialization.json.JsonElement>) -> Unit = {},
    raw: Map<String, String>? = null,
    samples: app.banbanyeok.pipeline.lasttrain.model.LtSampleDigest =
        app.banbanyeok.pipeline.lasttrain.model
            .LtSampleDigest(rows, SAMPLES_SHA),
    baselineSha: String? = BASELINE_SHA,
): app.banbanyeok.pipeline.lasttrain.model.LtOperatorEvidence {
    fun file(path: String) =
        obj(
            "file" to path,
            "source_url" to "https://example.test/$path",
            "fetched_at" to "2026-11-20T22:08:57Z",
            "sha256" to fakeSha(path),
            "bytes" to 100,
        )
    val pages = EVIDENCE_PAGES.map(::file)
    val notice =
        kotlinx.serialization.json.JsonObject(
            file(EVIDENCE_NOTICE) +
                obj("viewNo" to "1358", "title" to CHANGE, "effective" to "2026-11-06", "newest" to true),
        )
    val digest =
        app.banbanyeok.pipeline.lasttrain.model
            .ltEvidenceDigest((EVIDENCE_PAGES + EVIDENCE_NOTICE).map { fakeSha(it) to it })
    val receiptJson =
        obj(
            "id" to "S8",
            "run" to EVIDENCE_RUN,
            "rows" to rows,
            "samples_rows" to rows,
            "samples_sha256" to SAMPLES_SHA,
            "baseline_file" to EVIDENCE_BASELINE,
            "baseline_sha256" to BASELINE_SHA,
            "sha256" to digest,
            "latest_timetable_change" to "2026-11-06",
            "pages" to pages,
            "notices" to listOf(notice),
        ).toMutableMap().also(receipt)
    val baselineJson =
        obj(
            "lastRun" to EVIDENCE_RUN,
            "pageSkeleton" to
                obj(
                    *EVIDENCE_PAGES
                        .map {
                            it
                                .substringAfterLast(
                                    '/',
                                ).removeSuffix(".html") to "d".repeat(64)
                        }.toTypedArray(),
                ),
            "latestNotice" to
                obj(
                    "viewNo" to "1358",
                    "title" to CHANGE,
                    "fingerprint" to "e".repeat(64),
                    "sha256" to fakeSha(EVIDENCE_NOTICE),
                ),
        ).toMutableMap().also(baseline)
    return app.banbanyeok.pipeline.lasttrain.model.LtOperatorEvidence(
        kotlinx.serialization.json.JsonObject(receiptJson),
        app.banbanyeok.pipeline.lasttrain.model.LtBaselineFile(
            EVIDENCE_BASELINE,
            kotlinx.serialization.json.JsonObject(baselineJson),
            baselineSha,
        ),
        samples,
        EVIDENCE_PAGES,
        raw,
    )
}

/** The raw folder exactly as the [operatorEvidence] receipt lists it. */
internal val EVIDENCE_RAW: Map<String, String> = (EVIDENCE_PAGES + EVIDENCE_NOTICE).associateWith { fakeSha(it) }
