package app.banbanyeok.pipeline.lasttrain.compute

import app.banbanyeok.pipeline.lasttrain.model.LtOfficialSample
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorBaseline
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorNotice
import app.banbanyeok.pipeline.lasttrain.model.LtOperatorTimetable
import app.banbanyeok.schema.DayType

/**
 * The official samples of a line whose operator publishes one timetable per station (신분당선): for every meeting
 * station of the line and every other station of it, on each day type of the pages, the **last direct train** —
 * the last departure from the meeting station toward the home station whose terminal is the home station or beyond
 * it. The line has no express and no passing train, so that train stops at the home station.
 *
 * [meetings] are the names of the meeting axis (only those stations get samples), [checkedAt] the day the pages
 * were fetched. Stops when a page does not look like a page of its station: an end station with trains toward its
 * own end, a middle one without trains both ways, a short terminal that is not ahead of the train.
 */
internal fun ltOperatorSamples(
    timetable: LtOperatorTimetable,
    meetings: Set<String>,
    checkedAt: String,
): List<LtOfficialSample> {
    val stations = timetable.stations
    val order = stations.withIndex().associate { it.value.name to it.index }
    stations.forEachIndexed { index, station ->
        val ways = station.departures.map { it.towardEnd }.toSet()
        val expected =
            when (index) {
                0 -> setOf(true)
                stations.lastIndex -> setOf(false)
                else -> setOf(true, false)
            }
        require(ways == expected) { "${station.code} (${station.name}): trains toward $ways, expected $expected" }
        station.departures.forEach { departure ->
            val at = requireNotNull(order[departure.terminal]) { "${station.code}: terminal ${departure.terminal}" }
            require(if (departure.towardEnd) at > index else at < index) {
                "${station.code}: a train toward ${if (departure.towardEnd) "the end" else "the start"} " +
                    "terminates at ${departure.terminal}"
            }
        }
    }
    val days = stations.flatMap { station -> station.departures.map { it.day } }.distinct().sorted()
    return stations.withIndex().filter { it.value.name in meetings }.flatMap { (from, meeting) ->
        stations.withIndex().filter { it.index != from }.flatMap { (to, home) ->
            days.map { day ->
                val towardEnd = to > from
                val last =
                    meeting.departures
                        .filter { it.day == day && it.towardEnd == towardEnd }
                        .filter { order.getValue(it.terminal).let { at -> if (towardEnd) at >= to else at <= to } }
                        .maxByOrNull { it.minute }
                requireNotNull(last) { "${meeting.code}: no ${day.id} train to ${home.name}" }
                LtOfficialSample(
                    meeting.name,
                    home.name,
                    day,
                    last.minute,
                    last.terminal,
                    timetable.family,
                    meeting.url,
                    checkedAt,
                )
            }
        }
    }
}

/**
 * The date the operator's latest timetable change takes effect, from its notice pages: the latest of all their
 * dates, not the newest notice's. The pages must include the
 * newest notice of the list (one whose page says explicitly that there is no newer notice); from there the list is
 * walked to older notices through each page's link until a notice with a date it takes effect is found. A notice on
 * the way that is not among the pages is skipped only when its title is known (from a neighbour's link) to be about
 * something else than the timetable ([aboutTimetable], blanks ignored) and the page after it is there.
 */
internal fun ltLatestTimetableChange(
    notices: List<LtOperatorNotice>,
    aboutTimetable: (String) -> Boolean,
): String {
    val byNo = notices.associateBy { it.viewNo }
    var current =
        requireNotNull(notices.singleOrNull { it.newer == null }) { "the newest notice is not among the pages" }
    val seen = mutableSetOf<String>()
    while (true) {
        require(seen.add(current.viewNo)) { "the notice list loops at ${current.viewNo}" }
        // The walk only proves the list is complete down to a timetable change; the answer is the latest date any
        // fetched notice takes effect on (#100 final review: an older notice corrected to a later date counts).
        if (current.effective != null) return notices.mapNotNull { it.effective }.max()
        require(!aboutTimetable(current.title)) { "notice ${current.viewNo} is about the timetable but has no date" }
        val older = requireNotNull(current.older) { "no timetable change in the notice list" }
        val from = current.viewNo
        current = byNo[older.viewNo]?.also { next ->
            require(next.newer?.viewNo == from) { "notice ${next.viewNo} does not link back to $from" }
        } ?: run {
            require(!aboutTimetable(older.title)) { "notice ${older.viewNo} is about the timetable; fetch it" }
            requireNotNull(notices.singleOrNull { it.newer?.viewNo == older.viewNo }) {
                "the notice after ${older.viewNo} is not among the pages"
            }
        }
    }
}

/**
 * How the fetched pages differ from what a person reviewed ([baseline]); empty when they do not. [pages] is `sb_cd`
 * to the page's skeleton fingerprint, [notices] viewNo to the notice's fingerprint. Any page whose skeleton (all but
 * its minutes) changed, a reviewed newest notice that is missing or changed (a newer notice changes its "이전" cell),
 * or a notice newer than it among the pages is a difference, whatever the change says.
 */
internal fun ltBaselineDifferences(
    baseline: LtOperatorBaseline,
    pages: Map<String, String>,
    notices: Map<String, String>,
): List<String> {
    val reviewed = baseline.latestNotice
    val pageDifferences =
        (pages.keys + baseline.pages.keys).sorted().filter { pages[it] != baseline.pages[it] }.map { code ->
            "$code: page is not the reviewed one (all but its minutes changed)"
        }
    val noticeDifference =
        when (notices[reviewed.viewNo]) {
            null -> "notice ${reviewed.viewNo}, the newest reviewed, is not among the pages"
            reviewed.fingerprint -> null
            else -> "notice ${reviewed.viewNo} is not the reviewed one (a newer notice, or the notice changed)"
        }
    val newer =
        notices.keys
            .filter { (it.toLongOrNull() ?: Long.MAX_VALUE) > (reviewed.viewNo.toLongOrNull() ?: Long.MAX_VALUE) }
            .sorted()
            .map { "notice $it is newer than the reviewed ${reviewed.viewNo}" }
    return pageDifferences + listOfNotNull(noticeDifference) + newer
}
