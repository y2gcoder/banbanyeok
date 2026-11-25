package app.banbanyeok.server.app

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.TimeBand
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.app.application.BackgroundSlots
import app.banbanyeok.server.app.application.StationDirectory
import app.banbanyeok.server.artifact.ArtifactLoader
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.RecommendParticipant
import app.banbanyeok.server.recommendation.RecommendRequest
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.sampleOd
import app.banbanyeok.server.recommendation.time.TimeBasis
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeSameInstanceAs
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
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

/**
 * 추천 계산이 [BackgroundSlots]를 대기 포트(SlotReadiness)로 받을 때(#88): 기다림은 evaluate 안에서 측정 직전에 한다. 서버처럼 검사를
 * 첫 응답 뒤로 미뤄 둔(LAZY, #87) 상태에서, 기본 구분 요청은 검사를 시작시키지 않고 비기본 구분 요청은 검사를 시작시켜 그 행렬로 계산한다.
 */
class SlotReadinessWiringTest :
    DescribeSpec({
        it("starts the deferred slot check only for a non-default slot, and computes with that slot's matrix") {
            val loaded =
                ArtifactLoader(DevArtifacts.store, backgroundStart = CoroutineStart.LAZY)
                    .load()
            val slots = BackgroundSlots(loaded.slots)
            val directory =
                StationDirectory(loaded.dataSet, slots, testTimes)
            val service =
                RecommendationService(directory.travel, directory, slotsReady = slots)
            val people =
                listOf("홍대입구", "잠실").mapIndexed { i, name ->
                    RecommendParticipant(
                        i.toString(),
                        null,
                        directory.originCodes.first { directory.nameOf(it) == name },
                    )
                }

            fun request(slot: TimeSlot) =
                RecommendRequest(
                    people,
                    RecommendMode.FAIR,
                    time =
                        TimeBasis.of(slot),
                )

            service
                .evaluate(request(TimeSlot.DEFAULT))
                .recommendation.timeBasis.slot shouldBe TimeSlot.DEFAULT
            loaded.slots.isActive shouldBe false
            loaded.slots.isCompleted shouldBe false

            val saturdayNight = TimeSlot(DayType.SATURDAY, TimeBand.NIGHT)
            service
                .evaluate(request(saturdayNight))
                .recommendation.timeBasis.slot shouldBe saturdayNight
            loaded.slots.isCompleted shouldBe true
            loaded.lastTrains.isCompleted shouldBe false // 막차 표는 기다리지도, 시작시키지도 않는다
        }
    })
