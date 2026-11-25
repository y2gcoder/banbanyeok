package app.banbanyeok.server.app.application

import app.banbanyeok.schema.DataSet
import app.banbanyeok.schema.StationRegion
import app.banbanyeok.server.recommendation.OdTravelTimeProvider
import app.banbanyeok.server.recommendation.SlotMatrices
import app.banbanyeok.server.recommendation.StationNames
import app.banbanyeok.server.recommendation.TravelTimeProvider
import app.banbanyeok.server.recommendation.mapmiddle.GeoPoint
import app.banbanyeok.server.recommendation.mapmiddle.StationLocations
import app.banbanyeok.server.room.StationCatalog

/**
 * 현재 산출물(DataSet) 하나를 기능 모듈들이 각자 필요한 포트로 보여 준다. 기능 모듈끼리 서로 알지 못하므로
 * 이 연결은 app(조립 지점)에서 한다.
 */
class StationDirectory(
    dataSet: DataSet,
    /**
     * 기본 구분을 뺀 구분 행렬. 서버는 [BackgroundSlots](기다림은 추천 계산이 그 [BackgroundSlots.await]로 한다), 테스트는 이미 읽은
     * 데이터 세트의 행렬.
     */
    slots: SlotMatrices = SlotMatrices { dataSet.odSlots[it] },
) : StationCatalog,
    CanonicalStations,
    StationNames,
    StationLocations {
    private val names: Map<String, String> = dataSet.registry.stations.associate { it.code to it.name }
    private val regions: Map<String, StationRegion> =
        dataSet.registry.stations.associate { it.code to (it.region ?: StationRegion.CAPITAL) }
    private val points: Map<String, GeoPoint> =
        dataSet.registry.stations.associate { it.code to GeoPoint(it.lat, it.lng) }
    private val replacements: Map<String, String> =
        dataSet.registry.stations
            .mapNotNull { station -> station.replacedBy?.let { station.code to it } }
            .toMap()
    private val travelTimes: TravelTimeProvider =
        OdTravelTimeProvider(dataSet.od, dataSet.manifest.dataVersion, slots, regions, dataSet.manifest.regionCoverage)
    val travel: TravelTimeProvider get() = travelTimes

    override val dataVersion: String = dataSet.manifest.dataVersion

    /** 출발역으로 쓸 수 있는 코드(od.bin의 출발역 축). */
    val originCodes: List<String> = List(dataSet.od.originCount) { dataSet.od.originCode(it).toString() }

    override fun isOrigin(code: String): Boolean = travelTimes.isOrigin(code)

    override fun regionOf(code: String): StationRegion? = regions[code]

    private val meetingCodes: Set<String> =
        List(dataSet.od.candidateCount) {
            dataSet.od.candidateCode(it).toString()
        }.toSet()

    override fun isMeetingStation(code: String): Boolean = code in meetingCodes

    override fun nameOf(code: String): String? = names[code]

    override fun locate(code: String): GeoPoint? = points[code]

    /**
     * 폐기된 코드를 replacedBy 사슬의 끝(active 코드)으로 바꾼다. 사슬의 순환·끊김은 파이프라인 게이트가 막지만, 여기서도
     * 레지스트리 크기만큼만 따라가 끝나지 않는 일은 없게 한다.
     */
    override fun canonical(code: String): String =
        generateSequence(code) { replacements[it] }.take(replacements.size + 1).last()

    /** 출발역 표시 이름. 레지스트리에 없으면 null. */
    fun displayName(code: String?): String? = code?.let(names::get)
}
