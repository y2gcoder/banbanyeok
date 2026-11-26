package app.banbanyeok.server.app.counter

import app.banbanyeok.server.app.application.DailyCounter
import app.banbanyeok.server.app.application.UsageStage
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId

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

    init {
        scope.launch {
            for ((date, stage) in queue) write(date, stage)
        }
    }

    override fun increment(stage: UsageStage) {
        queue.trySend(LocalDate.now(seoulClock) to stage)
    }

    override fun close() {
        queue.cancel()
        scope.cancel()
    }

    private companion object {
        const val CAPACITY = 256
    }
}
