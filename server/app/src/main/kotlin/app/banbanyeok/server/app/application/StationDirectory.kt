package app.banbanyeok.server.app.application

import app.banbanyeok.schema.DataSet
import app.banbanyeok.server.recommendation.OdTravelTimeProvider
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
) : StationCatalog,
    StationNames {
    private val names: Map<String, String> = dataSet.registry.stations.associate { it.code to it.name }
    private val travelTimes: TravelTimeProvider = OdTravelTimeProvider(dataSet.od, dataSet.manifest.dataVersion)
    val travel: TravelTimeProvider get() = travelTimes

    override val dataVersion: String = dataSet.manifest.dataVersion

    /** 출발역으로 쓸 수 있는 코드(od.bin의 출발역 축). */
    val originCodes: List<String> = List(dataSet.od.originCount) { dataSet.od.originCode(it).toString() }

    override fun isOrigin(code: String): Boolean = travelTimes.isOrigin(code)

    override fun nameOf(code: String): String? = names[code]

    /** 출발역 표시 이름. 레지스트리에 없으면 null. */
    fun displayName(code: String?): String? = code?.let(names::get)

    fun measure(origins: List<String>): TravelMatrix = travelTimes.measure(origins)
}
