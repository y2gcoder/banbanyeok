package app.banbanyeok.schema

import app.banbanyeok.contracts.ContractFiles
import app.banbanyeok.schema.golden.GoldenCodec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 골든 계약 파일이 commonTest 소스 상수로 들어와 모든 타깃에서 같은 데이터로 파싱되는지,
 * 스냅샷이 스스로 일관적인지(시나리오와 id 일치, 1위 일치, 합계 재계산)를 확인한다.
 * 알고리즘 자체를 재현하는 테스트는 P1(shared/core)의 몫이다.
 */
class GoldenContractTest {
    private val scenarios = GoldenCodec.parseScenarios(ContractFiles.text("golden/scenarios.json"))
    private val expected = GoldenCodec.parseExpected(ContractFiles.text("golden/expected.ranking.json"))

    @Test
    fun scenariosAndSnapshotCoverSameIds() {
        assertEquals(16, scenarios.size)
        assertEquals(scenarios.map { it.id }, expected.scenarios.map { it.id })
        assertEquals("minutes", expected.unit)
    }

    @Test
    fun snapshotFirstRankMatchesScenarioExpectation() {
        for ((scenario, snapshot) in scenarios.zip(expected.scenarios)) {
            assertEquals(scenario.input.mode, snapshot.mode, scenario.id)
            assertEquals("ok", snapshot.status, scenario.id)
            assertEquals(scenario.expectedFirst, snapshot.ranking.first().stationId, scenario.id)
        }
    }

    @Test
    fun snapshotRowsAreInternallyConsistent() {
        for (snapshot in expected.scenarios) {
            val participantCount =
                snapshot.ranking
                    .first()
                    .times.size
            snapshot.ranking.forEachIndexed { index, row ->
                assertEquals(index + 1, row.rank, snapshot.id)
                assertEquals(participantCount, row.times.size, snapshot.id)
                assertEquals(participantCount, row.transfers.size, snapshot.id)
                assertEquals(row.times.max(), row.maxMinutes, snapshot.id)
                assertEquals(row.times.max() - row.times.min(), row.spreadMinutes, snapshot.id)
                assertEquals(row.times.sum(), row.totalMinutes, snapshot.id)
                assertTrue(row.reasonCode.isNotBlank())
            }
        }
    }

    @Test
    fun snapshotRowsMatchInputMatrices() {
        for ((scenario, snapshot) in scenarios.zip(expected.scenarios)) {
            val input = scenario.input
            for (row in snapshot.ranking) {
                val column = input.candidates.indexOf(row.stationId)
                assertTrue(column >= 0, "${scenario.id}: ${row.stationId}")
                input.participants.indices.forEach { person ->
                    assertEquals(input.times[person][column], row.times[person], "${scenario.id}/${row.stationId}")
                    assertEquals(
                        input.transfers[person][column],
                        row.transfers[person],
                        "${scenario.id}/${row.stationId}",
                    )
                }
            }
        }
    }
}
