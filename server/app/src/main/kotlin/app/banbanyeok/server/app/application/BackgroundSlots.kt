package app.banbanyeok.server.app.application

import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.recommendation.SlotMatrices
import app.banbanyeok.server.recommendation.SlotReadiness
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.withTimeoutOrNull
import org.slf4j.LoggerFactory
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * 시작 뒤 뒤에서 검사하는 구분 행렬(ArtifactLoader). 서버는 첫 응답을 보낸 뒤에 검사를 시작하고(Components.startBackground), 그 전에
 * 비기본 구분을 [await]로 기다리는 요청이 있으면 그 요청이 검사를 먼저 시작시킨다(`join`). [matrix]는 **막지 않는다**: 검사가 끝났으면 그
 * 행렬, 아직이거나 실패했으면 null(그 요청은 기본 구분 = 평일 낮으로 계산되고 응답의 timeBasis도 평일 낮이다). 추천 계산이 측정 직전에
 * [await]([SlotReadiness])로 잠깐(최대 [wait]) 기다린다 — 요청 스레드를 붙잡지 않는다. 검사 실패는 한 번만 기록한다.
 */
class BackgroundSlots(
    private val loading: Deferred<Map<TimeSlot, OdMatrix>>,
    private val wait: Duration = DEFAULT_WAIT,
) : SlotMatrices,
    SlotReadiness {
    private val failureLogged = AtomicBoolean(false)

    override fun matrix(slot: TimeSlot): OdMatrix? {
        if (!loading.isCompleted) return null
        @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
        val failure = loading.getCompletionExceptionOrNull()
        if (failure != null) {
            if (failureLogged.compareAndSet(false, true)) log.error("구분 행렬을 쓸 수 없어 기본 구분으로 계산합니다", failure)
            return null
        }
        @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
        return loading.getCompleted()[slot]
    }

    /** 기본 구분은 기다리지 않는다(검사를 시작시키지도 않는다). 그 밖의 구분은 [awaitReady]. */
    override suspend fun await(slot: TimeSlot) {
        if (slot != TimeSlot.DEFAULT) awaitReady()
    }

    /** 검사가 끝날 때까지 최대 [wait] 기다린다(끝났거나 실패했으면 바로 돌아온다). 시간을 넘기면 그냥 돌아온다. */
    suspend fun awaitReady() {
        if (loading.isCompleted) return
        // join은 실패해도 예외를 던지지 않는다(실패 내용은 matrix()가 한 번 기록한다).
        val done = withTimeoutOrNull(wait) { loading.join() }
        if (done == null) log.warn("구분 행렬 검사가 {} 안에 끝나지 않아 이 요청은 기본 구분으로 계산합니다", wait)
    }

    private companion object {
        val DEFAULT_WAIT: Duration = 10.seconds
        val log: org.slf4j.Logger = LoggerFactory.getLogger(BackgroundSlots::class.java)
    }
}
