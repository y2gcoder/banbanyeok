package app.banbanyeok.server.app

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.TimeBand
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.app.application.BackgroundSlots
import app.banbanyeok.server.recommendation.sampleOd
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.types.shouldBeSameInstanceAs
import kotlinx.coroutines.CompletableDeferred
import kotlin.concurrent.thread

private val night = TimeSlot(DayType.WEEKDAY, TimeBand.NIGHT)

class BackgroundSlotsTest :
    DescribeSpec({
        describe("slot matrices verified after startup") {
            it("waits for the background verification, then serves the matrix") {
                val loading = CompletableDeferred<Map<TimeSlot, OdMatrix>>()
                thread {
                    Thread.sleep(50)
                    loading.complete(mapOf(night to sampleOd))
                }
                BackgroundSlots(loading).matrix(night) shouldBeSameInstanceAs sampleOd
            }
            it("answers null (default slot) when verification failed or took too long") {
                val failed = CompletableDeferred<Map<TimeSlot, OdMatrix>>()
                failed.completeExceptionally(IllegalStateException("broken slot file"))
                BackgroundSlots(failed).matrix(night).shouldBeNull()
                BackgroundSlots(CompletableDeferred(), waitSeconds = 0).matrix(night).shouldBeNull()
            }
        }
    })
