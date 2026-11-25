package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.RegionalSlotCoverage
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.StationRegion
import app.banbanyeok.schema.TimeSlot

/**
 * 검증된 od.bin 행렬을 읽는다. 메모리에 올려 둔 불변 데이터라 요청마다 파일을 읽지 않는다. [od]는 기본 구분(평일 낮),
 * [slots]는 그 밖의 구분이며 축이 모두 같다(DataSetLoader가 검사한다).
 */
public class OdTravelTimeProvider(
    private val od: OdMatrix,
    override val dataVersion: String,
    private val slots: SlotMatrices = SlotMatrices { null },
    private val regions: Map<String, StationRegion>? = null,
    private val coverage: Map<StationRegion, Map<String, RegionalSlotCoverage>>? = null,
) : TravelTimeProvider {
    public constructor(od: OdMatrix, dataVersion: String, slots: Map<TimeSlot, OdMatrix>) :
        this(od, dataVersion, SlotMatrices { slots[it] })

    private val candidateCodes: List<String> = List(od.candidateCount) { od.candidateCode(it).toString() }

    override fun isOrigin(code: String): Boolean = indexOfOrigin(code) >= 0

    override fun regionOf(code: String): StationRegion? = if (regions == null) super.regionOf(code) else regions[code]

    override fun measure(
        origins: List<String>,
        slot: TimeSlot,
    ): TravelMatrix {
        val rows = origins.map { code -> indexOfOrigin(code).also { require(it >= 0) { "알 수 없는 출발역: $code" } } }
        val region = origins.firstOrNull()?.let(::regionOf)
        val known = region?.let { coverage?.get(it)?.get(slot.id) }
        if (origins.any { !departs(it, slot) }) scheduleUnavailable()
        val slotMatrix = if (slot == TimeSlot.DEFAULT) null else slots.matrix(slot)
        val used = if (slotMatrix == null) TimeSlot.DEFAULT else slot
        val matrix = slotMatrix ?: od

        fun cells(read: (Int, Int) -> Int) =
            rows.map { row ->
                List(matrix.candidateCount) { column -> read(row, column).takeIf { it != OdMatrix.UNREACHABLE } }
            }
        return TravelMatrix(
            candidateCodes,
            cells(matrix::timeSeconds),
            cells(matrix::transfers),
            used,
            known?.missingServices.orEmpty(),
        )
    }

    override fun departs(
        code: String,
        slot: TimeSlot,
    ): Boolean {
        val region = regionOf(code)
        val known = region?.let { coverage?.get(it)?.get(slot.id) }
        if (known != null && (!known.available || code in known.unsupportedOrigins)) return false
        // 부산권은 기본 구분으로 대신 계산하지 않는다. 그 구분의 행렬을 아직 못 읽었거나 읽지 못했으면 출발할 수 없는 것과 같다.
        val needsSlotMatrix = coverage != null && region == StationRegion.BUSAN && slot != TimeSlot.DEFAULT
        return !needsSlotMatrix || slots.matrix(slot) != null
    }

    private fun indexOfOrigin(code: String): Int = StationCode.parseOrNull(code)?.let(od::indexOfOrigin) ?: -1

    private fun scheduleUnavailable(): Nothing =
        throw RecommendationException(RecommendationError.SCHEDULE_UNAVAILABLE, "요청한 시간표를 확인하지 못했습니다")
}
