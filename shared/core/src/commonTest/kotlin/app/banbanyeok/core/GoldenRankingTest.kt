package app.banbanyeok.core

import app.banbanyeok.contracts.ContractFiles
import app.banbanyeok.schema.golden.GoldenCodec
import kotlin.test.Test
import kotlin.test.assertEquals

class GoldenRankingTest {
    @Test
    fun allSixteenFullRankingsMatchOracle() {
        val scenarios = GoldenCodec.parseScenarios(ContractFiles.text("golden/scenarios.json"))
        val expected = GoldenCodec.parseExpected(ContractFiles.text("golden/expected.ranking.json"))
        assertEquals("minutes", expected.unit)
        assertEquals(16, scenarios.size)
        assertEquals(scenarios.map { it.id }, expected.scenarios.map { it.id })
        for ((scenario, snapshot) in scenarios.zip(expected.scenarios)) {
            val input = scenario.input
            val actual = rank(
                RankInput(
                    input.participants,
                    input.candidates,
                    input.times.map { row -> row.map { it?.let { (it * 60).toInt() } } },
                    input.transfers,
                    input.mode,
                    (input.tolerance * 60).toInt(),
                ),
            )
            val expectedRows = snapshot.ranking.map { row ->
                Candidate(
                    row.rank,
                    row.stationId,
                    input.participants.mapIndexed { i, id ->
                        PersonalTime(id, (row.times[i] * 60).toInt(), row.transfers[i])
                    },
                    (row.maxMinutes * 60).toInt(),
                    (row.spreadMinutes * 60).toInt(),
                    (row.totalMinutes * 60).toLong(),
                    row.favoredMinutes?.let { (it * 60).toInt() },
                    row.reasonCode,
                )
            }
            assertEquals(
                RankResult(
                    snapshot.status,
                    snapshot.mode,
                    input.participants,
                    (snapshot.toleranceMinutes * 60).toInt(),
                    snapshot.baselineStationId,
                    snapshot.favorCaps?.mapValues { (_, value) -> (value * 60).toLong() },
                    expectedRows,
                    snapshot.excluded.map { ExcludedCandidate(it.stationId, it.reasonCode) },
                ),
                actual,
                scenario.id,
            )
        }
    }
}
