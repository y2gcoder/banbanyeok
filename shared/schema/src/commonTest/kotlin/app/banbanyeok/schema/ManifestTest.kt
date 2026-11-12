package app.banbanyeok.schema

import app.banbanyeok.contracts.ContractFiles
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ManifestTest {
    private val manifestText = ContractFiles.text("fixtures/manifest.sample.json")
    private val registryBytes = ContractFiles.bytes("fixtures/stations.sample.json")
    private val candidatesBytes = ContractFiles.bytes("fixtures/candidates.sample.json")
    private val odBytes = ContractFiles.bytes("fixtures/od.sample.bin")

    @Test
    fun parsesFixtureAndWritesSameBytesAsPython() {
        val manifest = ManifestCodec.parse(manifestText)
        assertEquals("20261112.1", manifest.dataVersion)
        assertNull(manifest.previousDataVersion)
        assertEquals(18, manifest.originCount)
        assertEquals(manifestText, ManifestCodec.encode(manifest))
    }

    @Test
    fun fixtureHashesMatchKotlinSha256() {
        val manifest = ManifestCodec.parse(manifestText)
        assertTrue(manifest.files.registry.matches(registryBytes))
        assertTrue(manifest.files.candidates.matches(candidatesBytes))
        assertTrue(manifest.files.od.matches(odBytes))
        assertTrue(manifest.files.od.path.contains(manifest.files.od.sha256.take(16)))
    }

    @Test
    fun loadsConsistentDataSet() {
        val set = loadFixtureSet()
        assertEquals(18, set.registry.stations.size)
        assertEquals(6, set.candidates.candidates.size)
    }

    @Test
    fun rejectsTamperedFiles() {
        fun load(registry: ByteArray = registryBytes, candidates: ByteArray = candidatesBytes, od: ByteArray = odBytes) =
            DataSetLoader.load(manifestText, registry, candidates, od)
        assertFailsWith<SchemaException> { load(od = odBytes.copyOf().also { it[odBytes.size - 1] = 9 }) }
        assertFailsWith<SchemaException> { load(od = odBytes.copyOf(odBytes.size - 1)) }
        assertFailsWith<SchemaException> { load(registry = registryBytes + byteArrayOf(10)) }
        assertFailsWith<SchemaException> { load(candidates = candidatesBytes.copyOf().also { it[it.size - 3] = 'x'.code.toByte() }) }
    }

    @Test
    fun rejectsClientTooOld() {
        assertFailsWith<SchemaException> {
            DataSetLoader.load(manifestText, registryBytes, candidatesBytes, odBytes, supportedSchema = 0)
        }
    }

    @Test
    fun rejectsInconsistentManifest() {
        val base = ManifestCodec.parse(manifestText)
        fun mutated(change: (Manifest) -> Manifest) =
            assertFailsWith<SchemaException> {
                DataSetLoader.load(ManifestCodec.encode(change(base)), registryBytes, candidatesBytes, odBytes)
            }
        mutated { it.copy(originCount = 17) }
        mutated { it.copy(registryVersion = 2) }
        mutated { it.copy(schemaVersion = 2) } // 레지스트리 schemaVersion 1과 다름
    }

    @Test
    fun structuralValidation() {
        val base = ManifestCodec.parse(manifestText)
        val bad = listOf(
            base.copy(dataVersion = "2026-11-12"),
            base.copy(generatedAt = "2026-11-12T00:00:00+09:00"),
            base.copy(minClientSchema = 2),
            base.copy(previousDataVersion = "20261112.2"),
            base.copy(files = base.files.copy(od = base.files.od.copy(path = "../od.bin"))),
            base.copy(files = base.files.copy(od = base.files.od.copy(path = "/abs/od.bin"))),
            base.copy(files = base.files.copy(od = base.files.od.copy(sha256 = "ABC"))),
        )
        for (manifest in bad) assertFailsWith<SchemaException>(manifest.toString()) { ManifestCodec.validate(manifest) }
        // N=10 같은 두 자리 순번도 올바르게 비교된다
        ManifestCodec.validate(base.copy(dataVersion = "20261112.10", previousDataVersion = "20261112.9"))
    }

    @Test
    fun rejectsUnknownKeysAndBrokenJson() {
        assertFailsWith<SchemaException> { ManifestCodec.parse(manifestText.replace("\"timeModel\"", "\"extra\": 1,\n  \"timeModel\"")) }
        assertFailsWith<SchemaException> { ManifestCodec.parse("{") }
        assertFailsWith<SchemaException> { ManifestCodec.parse("{}") }
    }
}
