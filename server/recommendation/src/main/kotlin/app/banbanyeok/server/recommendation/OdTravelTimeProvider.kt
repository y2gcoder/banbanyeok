package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.StationCode

/** 검증된 od.bin 행렬을 읽는다. 메모리에 올려 둔 불변 데이터라 요청마다 파일을 읽지 않는다. */
public class OdTravelTimeProvider(
    private val od: OdMatrix,
    override val dataVersion: String,
) : TravelTimeProvider {
    private val candidateCodes: List<String> = List(od.candidateCount) { od.candidateCode(it).toString() }

    override fun isOrigin(code: String): Boolean = indexOfOrigin(code) >= 0

    override fun measure(origins: List<String>): TravelMatrix {
        val rows = origins.map { code -> indexOfOrigin(code).also { require(it >= 0) { "알 수 없는 출발역: $code" } } }

        fun cells(read: (Int, Int) -> Int) =
            rows.map { row ->
                List(od.candidateCount) { column -> read(row, column).takeIf { it != OdMatrix.UNREACHABLE } }
            }
        return TravelMatrix(candidateCodes, cells(od::timeSeconds), cells(od::transfers))
    }

    private fun indexOfOrigin(code: String): Int = StationCode.parseOrNull(code)?.let(od::indexOfOrigin) ?: -1
}
