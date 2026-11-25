package app.banbanyeok.schema

import app.banbanyeok.contracts.ContractFiles
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** rg.bin(data-format §11)과 manifest 세대 4. 장난감 픽스처의 역마다 노드 하나를 두고 코드 순서로 잇는다. */
class RouteGraphTest {
    private val v1 = ManifestCodec.parse(ContractFiles.text("fixtures/manifest.sample.json"))
    private val registry = ContractFiles.bytes("fixtures/stations.sample.json")
    private val candidates = ContractFiles.bytes("fixtures/candidates.sample.json")
    private val odBytes = ContractFiles.bytes("fixtures/od.sample.bin")
    private val od = OdBinCodec.decode(odBytes)
    private val codes = (od.rawOrigins + od.rawCandidates).distinct().sorted()
    private val none = RouteGraph.NO_WAIT

    /** 역마다 노드 하나(계통 0 = "2호선"), 이웃끼리 양방향 60초. 첫 역에는 계통 1("4호선") 노드를 더해 갈아타는 간선으로 잇는다. */
    private fun graph(
        stations: List<Int> = codes,
        registryVersion: Int = od.registryVersion,
    ): RouteGraph {
        val nodeCodes = stations + stations.first()
        val services = List(stations.size) { 0 } + 1
        val edges = List(nodeCodes.size) { mutableListOf<Triple<Int, Int, Int>>() }
        for (i in 0 until stations.size - 1) {
            edges[i].add(Triple(i + 1, 60, none))
            edges[i + 1].add(Triple(i, 60, none))
        }
        val extra = stations.size
        edges[0].add(Triple(extra, 30, 1))
        edges[extra].add(Triple(0, 30, 0))
        val starts = IntArray(nodeCodes.size + 1)
        edges.forEachIndexed { v, list -> starts[v + 1] = starts[v] + list.size }
        val flat = edges.flatten()
        return RouteGraph(
            registryVersion,
            listOf("2호선", "4호선"),
            intArrayOf(0, 1),
            nodeCodes.toIntArray(),
            services.toIntArray(),
            starts,
            flat.map { it.first }.toIntArray(),
            flat.map { it.second }.toIntArray(),
            flat.map { it.third }.toIntArray(),
            TimeSlot.ALL.mapIndexed { i, _ -> intArrayOf(60 + i, 90 + i) },
        )
    }

    private val rg = RouteGraphCodec.encode(graph())
    private val others = TimeSlot.ALL.filter { it != TimeSlot.DEFAULT }
    private val v4 =
        v1.copy(
            schemaVersion = 4,
            minClientSchema = 4,
            files =
                v1.files.copy(
                    odSlots =
                        others.associate {
                            it.id to
                                ManifestFile("versions/x/od-${it.id}.bin", Sha256.hex(odBytes), odBytes.size.toLong())
                        },
                    lastTrain = ManifestFile("versions/x/lt.bin", Sha256.hex(byteArrayOf()), 0),
                    routeGraph = ManifestFile("versions/x/rg.bin", Sha256.hex(rg), rg.size.toLong()),
                ),
            lastTrainAsOf = "2026-11-16",
            lastTrainModel = "chain-v1",
        )

    private fun core(manifest: Manifest = v4) =
        DataSetLoader.load(
            DataSetBytes(ManifestCodec.encode(manifest), registry, candidates, odBytes),
            deferSlots = true,
        )

    @Test
    fun roundTripsAndKeepsTheHeader() {
        val decoded = RouteGraphCodec.decode(rg)
        assertContentEquals(rg, RouteGraphCodec.encode(decoded))
        assertEquals("BBRG", rg.copyOf(4).decodeToString())
        assertEquals(codes.size + 1, decoded.nodeCount)
        assertEquals("4호선", decoded.lineOf(codes.size))
        assertEquals(RouteGraph.NO_WAIT, decoded.edgeWaitService(decoded.edgeStart(0)))
        val slot = TimeSlot.ALL.indexOf(TimeSlot.DEFAULT)
        assertContentEquals(intArrayOf(60 + slot, 90 + slot), decoded.waitsFor(TimeSlot.DEFAULT))
        assertContentEquals(intArrayOf(0, codes.size), decoded.platforms.getValue(codes.first()))
    }

