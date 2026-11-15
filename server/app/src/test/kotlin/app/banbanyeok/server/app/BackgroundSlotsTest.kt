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
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlin.time.Duration.Companion.milliseconds

private val night = TimeSlot(DayType.WEEKDAY, TimeBand.NIGHT)

class BackgroundSlotsTest :
    DescribeSpec({
        describe("slot matrices verified after startup") {
            it("never blocks: before verification ends the slot is unavailable (default slot)") {
                BackgroundSlots(CompletableDeferred()).matrix(night).shouldBeNull()
            }
            it("lets a request coroutine wait for the background verification, then serves the matrix") {
                val loading = CompletableDeferred<Map<TimeSlot, OdMatrix>>()
                val slots = BackgroundSlots(loading)
                coroutineScope {
                    val waiting = async { slots.awaitReady() }
                    delay(20)
                    loading.complete(mapOf(night to sampleOd))
                    waiting.await()
                }
                slots.matrix(night) shouldBeSameInstanceAs sampleOd
            }
            it("answers null (default slot) when verification failed or took too long") {
                val failed = CompletableDeferred<Map<TimeSlot, OdMatrix>>()
                failed.completeExceptionally(IllegalStateException("broken slot file"))
                val broken = BackgroundSlots(failed)
                broken.awaitReady()
                broken.matrix(night).shouldBeNull()
                broken.matrix(night).shouldBeNull() // 두 번째부터는 기록하지 않는다
                val slow = BackgroundSlots(CompletableDeferred(), wait = 10.milliseconds)
                slow.awaitReady()
                slow.matrix(night).shouldBeNull()
            }
        }
    })
