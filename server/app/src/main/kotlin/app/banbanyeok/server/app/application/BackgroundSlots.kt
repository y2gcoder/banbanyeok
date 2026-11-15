package app.banbanyeok.server.app.application

import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.recommendation.SlotMatrices
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.future.asCompletableFuture
import org.slf4j.LoggerFactory
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * 시작 뒤 뒤에서 검사하는 구분 행렬(ArtifactLoader). 검사가 끝나기 전에 온 요청은 [waitSeconds]까지 기다린다(보통 수백 ms 안, 인스턴스
 * 생애에 한 번). 검사가 실패했거나 시간을 넘기면 null — 그 요청은 기본 구분(평일 낮)으로 계산되고 응답의 timeBasis도 평일 낮이다.
 */
class BackgroundSlots(
    loading: Deferred<Map<TimeSlot, OdMatrix>>,
    private val waitSeconds: Long = DEFAULT_WAIT_SECONDS,
) : SlotMatrices {
    private val future = loading.asCompletableFuture()

    override fun matrix(slot: TimeSlot): OdMatrix? =
        try {
            future.get(waitSeconds, TimeUnit.SECONDS)[slot]
        } catch (e: TimeoutException) {
            log.warn("구분 행렬 검사가 {}초 안에 끝나지 않아 기본 구분으로 계산합니다", waitSeconds, e)
            null
        } catch (e: ExecutionException) {
            log.error("구분 행렬을 쓸 수 없어 기본 구분으로 계산합니다", e.cause)
            null
        }

    private companion object {
        const val DEFAULT_WAIT_SECONDS = 10L
        val log: org.slf4j.Logger = LoggerFactory.getLogger(BackgroundSlots::class.java)
    }
}
