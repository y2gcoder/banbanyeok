package app.banbanyeok.server.app.application

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.server.recommendation.lasttrain.LastTrainData
import app.banbanyeok.server.recommendation.lasttrain.LastTrainSource
import kotlinx.coroutines.Deferred
import org.slf4j.LoggerFactory
import java.time.LocalDate
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 시작 뒤 뒤에서 읽는 막차 표(ArtifactLoader). 읽기는 서버가 첫 응답을 보낸 뒤에 시작한다(Components.startBackground): CPU 1개에서
 * 기동과 첫 요청이 이 일에 밀리지 않게 한다. [current]는 **막지 않고, 요청도 이 표를 기다리지 않으며, 읽기를 시작시키지도 않는다**:
 * 검사가 끝났으면 그 표, 아직(시작 전 포함)이거나 실패했거나 데이터에 막차 표가 없으면 null이고, 그 응답에서는 막차 항목만 빠진다
 * (순위·시간은 그대로). 막차는 덧붙는 정보라, 표를 읽는 일이 늦어져도 추천 응답 시간에 영향을 주지 않는다. 검사 실패는 한 번만 기록한다.
 */
class BackgroundLastTrains(
    private val loading: Deferred<LastTrainTable?>,
    /** manifest의 `lastTrainAsOf`. 세대 1·2 데이터이거나 날짜로 읽을 수 없으면 null이다. */
    private val asOf: LocalDate?,
    /** manifest의 `lastTrainPartialDays`: 시간표가 있는 노선만 계산한 요일 종류. */
    private val partialDays: Set<DayType> = emptySet(),
) : LastTrainSource {
    private val failureLogged = AtomicBoolean(false)

    override fun current(): LastTrainData? {
        if (asOf == null || !loading.isCompleted) return null
        @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
        val failure = loading.getCompletionExceptionOrNull()
        if (failure != null) {
            if (failureLogged.compareAndSet(false, true)) log.error("막차 표를 쓸 수 없어 막차 없이 응답합니다", failure)
            return null
        }
        @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
        return loading.getCompleted()?.let { LastTrainData(it, asOf, partialDays) }
    }

    private companion object {
        val log: org.slf4j.Logger = LoggerFactory.getLogger(BackgroundLastTrains::class.java)
    }
}
