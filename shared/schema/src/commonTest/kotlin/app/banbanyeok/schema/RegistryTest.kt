package app.banbanyeok.schema

import app.banbanyeok.contracts.ContractFiles
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class RegistryTest {
    private val registryText = ContractFiles.text("fixtures/stations.sample.json")
    private val candidatesText = ContractFiles.text("fixtures/candidates.sample.json")
    private val registry = RegistryCodec.parse(registryText)

    @Test
    fun parsesFixtureAndWritesSameBytesAsPython() {
        assertEquals(18, registry.stations.size)
        assertEquals(registryText, RegistryCodec.encode(registry))
        val candidates = RegistryCodec.parseCandidates(candidatesText)
        assertEquals(candidatesText, RegistryCodec.encodeCandidates(candidates))
        RegistryCodec.validateAgainst(candidates, registry)
    }

    @Test
    fun placeholderRegistryShapeIsValid() {
        val empty = """{"schemaVersion":1,"registryVersion":1,"stations":[]}"""
        assertEquals(0, RegistryCodec.parse(empty).stations.size)
    }

    private fun mutated(change: (List<Station>) -> List<Station>, version: Int = registry.registryVersion) =
        registry.copy(registryVersion = version, stations = change(registry.stations))

    @Test
    fun validationRejectsBrokenRegistries() {
        val first = registry.stations.first()
        val bad = listOf(
            mutated({ it.reversed() }), // 오름차순 위반
            mutated({ it + first }), // 중복
            mutated({ listOf(first.copy(code = "ABC")) }),
            mutated({ listOf(first.copy(name = " ")) }),
            mutated({ listOf(first.copy(lat = 91.0)) }),
            mutated({ listOf(first.copy(addedIn = 2)) }),
            mutated({ listOf(first.copy(deprecatedIn = 1)) }), // active인데 deprecatedIn
            mutated({ listOf(first.copy(status = StationStatus.DEPRECATED)) }), // deprecatedIn 없음
            mutated({ listOf(first.copy(status = StationStatus.DEPRECATED, deprecatedIn = 1, replacedBy = "zzz")) }),
        )
        for (r in bad) assertFailsWith<SchemaException> { RegistryCodec.validate(r) }
        assertFailsWith<SchemaException> { RegistryCodec.parse(registryText.replace("\"schemaVersion\": 1", "\"schemaVersion\": 9")) }
        assertFailsWith<SchemaException> { RegistryCodec.parse(registryText.replace("\"code\"", "\"kode\"")) }
    }

    @Test
    fun candidatesMustBeActiveAndKnown() {
        val unknown = CandidateList(1, 1, listOf("zzz"))
        assertFailsWith<SchemaException> { RegistryCodec.validateAgainst(unknown, registry) }
        val code = registry.stations.first().code
        val deprecated = mutated({ list ->
            listOf(list.first().copy(status = StationStatus.DEPRECATED, deprecatedIn = 1)) + list.drop(1)
        })
        assertFailsWith<SchemaException> {
            RegistryCodec.validateAgainst(CandidateList(1, 1, listOf(code)), deprecated)
        }
        assertFailsWith<SchemaException> { RegistryCodec.validate(CandidateList(1, 1, listOf("b00", "a00"))) }
        assertFailsWith<SchemaException> { RegistryCodec.validate(CandidateList(1, 1, listOf("a00", "a00"))) }
    }

    @Test
    fun appendOnlyAcceptsAdditionsAndDeprecation() {
        val newStation = registry.stations.last().copy(code = "zzz", name = "신설", addedIn = 2)
        val grown = registry.copy(
            registryVersion = 2,
            stations = registry.stations.map {
                if (it === registry.stations.first()) it.copy(status = StationStatus.DEPRECATED, deprecatedIn = 2) else it
            } + newStation,
        )
        assertEquals(emptyList(), RegistryCompatibility.checkAppendOnly(registry, grown))
        RegistryCodec.validate(grown)
    }

    @Test
    fun appendOnlyRejectsRemovalsAndSilentChanges() {
        val removed = registry.copy(registryVersion = 2, stations = registry.stations.drop(1))
        val violations = RegistryCompatibility.checkAppendOnly(registry, removed)
        assertTrue(violations.single().contains(registry.stations.first().code))

        val sameVersionChanged = registry.copy(stations = registry.stations.drop(1))
        assertTrue(RegistryCompatibility.checkAppendOnly(registry, sameVersionChanged).size >= 2)

        val lowered = registry.copy(registryVersion = 0)
        assertTrue(RegistryCompatibility.checkAppendOnly(registry, lowered).isNotEmpty())

        val reactivated = registry.copy(
            registryVersion = 3,
            stations = registry.stations.map { it.copy(addedIn = it.addedIn) },
        )
        val deprecatedFirst = registry.copy(
            registryVersion = 2,
            stations = registry.stations.mapIndexed { i, s ->
                if (i == 0) s.copy(status = StationStatus.DEPRECATED, deprecatedIn = 2) else s
            },
        )
        assertTrue(RegistryCompatibility.checkAppendOnly(deprecatedFirst, reactivated).single().contains("되돌려졌습니다"))
    }
}

class CoordinateFormatTest {
    @Test
    fun formatsIdenticallyOnEveryPlatform() {
        assertEquals("127.0", Coordinate6Serializer.format(127.0))
        assertEquals("37.5", Coordinate6Serializer.format(37.5))
        assertEquals("127.01", Coordinate6Serializer.format(127.01))
        assertEquals("37.566535", Coordinate6Serializer.format(37.5665349))
        assertEquals("-33.5", Coordinate6Serializer.format(-33.5))
        assertEquals("0.0", Coordinate6Serializer.format(-0.0000001))
    }
}
