package app.banbanyeok.server.app

import app.banbanyeok.server.app.application.UsageStage
import app.banbanyeok.server.app.counter.BackgroundDailyCounter
import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.test.StandardTestDispatcher
import java.time.Clock

class BackgroundDailyCounterTest :
    FunSpec({
        test("저장이 한 번 실패해도 다음 요청 건수를 저장한다") {
            val dispatcher = StandardTestDispatcher()
            val written = mutableListOf<UsageStage>()
            BackgroundDailyCounter(Clock.systemUTC(), dispatcher) { _, stage ->
                check(stage != UsageStage.RECOMMEND)
                written.add(stage)
            }.use { counter ->
                counter.increment(UsageStage.RECOMMEND)
                counter.increment(UsageStage.CREATE_ROOM)
                dispatcher.scheduler.runCurrent()
                written shouldBe listOf(UsageStage.CREATE_ROOM)
            }
        }
    })
