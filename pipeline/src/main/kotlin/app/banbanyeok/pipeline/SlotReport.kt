package app.banbanyeok.pipeline

import app.banbanyeok.core.RankInput
import app.banbanyeok.core.rank
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.TimeSlot
import kotlinx.serialization.json.JsonObject
import java.nio.file.Path

/** Pairs whose weekday-daytime ranking is documented in D1; the report shows how each slot changes them. */
internal val slotExamplePairs =
    listOf(
        "강남" to "홍대입구",
        "신촌" to "잠실",
        "건대입구" to "사당",
        "서울역" to "잠실",
        "신도림" to "노원",
        "혜화" to "강남",
        "판교" to "부평",
        "정발산" to "수원",
    )

/**
 * data/config/time-slot-report.json: per slot the boarding waits used, the cell-by-cell change against the default
 * slot (weekday daytime) and the fair top 3 of [slotExamplePairs]. Evidence for docs/setup/t2-notes.md.
 */
internal fun writeSlotReport(
    root: Path,
    slots: Map<TimeSlot, Network>,
    results: Map<TimeSlot, SlotResult>,
    candidates: List<Station>,
) {
    val base = results.getValue(TimeSlot.DEFAULT)
    val origins = slots.getValue(TimeSlot.DEFAULT).origins
    val report =
        obj(
            "basis" to
                "구분 = 요일 유형(평일·토요일·일요일/공휴일) × 시간대(창은 headways.json slots[].window와 같음). " +
                "주행·환승 보행은 모든 구분에서 같고(평일 시간표로 추정), 탑승·환승 대기(배차/2)만 구분별 시간표로 바뀐다. " +
                "delta = 구분 − 평일 낮(초), 출발역×후보 전 칸.",
            "slots" to
                JsonObject(
                    TimeSlot.ALL.associate { slot ->
                        val result = results.getValue(slot)
                        val delta = IntArray(result.times.size) { result.times[it] - base.times[it] }
                        slot.id to
                            obj(
                                "window" to windowText(slot.band.window),
                                "waitSeconds" to
                                    JsonObject(
                                        slots
                                            .getValue(slot)
                                            .waits
                                            .toSortedMap()
                                            .mapValues { jsonValue(it.value) },
                                    ),
                                "deltaSeconds" to distribution(delta),
                                "fasterCells" to delta.count { it < 0 },
                                "slowerCells" to delta.count { it > 0 },
                                "examples" to
                                    slotExamplePairs.map { pair -> example(origins, candidates, result, pair) },
                            )
                    },
                ),
        )
    root.resolve("data/config/time-slot-report.json").writeJson(report.toString())
}

private fun example(
    origins: List<Station>,
    candidates: List<Station>,
    result: SlotResult,
    pair: Pair<String, String>,
): JsonObject {
    val people = listOf(pair.first, pair.second).map { stationNamed(origins, it) }
    val rows = people.map { origins.indexOf(it) }
    val columns = candidates.map { origins.indexOf(it) }
    val ranked =
        rank(
            RankInput(
                participants = people.map { it.code },
                candidates = candidates.map { it.code },
                times = rows.map { row -> columns.map { result.costs[row][it].seconds } },
                transfers = rows.map { row -> columns.map { result.costs[row][it].changes } },
                mode = "fair",
            ),
        ).recommendations.take(3)
    val names = candidates.associate { it.code to it.name }
    return obj(
        "pair" to "${pair.first} + ${pair.second}",
        "fairTop3" to ranked.map { "${names.getValue(it.stationCode)} ${it.maxSeconds}" },
    )
}
