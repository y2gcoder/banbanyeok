package app.banbanyeok.server.app.application

import app.banbanyeok.schema.DataSet
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.recommendation.GeoPoint
import app.banbanyeok.server.recommendation.OdTravelTimeProvider
import app.banbanyeok.server.recommendation.SlotMatrices
import app.banbanyeok.server.recommendation.StationLocations
import app.banbanyeok.server.recommendation.StationNames
import app.banbanyeok.server.recommendation.TravelMatrix
import app.banbanyeok.server.recommendation.TravelTimeProvider
import app.banbanyeok.server.room.StationCatalog

/**
 * 현재 산출물(DataSet) 하나를 기능 모듈들이 각자 필요한 포트로 보여 준다. 기능 모듈끼리 서로 알지 못하므로
 * 이 연결은 app(조립 지점)에서 한다.
 */
class StationDirectory(
    dataSet: DataSet,
    /** 기본 구분을 뺀 구분 행렬. 서버는 [BackgroundSlots], 테스트는 이미 읽은 데이터 세트의 행렬. */
    private val slots: SlotMatrices = SlotMatrices { dataSet.odSlots[it] },
    /** 뒤에서 읽는 막차 표. 테스트처럼 뒤에서 읽지 않으면 null이다(기다릴 것이 없다). */
    private val lastTrains: BackgroundLastTrains? = null,
) : StationCatalog,
    StationNames,
    StationLocations {
    private val names: Map<String, String> = dataSet.registry.stations.associate { it.code to it.name }
    private val points: Map<String, GeoPoint> =
        dataSet.registry.stations.associate { it.code to GeoPoint(it.lat, it.lng) }
    private val replacements: Map<String, String> =
        dataSet.registry.stations
            .mapNotNull { station -> station.replacedBy?.let { station.code to it } }
            .toMap()
    private val travelTimes: TravelTimeProvider =
        OdTravelTimeProvider(dataSet.od, dataSet.manifest.dataVersion, slots)
    val travel: TravelTimeProvider get() = travelTimes

    override val dataVersion: String = dataSet.manifest.dataVersion

    /** 출발역으로 쓸 수 있는 코드(od.bin의 출발역 축). */
    val originCodes: List<String> = List(dataSet.od.originCount) { dataSet.od.originCode(it).toString() }

    override fun isOrigin(code: String): Boolean = travelTimes.isOrigin(code)

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

    /** 구분 행렬 검사가 아직 뒤에서 도는 중이면 잠깐 기다린다(기본 구분 요청은 기다리지 않는다). 요청 스레드를 붙잡지 않는다. */
    suspend fun awaitSlots(slot: TimeSlot) {
        if (slot != TimeSlot.DEFAULT) (slots as? BackgroundSlots)?.awaitReady()
    }

    /** 막차 표 검사가 아직 뒤에서 도는 중이면 잠깐 기다린다. 요청 스레드를 붙잡지 않는다. */
    suspend fun awaitLastTrains() {
        lastTrains?.awaitReady()
    }

    /** 출발역 표시 이름. 레지스트리에 없으면 null. */
    fun displayName(code: String?): String? = code?.let(names::get)

    fun measure(origins: List<String>): TravelMatrix = travelTimes.measure(origins)
}
