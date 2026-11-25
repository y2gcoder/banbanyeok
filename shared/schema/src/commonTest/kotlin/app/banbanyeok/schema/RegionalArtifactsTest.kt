package app.banbanyeok.schema

import app.banbanyeok.contracts.ContractFiles
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class RegionalArtifactsTest {
    private val manifestText = ContractFiles.text("fixtures/${ManifestNames.REGIONAL}")
    private val manifest = ManifestCodec.parse(manifestText)
    private val saturday = TimeSlot(DayType.SATURDAY, TimeBand.DAY)

    @Test
    fun decodesTheIndependentRegionalFixture() {
        val core = DataSetLoader.load(bytes(), supportedSchema = 5)
        assertEquals(manifestText, ManifestCodec.encode(core.manifest))
        assertContentEquals(file(manifest.files.registry), RegistryCodec.encode(core.registry).encodeToByteArray())
        assertEquals(StationRegion.CAPITAL, core.registry.station("002")?.region)
        assertEquals(StationRegion.BUSAN, core.registry.station("003")?.region)
        assertEquals(core.registry.station("002")?.name, core.registry.station("003")?.name)
        assertEquals(OdMatrix.UNREACHABLE, core.od.timeSeconds(0, 1))
        assertEquals(150, core.od.timeSeconds(4, 1))
        assertEquals(OdMatrix.UNREACHABLE, core.odFor(saturday)?.timeSeconds(4, 1))
        val routeFile = requireNotNull(manifest.files.routeGraph)
        val graph = DataSetLoader.routeGraph(core, file(routeFile), RouteGraphCodec.REGIONAL_FORMAT_VERSION)
        assertContentEquals(file(routeFile), RouteGraphCodec.encode(graph))
        assertEquals(RouteGraph.UNAVAILABLE_WAIT, graph.waitsFor(saturday)[2])
    }

    @Test
    fun rejectsLegacySelectionAndInconsistentCoverage() {
        assertFailsWith<SchemaException> { DataSetLoader.load(bytes()) }
        val regions = requireNotNull(manifest.regionCoverage)
        val busan = regions.getValue(StationRegion.BUSAN)
        val inaccurate = busan.getValue(saturday.id).copy(unsupportedOrigins = emptyList())
        val changed =
            manifest.copy(
                regionCoverage =
                    regions + (StationRegion.BUSAN to (busan + (saturday.id to inaccurate))),
            )
        assertFailsWith<SchemaException> { DataSetLoader.load(bytes(changed), supportedSchema = 5) }
        val path = manifest.files.registry
        val misplaced =
            manifest.copy(
                files = manifest.files.copy(registry = path.copy(path = path.path.removePrefix("regional/"))),
            )
        assertFailsWith<SchemaException> { ManifestCodec.validate(misplaced) }
    }

    private fun file(file: ManifestFile) = ContractFiles.bytes("fixtures/${file.path}")

    private fun bytes(pointer: Manifest = manifest) =
        DataSetBytes(
            ManifestCodec.encode(pointer),
            file(manifest.files.registry),
            file(manifest.files.candidates),
            file(manifest.files.od),
            manifest.files.odSlots
                .orEmpty()
                .mapValues { file(it.value) },
        )
}
