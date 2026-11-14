package app.banbanyeok.core

import kotlin.random.Random
import kotlin.system.measureNanoTime
import kotlin.test.Test
import kotlin.test.assertEquals

class RankingTimingTest {
    @Test
    fun reportFourPeopleHundredCandidatesTiming() {
        val random = Random(1411)
        val input =
            RankInput(
                List(4) {
                    "p$it"
                },
                List(100) { "c$it" },
                List(4) { List(100) { random.nextInt(7200) } },
                List(4) { List(100) { 0 } },
            )
        for (mode in listOf("fair", "fast", "favor:p0")) {
            val configured = input.copy(mode = mode)
            repeat(1000) { rank(configured) }
            var count = 0
            val samples = List(1000) { measureNanoTime { count += rank(configured).recommendations.size } }.sorted()
            println(
                "rank N=4 M=100 mode=$mode: median=${samples[500] / 1000.0} us, p95=${samples[950] / 1000.0} us (1000 warmup, 1000 samples)",
            )
            assertEquals(1000 * rank(configured).recommendations.size, count)
        }
    }
}
