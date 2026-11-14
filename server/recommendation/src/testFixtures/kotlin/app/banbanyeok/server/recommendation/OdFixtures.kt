package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.StationCode

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
