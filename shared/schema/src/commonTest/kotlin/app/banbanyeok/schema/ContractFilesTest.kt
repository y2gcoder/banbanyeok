package app.banbanyeok.schema

import app.banbanyeok.contracts.ContractFiles
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertTrue

class ContractFilesTest {
    @Test
    fun generatedConstantsContainContractFiles() {
        for (path in listOf(
            "golden/scenarios.json",
            "golden/expected.ranking.json",
            "golden/link-vectors.json",
            "fixtures/stations.sample.json",
            "fixtures/candidates.sample.json",
            "fixtures/manifest.sample.json",
            "fixtures/od.sample.bin",
            "events.json",
        )) {
            assertTrue(path in ContractFiles.paths, path)
        }
    }

    @Test
    fun textAndBinaryRoundTripUtf8() {
        // 한국어 설명이 들어 있는 스냅샷이 깨지지 않고 들어왔는지(escape·청크 경계 확인)
        assertTrue(ContractFiles.text("golden/expected.ranking.json").contains("오라클"))
        assertContentEquals("BBOD".encodeToByteArray(), ContractFiles.bytes("fixtures/od.sample.bin").copyOf(4))
    }
}
