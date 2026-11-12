package app.banbanyeok.core

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class RankingPropertiesTest {
    private fun sample(random: Random, mode: String, tolerance: Int): RankInput {
        val people = List(random.nextInt(2, 5)) { "p$it" }
        val codes = List(random.nextInt(2, 30)) { "c$it" }
        val times = people.map { codes.map { if (random.nextInt(12) == 0) null else random.nextInt(0, 7201) } }
        return RankInput(people, codes, times, times.map { row -> row.map { it?.let { random.nextInt(5) } } }, mode, tolerance)
    }

    @Test
    fun candidatePermutationPreservesEntireResult() {
        val random = Random(20261112)
        repeat(300) {
            for (mode in listOf("fair", "fast", "favor:p0")) {
                val input = sample(random, mode, if (it % 2 == 0) 0 else 180)
                val order = input.candidates.indices.shuffled(random)
                val shuffled = input.copy(
                    candidates = order.map { input.candidates[it] },
                    times = input.times.map { row -> order.map { row[it] } },
                    transfers = input.transfers.map { row -> order.map { row[it] } },
                )
                assertEquals(rank(input), rank(shuffled))
            }
        }
    }

    @Test
    fun participantPermutationPreservesMappedResult() {
        val random = Random(7301)
        repeat(300) {
            for (mode in listOf("fair", "fast", "favor:p0")) {
                val input = sample(random, mode, if (it % 2 == 0) 0 else 180)
                val order = input.participants.indices.shuffled(random)
                val shuffled = input.copy(
                    participants = order.map { input.participants[it] },
                    times = order.map { input.times[it] },
                    transfers = order.map { input.transfers[it] },
                )
                fun normalize(result: RankResult): RankResult = result.copy(
                    participants = result.participants.sorted(),
                    recommendations = result.recommendations.map { row -> row.copy(times = row.times.sortedBy { it.participantId }) },
                )
                assertEquals(normalize(rank(input)), normalize(rank(shuffled)))
            }
        }
    }

    @Test
    fun strictlyReducingEveryTimeCannotLowerStrictFairOrFastRank() {
        val random = Random(4432)
        repeat(1000) {
            for (mode in listOf("fair", "fast")) {
                val input = sample(random, mode, 0)
                val before = rank(input)
                val chosen = before.recommendations.filter { row -> row.times.all { it.seconds > 0 } }.randomOrNull(random)
                    ?: continue
                val column = input.candidates.indexOf(chosen.stationCode)
                val improved = input.copy(times = input.times.map { row -> row.mapIndexed { i, t ->
                    if (i == column) random.nextInt(requireNotNull(t)) else t
                } })
                assertTrue(rank(improved).recommendations.single { it.stationCode == chosen.stationCode }.rank <= chosen.rank)
            }
        }
    }

    @Test
    fun favorRespectsCapsRetainsBaselineAndDoesNotIncreaseStrictWinnerTime() {
        val random = Random(8721)
        repeat(1000) {
            val input = sample(random, "favor:p0", if (it % 2 == 0) 0 else 180)
            val result = rank(input)
            if (result.baselineStationCode != null) {
                assertTrue(result.recommendations.any { it.stationCode == result.baselineStationCode })
                if (input.toleranceSeconds == 0) {
                    val baseline = result.recommendations.single { it.stationCode == result.baselineStationCode }
                    val baselineFavoredSeconds = baseline.times.single { it.participantId == "p0" }.seconds
                    assertTrue(requireNotNull(result.recommendations.first().favoredSeconds) <= baselineFavoredSeconds)
                }
                for (candidate in result.recommendations) {
                    for (time in candidate.times.filter { it.participantId != "p0" }) {
                        assertTrue(time.seconds <= requireNotNull(result.favorCaps)[time.participantId]!!)
                    }
                }
            }
        }
    }

    @Test
    fun favorBaselineChangeCanLowerRankDespiteStrictTimeImprovement() {
        val input = RankInput(listOf("A", "B"), listOf("a", "b", "c", "d"), listOf(listOf(14, 29, 42, 24), listOf(51, 49, 34, 55)).map { row -> row.map { it * 60 } }, List(2) { List(4) { 0 } }, "favor:A")
        val improved = input.copy(times = listOf(listOf(14, 22, 42, 24), listOf(51, 37, 34, 55)).map { row -> row.map { it * 60 } })
        assertEquals("c", rank(input).baselineStationCode)
        assertEquals("b", rank(improved).baselineStationCode)
        assertEquals(1, rank(input).recommendations.single { it.stationCode == "b" }.rank)
        assertEquals(2, rank(improved).recommendations.single { it.stationCode == "b" }.rank)
    }

    @Test
    fun toleranceBandsCanLowerRankDespiteStrictTimeImprovement() {
        val input = RankInput(listOf("A", "B"), listOf("a", "b", "c", "d"), listOf(listOf(4, 55, 17, 32), listOf(48, 34, 52, 49)), List(2) { List(4) { 0 } }, toleranceSeconds = 3)
        val improved = input.copy(times = listOf(listOf(4, 54, 17, 32), listOf(48, 11, 52, 49)))
        assertEquals(3, rank(input).recommendations.single { it.stationCode == "b" }.rank)
        assertEquals(4, rank(improved).recommendations.single { it.stationCode == "b" }.rank)
    }

    @Test
    fun emptyOrUnreachableCandidatesReturnStatus() {
        assertEquals("no_common_candidate", rank(RankInput(listOf("A", "B"), emptyList(), listOf(emptyList(), emptyList()), listOf(emptyList(), emptyList()))).status)
        val result = rank(RankInput(listOf("A", "B"), listOf("x"), listOf(listOf(null), listOf(1)), listOf(listOf(null), listOf(0)), "favor:A"))
        assertEquals("no_common_candidate", result.status)
        assertEquals(null, result.baselineStationCode)
        assertEquals(null, result.favorCaps)
        assertEquals(listOf(ExcludedCandidate("x", "UNREACHABLE")), result.excluded)
    }

    @Test
    fun invalidInputsThrowInsteadOfReturningEmptyResults() {
        val valid = RankInput(listOf("A", "B"), listOf("x"), listOf(listOf(1), listOf(2)), listOf(listOf(0), listOf(0)))
        val invalid = listOf(
            valid.copy(participants = listOf("A")),
            valid.copy(participants = List(5) { "p$it" }),
            valid.copy(participants = listOf("A", "A")),
            valid.copy(participants = listOf("", "B")),
            valid.copy(candidates = listOf("")),
            valid.copy(candidates = listOf("x", "x")),
            valid.copy(mode = "unknown"),
            valid.copy(mode = "favor:C"),
            valid.copy(toleranceSeconds = -1),
            valid.copy(times = emptyList()),
            valid.copy(transfers = emptyList()),
            valid.copy(times = listOf(emptyList(), listOf(2))),
            valid.copy(transfers = listOf(listOf(0), emptyList())),
            valid.copy(times = listOf(listOf(-1), listOf(2))),
            valid.copy(transfers = listOf(listOf(-1), listOf(0))),
            valid.copy(times = listOf(listOf(null), listOf(2))),
            valid.copy(transfers = listOf(listOf(null), listOf(0))),
        )
        invalid.forEachIndexed { index, input -> assertFailsWith<IllegalArgumentException>("invalid case $index") { rank(input) } }
    }

    @Test
    fun oddSecondCapsRoundDownAndDoNotUseTolerance() {
        val input = RankInput(listOf("A", "B"), listOf("base", "cap", "over"), listOf(listOf(10, 1, 0), listOf(11, 16, 17)), listOf(listOf(0, 0, 0), listOf(0, 0, 0)), "favor:A", 180)
        val result = rank(input)
        assertEquals("base", result.baselineStationCode)
        assertEquals(mapOf("B" to 16L), result.favorCaps)
        assertEquals(listOf(ExcludedCandidate("over", "FAVOR_CAP_EXCEEDED")), result.excluded)
        assertTrue(result.recommendations.any { it.stationCode == "cap" })
    }

    @Test
    fun totalsAndCapsDoNotOverflowInt() {
        val input = RankInput(listOf("A", "B", "C", "D"), listOf("x"), List(4) { listOf(Int.MAX_VALUE) }, List(4) { listOf(0) }, "favor:A", Int.MAX_VALUE)
        val result = rank(input)
        assertEquals(4L * Int.MAX_VALUE, result.recommendations.single().totalSeconds)
        assertEquals(Int.MAX_VALUE.toLong() + 900, result.favorCaps?.get("B"))
    }

    @Test
    fun toleranceBandsUseMinimumAnchorAndAsciiCodeTies() {
        val input = RankInput(listOf("A", "B"), listOf("a", "b", "c"), listOf(listOf(44, 42, 40), listOf(0, 0, 0)), List(2) { List(3) { 0 } }, toleranceSeconds = 3)
        assertEquals(listOf("b", "c", "a"), rank(input).recommendations.map { it.stationCode })
        val ties = input.copy(candidates = listOf("a", "Z", "0"), times = List(2) { List(3) { 40 } }, toleranceSeconds = 0)
        assertEquals(listOf("0", "Z", "a"), rank(ties).recommendations.map { it.stationCode })
    }
}
