package app.banbanyeok.server.app.counter

import app.banbanyeok.server.app.application.DailyCounter
import app.banbanyeok.server.app.application.UsageStage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import org.slf4j.Logger
import org.slf4j.LoggerFactory
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.atomic.AtomicBoolean

/** 요청 시점의 서울 날짜를 기록한다. DB 장애 때는 큐가 차면 버려 응답과 방 DB 풀을 보호한다. */
class BackgroundDailyCounter(
    clock: Clock,
    dispatcher: CoroutineDispatcher,
    write: suspend (LocalDate, UsageStage) -> Unit,
) : DailyCounter,
    AutoCloseable {
    private val seoulClock = clock.withZone(ZoneId.of("Asia/Seoul"))
    private val queue = Channel<Pair<LocalDate, UsageStage>>(CAPACITY)
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)

    private val overflowReported = AtomicBoolean(false)

    init {
        scope.launch {
            for ((date, stage) in queue) {
                try {
                    write(date, stage)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    // 예외 메시지에는 접속 정보나 요청 값이 있을 수 있다.
                    logger.warn("하루 요청 건수 저장 실패")
                }
            }
        }
    }

    override fun increment(stage: UsageStage) {
        val result = queue.trySend(LocalDate.now(seoulClock) to stage)
        if (result.isFailure && !result.isClosed && overflowReported.compareAndSet(false, true)) {
            logger.warn("하루 요청 건수 큐가 가득 차 일부 건수가 누락됨")
        }
    }

    override fun close() {
        queue.cancel()
        scope.cancel()
    }

    private companion object {
        val logger: Logger = LoggerFactory.getLogger(BackgroundDailyCounter::class.java)
        const val CAPACITY = 256
    }
}