    @Test
    fun rejectsMalformedBytes() {
        assertFailsWith<SchemaException> { RouteGraphCodec.decode(rg.copyOf(rg.size - 1)) }
        assertFailsWith<SchemaException> { RouteGraphCodec.decode(rg + byteArrayOf(0)) }
        assertFailsWith<SchemaException> { RouteGraphCodec.decode(rg.copyOf().also { it[0] = 'X'.code.toByte() }) }
        assertFailsWith<SchemaException> { RouteGraphCodec.decode(rg.copyOf().also { it[4] = 3 }) }
        assertFailsWith<SchemaException> { RouteGraphCodec.decode(rg.copyOf().also { it[8] = 1 }) }
        // 구분 수(오프셋 28)는 12여야 한다.
        assertFailsWith<SchemaException> { RouteGraphCodec.decode(rg.copyOf().also { it[28] = 11 }) }
    }

    @Test
    fun versionOneRejectsUnavailableBoardingWithoutOutdoorTransfers() {
        val unavailable = rg.copyOf()
        unavailable[unavailable.lastIndex - 1] = 0xff.toByte()
        unavailable[unavailable.lastIndex] = 0xff.toByte()
        assertFailsWith<SchemaException> { RouteGraphCodec.decode(unavailable) }
    }

    @Test
    fun versionTwoRoundTripsOutdoorTransfersAndUnavailableBoarding() {
        fun graph(
            version: Int,
            seconds: Int,
        ) = RouteGraph(
            1,
            listOf("부산1호선", "동해선"),
            intArrayOf(0, 1),
            intArrayOf(1, 2),
            intArrayOf(0, 1),
            intArrayOf(0, 1, 2),
            intArrayOf(1, 0),
            intArrayOf(seconds, seconds),
            intArrayOf(1, 0),
            TimeSlot.ALL.map { intArrayOf(90, RouteGraph.UNAVAILABLE_WAIT) },
            formatVersion = version,
        )
        val encoded = RouteGraphCodec.encode(graph(2, 221))
        val decoded = RouteGraphCodec.decode(encoded)
        assertEquals(2, decoded.formatVersion)
        assertContentEquals(encoded, RouteGraphCodec.encode(decoded))
        assertEquals(mapOf(1 to mapOf(2 to 221), 2 to mapOf(1 to 221)), decoded.outdoorWalks)
        assertContentEquals(intArrayOf(90, RouteGraph.UNAVAILABLE_WAIT), decoded.waitsFor(TimeSlot.DEFAULT))
        assertFailsWith<SchemaException> { graph(1, 221) }
        assertFailsWith<SchemaException> { graph(2, 0) }
    }

    @Test
    fun rejectsInvalidGraphs() {
        val g = graph()

        fun copy(
            targets: IntArray = IntArray(g.edgeCount) { g.edgeTarget(it) },
            times: IntArray = IntArray(g.edgeCount) { g.edgeSeconds(it) },
            waits: IntArray = IntArray(g.edgeCount) { g.edgeWaitService(it) },
            lines: List<String> = g.lines,
        ) = RouteGraph(
            g.registryVersion,
            lines,
            intArrayOf(0, 1),
            IntArray(g.nodeCount) { g.codeValue(it) },
            IntArray(g.nodeCount) { g.service(it) },
            IntArray(g.nodeCount + 1) { if (it == g.nodeCount) g.edgeCount else g.edgeStart(it) },
            targets,
            times,
            waits,
            TimeSlot.ALL.map { g.waitsFor(it) },
        )
        copy()
        assertFailsWith<SchemaException> { copy(targets = IntArray(g.edgeCount) { g.nodeCount }) }
        // 타고 가는 간선은 0초일 수 없고, 갈아타는 간선의 걷기는 0초여도 된다.
        assertFailsWith<SchemaException> { copy(times = IntArray(g.edgeCount)) }
        copy(times = IntArray(g.edgeCount) { if (g.edgeWaitService(it) == RouteGraph.NO_WAIT) 60 else 0 })
        assertFailsWith<SchemaException> { copy(waits = IntArray(g.edgeCount) { 2 }) }
        assertFailsWith<SchemaException> { copy(lines = listOf("2호선", "2호선")) }
    }

