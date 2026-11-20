package app.banbanyeok.server.app.application

import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.server.recommendation.LastTrainData
import app.banbanyeok.server.recommendation.LastTrainSource
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.withTimeoutOrNull
import org.slf4j.LoggerFactory
import java.time.LocalDate
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * 시작 뒤 뒤에서 읽는 막차 표(ArtifactLoader). [current]는 **막지 않는다**: 검사가 끝났으면 그 표, 아직이거나 실패했거나 데이터에 막차 표가
 * 없으면 null이고, 그 응답에서는 막차 항목만 빠진다(순위·시간은 그대로). 요청 코루틴은 계산 전에 [awaitReady]로 잠깐(최대 [wait])
 * 기다린다 — 요청 스레드를 붙잡지 않는다. 검사 실패는 한 번만 기록한다.
 */
class BackgroundLastTrains(
    private val loading: Deferred<LastTrainTable?>,
    /** manifest의 `lastTrainAsOf`. 세대 1·2 데이터면 null이다. */
    private val asOf: LocalDate?,
    private val wait: Duration = DEFAULT_WAIT,
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
        return loading.getCompleted()?.let { LastTrainData(it, asOf) }
    }

    /** 검사가 끝날 때까지 최대 [wait] 기다린다(끝났거나 실패했으면 바로 돌아온다). 시간을 넘기면 그냥 돌아온다. */
    suspend fun awaitReady() {
        if (asOf == null || loading.isCompleted) return
        // join은 실패해도 예외를 던지지 않는다(실패 내용은 current()가 한 번 기록한다).
        val done = withTimeoutOrNull(wait) { loading.join() }
        if (done == null) log.warn("막차 표 검사가 {} 안에 끝나지 않아 이 요청은 막차 없이 응답합니다", wait)
    }

    private companion object {
        /** 구분 행렬(10초)보다 짧다: 막차는 덧붙는 정보라 순위 응답을 오래 붙잡지 않는다. */
        val DEFAULT_WAIT: Duration = 2.seconds
        val log: org.slf4j.Logger = LoggerFactory.getLogger(BackgroundLastTrains::class.java)
    }
}
