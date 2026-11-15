package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.TimeSlot

/**
 * 기본 구분을 뺀 구분의 행렬을 내준다. 없는 구분(manifest 1세대 데이터, 검사 실패)이면 null. 서버는 시작 뒤 뒤에서 검사를 마칠 때까지
 * 잠깐 기다리게 구현한다(app의 BackgroundSlots).
 */
public fun interface SlotMatrices {
    public fun matrix(slot: TimeSlot): OdMatrix?
}

/**
 * 검증된 od.bin 행렬을 읽는다. 메모리에 올려 둔 불변 데이터라 요청마다 파일을 읽지 않는다. [od]는 기본 구분(평일 낮),
 * [slots]는 그 밖의 구분이며 축이 모두 같다(DataSetLoader가 검사한다).
 */
public class OdTravelTimeProvider(
    private val od: OdMatrix,
    override val dataVersion: String,
    private val slots: SlotMatrices = SlotMatrices { null },
) : TravelTimeProvider {
    public constructor(od: OdMatrix, dataVersion: String, slots: Map<TimeSlot, OdMatrix>) :
        this(od, dataVersion, SlotMatrices { slots[it] })

    private val candidateCodes: List<String> = List(od.candidateCount) { od.candidateCode(it).toString() }

    override fun isOrigin(code: String): Boolean = indexOfOrigin(code) >= 0

    override fun measure(
        origins: List<String>,
        slot: TimeSlot,
    ): TravelMatrix {
        val rows = origins.map { code -> indexOfOrigin(code).also { require(it >= 0) { "알 수 없는 출발역: $code" } } }
        val slotMatrix = if (slot == TimeSlot.DEFAULT) null else slots.matrix(slot)
        val used = if (slotMatrix == null) TimeSlot.DEFAULT else slot
        val matrix = slotMatrix ?: od

        fun cells(read: (Int, Int) -> Int) =
            rows.map { row ->
                List(matrix.candidateCount) { column -> read(row, column).takeIf { it != OdMatrix.UNREACHABLE } }
            }
        return TravelMatrix(candidateCodes, cells(matrix::timeSeconds), cells(matrix::transfers), used)
    }

    private fun indexOfOrigin(code: String): Int = StationCode.parseOrNull(code)?.let(od::indexOfOrigin) ?: -1
}