    @Test
    fun generationFourCarriesTheGraphAndOlderGenerationsDoNot() {
        ManifestCodec.validate(v4)
        assertFailsWith<SchemaException> { ManifestCodec.validate(v4.copy(files = v4.files.copy(routeGraph = null))) }
        val three = v4.generationThree()
        assertEquals(3, three.schemaVersion)
        assertNull(three.files.routeGraph)
        assertTrue("routeGraph" !in ManifestCodec.encode(three))
        assertEquals(v4.files.lastTrain, three.files.lastTrain)
        assertFailsWith<SchemaException> {
            ManifestCodec.validate(three.copy(files = three.files.copy(routeGraph = v4.files.routeGraph)))
        }
        assertNull(v4.generationTwo().files.routeGraph)
        assertNull(v4.generationOne().files.routeGraph)
        assertFailsWith<SchemaException> { v4.generationTwo().generationThree() }
        // 세대 4 manifest를 세대 3까지만 아는 클라이언트는 거부한다.
        assertFailsWith<SchemaException> {
            DataSetLoader.load(
                DataSetBytes(ManifestCodec.encode(v4), registry, candidates, odBytes),
                supportedSchema = 3,
                deferSlots = true,
            )
        }
    }

    @Test
    fun loadsTheGraphAgainstTheCoreDataSet() {
        val loaded = DataSetLoader.routeGraph(core(), rg)
        assertContentEquals(rg, RouteGraphCodec.encode(loaded))
    }

    @Test
    fun regionalFormatRequiresAnExplicitLoaderSelection() {
        val regional = rg.copyOf().also { it[4] = RouteGraphCodec.REGIONAL_FORMAT_VERSION.toByte() }
        val pointers =
            v4.files.copy(
                routeGraph = ManifestFile("regional/rg.bin", Sha256.hex(regional), regional.size.toLong()),
            )
        val dataSet = core(v4.copy(files = pointers))
        assertFailsWith<SchemaException> { DataSetLoader.routeGraph(dataSet, regional) }
        val loaded = DataSetLoader.routeGraph(dataSet, regional, RouteGraphCodec.REGIONAL_FORMAT_VERSION)
        assertContentEquals(regional, RouteGraphCodec.encode(loaded))
    }

    @Test
    fun rejectsAGraphThatDoesNotBelongToTheDataSet() {
        assertFailsWith<SchemaException> { DataSetLoader.routeGraph(core(), rg.copyOf().also { it[rg.size - 1] = 9 }) }

        fun pointingAt(bytes: ByteArray) =
            v4.copy(
                files =
                    v4.files.copy(
                        routeGraph = ManifestFile("versions/x/rg.bin", Sha256.hex(bytes), bytes.size.toLong()),
                    ),
            )
        // 해시는 맞지만 od.bin의 역 하나에 노드가 없다.
        val missing = RouteGraphCodec.encode(graph(stations = codes.drop(1)))
        assertFailsWith<SchemaException> { DataSetLoader.routeGraph(core(pointingAt(missing)), missing) }
        // 레지스트리에 없는 역의 노드.
        val known = RegistryCodec.parse(registry.decodeToString()).stations.map { StationCode.parse(it.code).value }
        val unknown = (0 until StationCode.CAPACITY).first { value -> value !in known }
        val extra = RouteGraphCodec.encode(graph(stations = codes + unknown))
        assertFailsWith<SchemaException> { DataSetLoader.routeGraph(core(pointingAt(extra)), extra) }
        val otherRegistry = RouteGraphCodec.encode(graph(registryVersion = od.registryVersion + 1))
        assertFailsWith<SchemaException> { DataSetLoader.routeGraph(core(pointingAt(otherRegistry)), otherRegistry) }
        // 세대 3 데이터에는 노선 그래프가 없다.
        assertFailsWith<SchemaException> { DataSetLoader.routeGraph(core(v4.generationThree()), rg) }
    }
}
