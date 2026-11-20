package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainCell
import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.StationCode
import app.banbanyeok.server.recommendation.lasttrain.LastTrainRule
import java.time.LocalDate

/** 손으로 만든 작은 행렬. 도달 불가는 null. 출발역·후보 코드는 오름차순이어야 한다. */
fun smallOd(
    origins: List<String>,
    candidates: List<String>,
    times: List<List<Int?>>,
    transfers: List<List<Int>> = times.map { row -> row.map { 0 } },
): OdMatrix =
    OdMatrix(
        registryVersion = 1,
        originCodes = origins.map { StationCode.parse(it).value }.toIntArray(),
        candidateCodes = candidates.map { StationCode.parse(it).value }.toIntArray(),
        timesSeconds = times.flatten().map { it ?: OdMatrix.UNREACHABLE }.toIntArray(),
        transfers =
            times
                .flatMapIndexed { r, row ->
                    row.mapIndexed { c, t ->
                        if (t ==
                            null
                        ) {
                            OdMatrix.UNREACHABLE
                        } else {
                            transfers[r][c]
                        }
                    }
                }.toIntArray(),
    )

/** 이름은 "<코드>역"이다. */
val codeNames = StationNames { "${it}역" }

/** 출발역 4곳, 후보 5곳(0초 대각선 포함)인 예시. 출발역 순서는 03v, 130, 225, 31a. */
val sampleOd: OdMatrix =
    smallOd(
        origins = listOf("03v", "130", "225", "31a"),
        candidates = listOf("03v", "130", "225", "31a", "4xz"),
        times =
            listOf(
                listOf(0, 600, 1200, 1800, 2400),
                listOf(900, 0, 600, 1500, 1200),
                listOf(1500, 700, 0, 600, 1000),
                listOf(2100, 1600, 650, 0, 3000),
            ),
        transfers =
            listOf(
                listOf(0, 1, 1, 2, 2),
                listOf(1, 0, 1, 1, 1),
                listOf(1, 0, 0, 1, 1),
                listOf(2, 1, 0, 0, 3),
            ),
    )

/** 손으로 만든 작은 막차 표. [cells]의 키는 (요일 종류, 집 역, 만날 역)이고 없는 칸은 확인 필요다. 코드는 오름차순이어야 한다. */
fun smallLastTrains(
    homes: List<String>,
    meetings: List<String>,
    cells: Map<Triple<DayType, String, String>, LastTrainCell>,
): LastTrainTable {
    val size = homes.size * meetings.size * LastTrainTable.DAY_COUNT
    val minutes = IntArray(size) { LastTrainTable.NONE }
    val kinds = IntArray(size)
    val bounds = IntArray(size) { LastTrainTable.NONE }
    cells.forEach { (key, cell) ->
        val (day, home, meeting) = key
        val i = (day.ordinal * homes.size + homes.indexOf(home)) * meetings.size + meetings.indexOf(meeting)
        minutes[i] = cell.minute ?: LastTrainTable.NONE
        kinds[i] = cell.kind.raw
        bounds[i] = cell.boundFor?.value ?: LastTrainTable.NONE
    }
    return LastTrainTable(
        1,
        homes.map { StationCode.parse(it).value }.toIntArray(),
        meetings.map { StationCode.parse(it).value }.toIntArray(),
        minutes,
        kinds,
        bounds,
    )
}

/** [sampleLastTrains]의 시간표 수집일. */
val sampleLastTrainAsOf: LocalDate = LocalDate.parse("2026-11-16")

/**
 * [sampleOd]와 같은 축의 막차 표. 평일: 03v 사람은 130에서 직행 확정 24:03(4xz행), 130 사람은 03v에서 갈아타는 여유 23:17,
 * 225 사람은 130에서 대조 전 직행 23:41(31a행). 휴일: 03v 사람이 130에서 23:30. 토요일과 나머지 칸은 확인 필요다.
 */
val sampleLastTrains: LastTrainTable =
    smallLastTrains(
        homes = listOf("03v", "130", "225", "31a"),
        meetings = listOf("03v", "130", "225", "31a", "4xz"),
        cells =
            mapOf(
                Triple(DayType.WEEKDAY, "03v", "130") to
                    LastTrainCell(LastTrainKind.DIRECT, 1443, StationCode.parse("4xz")),
                Triple(DayType.WEEKDAY, "130", "03v") to LastTrainCell(LastTrainKind.MARGIN_TRANSFER, 1397, null),
                Triple(DayType.WEEKDAY, "225", "130") to
                    LastTrainCell(LastTrainKind.MARGIN_DIRECT, 1421, StationCode.parse("31a")),
                Triple(DayType.HOLIDAY, "03v", "130") to
                    LastTrainCell(LastTrainKind.DIRECT, 1410, StationCode.parse("4xz")),
            ),
    )

/** 막차 표에서 [homeCode]에 사는 사람이 [meetingCode]에서 돌아가는 칸(서버 규칙 그대로). 다른 모듈의 테스트가 기대값을 만들 때 쓴다. */
fun lastTrainCell(
    table: LastTrainTable,
    day: DayType,
    homeCode: String,
    meetingCode: String,
): LastTrainCell = LastTrainRule.cell(table, day, homeCode, meetingCode)
