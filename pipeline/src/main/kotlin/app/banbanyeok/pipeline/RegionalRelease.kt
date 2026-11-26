package app.banbanyeok.pipeline

import app.banbanyeok.core.RouteCost
import app.banbanyeok.core.RouteSearch
import app.banbanyeok.schema.CandidateList
import app.banbanyeok.schema.DataSet
import app.banbanyeok.schema.DataSetBytes
import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainCell
import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.schema.LtBinCodec
import app.banbanyeok.schema.Manifest
import app.banbanyeok.schema.ManifestCodec
import app.banbanyeok.schema.ManifestFile
import app.banbanyeok.schema.ManifestFiles
import app.banbanyeok.schema.ManifestNames
import app.banbanyeok.schema.OdBinCodec
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.REGIONAL_MANIFEST_GENERATION
import app.banbanyeok.schema.REGIONAL_REGISTRY_SCHEMA_VERSION
import app.banbanyeok.schema.RegionalSlotCoverage
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.RegistryCodec
import app.banbanyeok.schema.RouteGraph
import app.banbanyeok.schema.RouteGraphCodec
import app.banbanyeok.schema.Sha256
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.StationRegion
import app.banbanyeok.schema.TimeSlot
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.deleteRecursively
import kotlin.io.path.exists
import kotlin.io.path.readBytes
import kotlin.io.path.readText
import kotlin.io.path.writeBytes
import kotlin.io.path.writeText

/*
 * The regional generation (manifest 5, data-format §12, ADR-0008): the capital and Busan in one national set, published
 * next to the capital generations under `regional/`. Only a server started with REGIONAL_ARTIFACTS=true reads it, and
 * the web turns regions on when its station index is built from it. It is published only if its every capital cell is
 * the capital set's own: each slot matrix and the last-train table projected on the capital axes encode to the capital
 * files byte for byte, and the regional route graph recomputes the capital matrices.
 */

private const val HASH_PREFIX_LENGTH = 16
private const val REGIONAL_LAST_TRAIN_MODEL = "busan-direct-1"

/** A file of the regional set: its published path (`regional/versions/<dataVersion>/<kind>.<hash16>.<ext>`) and bytes. */
private class RegionalFile(
    name: String,
    version: String,
    val content: ByteArray,
) {
    val receipt: ManifestFile =
        Sha256.hex(content).let { sha ->
            val stem = name.substringBeforeLast('.')
            val extension = name.substringAfterLast('.')
            ManifestFile(
                "${ManifestNames.REGIONAL_VERSIONS}/$version/$stem.${sha.take(HASH_PREFIX_LENGTH)}.$extension",
                sha,
                content.size.toLong(),
            )
        }
}

/** What the regional files are made of, before they are encoded. */
private class RegionalParts(
    val capital: DataSet,
    val registry: Registry,
    val coverage: Map<StationRegion, Map<String, RegionalSlotCoverage>>,
    val matrices: Map<TimeSlot, OdMatrix>,
    val lastTrains: LastTrainTable,
    val graph: ByteArray,
)

/** The regional files by published path, and the manifest that points to them. */
private class RegionalFiles(
    val files: Map<String, RegionalFile>,
    val manifestText: String,
)

/**
 * `regional-build`: the regional set from the capital raw sources, the dev capital set and the Busan network [input],
 * written to [out]`/regional`. The data version and generation time are the dev capital set's, so the same inputs
 * write the same bytes, and a capital rebuild without a regional one is caught by [verifyRegionalProjection].
 */
@OptIn(kotlin.io.path.ExperimentalPathApi::class)
internal fun regionalBuild(
    root: Path,
    input: Path,
    out: Path,
) {
    val dev = root.resolve("data/artifacts/dev")
    val capital = loadDevArtifacts(dev)
    val capitalLastTrains = requireNotNull(loadDevLastTrains(dev, capital)) { "dev artifacts have no last-train table" }
    require(capital.registry == RegistryCodec.parse(root.resolve("data/registry/stations.json").readText())) {
        "dev artifacts were not built from the committed registry; rebuild the capital set first"
    }
    val parts = regionalParts(root, input, capital)
    val encoded = regionalFiles(parts)
    val regional = verifyRegionalSet(encoded.manifestText) { path -> requireNotNull(encoded.files[path]).content }
    verifyRegionalProjection(capital, capitalLastTrains, regional)
    verifyRegionalSeo(root, capital, regional.dataSet)

    val folder = out.resolve("regional")
    if (folder.exists()) folder.deleteRecursively()
    encoded.files.values.forEach { staged ->
        val target = out.resolve(staged.receipt.path)
        target.parent.createDirectories()
        target.writeBytes(staged.content)
    }
    out.resolve(ManifestNames.REGIONAL).writeText(encoded.manifestText)
    println(jsonText(regionalSummary(parts, encoded)))
}

private fun regionalParts(
    root: Path,
    input: Path,
    capital: DataSet,
): RegionalParts {
    val registry = capital.registry
    val services = readBusanServices(root, input)
    val transfers =
        BusanTransfers(
            parseObject(root.resolve("data/config/busan-services.json").readText()).getValue("transfers").jsonObject,
        )
    val busanSlots = TimeSlot.ALL.associateWith { busanNetwork(registry, services, transfers, it) }
    for ((slot, network) in busanSlots) {
        if (RouteGraph.UNAVAILABLE_WAIT !in network.waits.values) {
            val gate = graphGate(network, matrixCosts(network))
            require(gate.passed) { "Busan $slot graph gate failed: ${gate.json}" }
        }
    }
    val context = StageContext(root)
    val combined = busanSlots.mapValues { (slot, busan) -> combineRegions(context.slots.getValue(slot), busan) }
    val busanOrigins = busanSlots.getValue(TimeSlot.DEFAULT).origins
    val busanCodes = busanOrigins.map { it.code }.toSet()
    val graph = RouteGraphCodec.encode(regionalRouteGraph(context, combined, services))
    val regionalRegistry = regionalRegistry(root, registry, busanCodes, combined.getValue(TimeSlot.DEFAULT))
    val busanCandidates = candidateCodes(root, busanOrigins.associateBy { it.code })
    val candidates =
        CandidateList(1, registry.registryVersion, (capital.candidates.candidates + busanCandidates).sorted())
    val coverage = regionCoverage(RouteGraphCodec.decode(graph), busanCodes, regionalRegistry)
    val matrices =
        combined.mapValues { (slot, network) ->
            val unsupported = coverage.values.flatMap { it.getValue(slot.id).unsupportedOrigins }.toSet()
            regionalMatrix(network, registry.registryVersion, candidates.candidates, unsupported)
        }
    val lastTrains = regionalLastTrains(root, input, busanOrigins).table
    return RegionalParts(capital, regionalRegistry, coverage, matrices, lastTrains, graph)
}

private fun regionalFiles(parts: RegionalParts): RegionalFiles {
    val capital = parts.capital.manifest
    val version = capital.dataVersion
    val files = linkedMapOf<String, RegionalFile>()

    fun file(
        name: String,
        bytes: ByteArray,
    ): ManifestFile {
        val staged = RegionalFile(name, version, bytes)
        files[staged.receipt.path] = staged
        return staged.receipt
    }
    val default = parts.matrices.getValue(TimeSlot.DEFAULT)
    val candidates =
        CandidateList(
            1,
            parts.registry.registryVersion,
            List(default.candidateCount) { default.candidateCode(it).toString() },
        )
    val od = file("od.bin", OdBinCodec.encode(default))
    val byContent = mutableMapOf(od.sha256 to od)
    val slotFiles =
        TimeSlot.ALL.filter { it != TimeSlot.DEFAULT }.associate { slot ->
            val bytes = OdBinCodec.encode(parts.matrices.getValue(slot))
            slot.id to byContent.getOrPut(Sha256.hex(bytes)) { file(odFileName(slot), bytes) }
        }
    val manifest =
        Manifest(
            REGIONAL_MANIFEST_GENERATION,
            REGIONAL_MANIFEST_GENERATION,
            version,
            generatedAt = capital.generatedAt,
            registryVersion = parts.registry.registryVersion,
            timeModel = capital.timeModel,
            originCount = default.originCount,
            candidateCount = default.candidateCount,
            files =
                ManifestFiles(
                    file("stations.json", jsonText(RegistryCodec.encode(parts.registry)).toByteArray()),
                    file("candidates.json", jsonText(RegistryCodec.encodeCandidates(candidates)).toByteArray()),
                    od,
                    odSlots = slotFiles,
                    lastTrain = file(LT_FILE, LtBinCodec.encode(parts.lastTrains)),
                    routeGraph = file(RG_FILE, parts.graph),
                ),
            lastTrainAsOf = capital.lastTrainAsOf,
            lastTrainModel = "${capital.lastTrainModel}+$REGIONAL_LAST_TRAIN_MODEL",
            lastTrainPartialDays = capital.lastTrainPartialDays,
            regionCoverage = parts.coverage,
        )
    return RegionalFiles(files, jsonText(ManifestCodec.encode(manifest)))
}

private fun regionalSummary(
    parts: RegionalParts,
    encoded: RegionalFiles,
): JsonObject =
    obj(
        "dataVersion" to parts.capital.manifest.dataVersion,
        "origins" to parts.matrices.getValue(TimeSlot.DEFAULT).originCount,
        "candidates" to parts.matrices.getValue(TimeSlot.DEFAULT).candidateCount,
        "registryStations" to parts.registry.stations.size,
        "omittedStations" to parts.capital.registry.stations.size - parts.registry.stations.size,
        "files" to encoded.files.size,
        "bytes" to encoded.files.values.sumOf { it.content.size },
        "regionCoverage" to
            JsonObject(
                parts.coverage.mapKeys { it.key.name.lowercase() }.mapValues { (_, slots) ->
                    JsonObject(
                        slots.mapValues { (_, value) ->
                            obj(
                                "available" to value.available,
                                "missingServices" to value.missingServices,
                                "unsupportedOrigins" to value.unsupportedOrigins.size,
                            )
                        },
                    )
                },
            ),
        "capitalProjection" to "byte-identical",
    )

/**
 * The registry 2판: every station of a supported region with its region. Busan stations are the Busan network's (M1
 * 권역 부산, via the network input); capital stations are those inside the capital coordinate window the pipeline and
 * the web station index already use. Stations of regions not supported yet (대구·대전·광주, 양원) are left out: none of
 * them may be on a graph, an axis or a kept station's `replacedBy`.
 */
internal fun regionalRegistry(
    root: Path,
    registry: Registry,
    busanCodes: Set<String>,
    combined: Network,
): Registry {
    val physical =
        requireNotNull(NetworkRules(parseObject(root.resolve("data/config/network-rules.json").readText())).physical)
    val regions =
        registry.stations.associate { station ->
            station.code to
                when {
                    station.code in busanCodes -> StationRegion.BUSAN.also { require(!physical.inScope(station)) }
                    physical.inScope(station) -> StationRegion.CAPITAL
                    else -> null
                }
        }
    val graphCodes = combined.nodes.map { it.first }.toSet()
    val kept = registry.stations.filter { regions[it.code] != null }
    val omitted = registry.stations.map { it.code }.toSet() - kept.map { it.code }.toSet()
    require(graphCodes.none { it in omitted }) { "A graph station has no supported region" }
    require(kept.none { it.replacedBy in omitted }) { "A kept station is replaced by a station of no supported region" }
    for (station in kept) {
        val region = regions.getValue(station.code)
        require(station.code !in graphCodes || (region == StationRegion.BUSAN) == (station.code in busanCodes)) {
            "${station.code}: region does not match its graph"
        }
    }
    return Registry(
        REGIONAL_REGISTRY_SCHEMA_VERSION,
        registry.registryVersion,
        kept.map { it.copy(region = regions.getValue(it.code)) },
    )
}

/**
 * Per region and slot: which services the slot has no headway for, which origins cannot board without them, and
 * whether the rest is usable (two or more origins, all connected). The capital always has every service.
 */
private fun regionCoverage(
    graph: RouteGraph,
    busanCodes: Set<String>,
    registry: Registry,
): Map<StationRegion, Map<String, RegionalSlotCoverage>> {
    val regionOf = registry.stations.associate { StationCode.parse(it.code).value to it.region }
    val busanServices =
        (0 until graph.nodeCount)
            .filter {
                regionOf[
                    graph.codeValue(
                        it,
                    ),
                ] == StationRegion.BUSAN
            }.map(graph::service)
            .toSet()
    val complete =
        RegionalSlotCoverage(available = true, missingServices = emptyList(), unsupportedOrigins = emptyList())
    val busan =
        TimeSlot.ALL.associate { slot ->
            val waits = graph.waitsFor(slot)
            val missing =
                busanServices
                    .filter { waits[it] == RouteGraph.UNAVAILABLE_WAIT }
                    .map { graph.lines[graph.lineIndexOfService(it)] }
                    .distinct()
                    .sorted()
            val search = RouteSearch(graph, slot)
            val trees = busanCodes.sorted().associateWith(search::from)
            val boardable = trees.filterValues { it != null }
            val disconnected =
                boardable.values.sumOf { tree -> boardable.keys.count { requireNotNull(tree).fastest(it) == null } }
            slot.id to
                RegionalSlotCoverage(
                    available = regionDisableReason(boardable.size, disconnected) == null,
                    missingServices = missing,
                    unsupportedOrigins = (trees.keys - boardable.keys).sorted(),
                )
        }
    return mapOf(StationRegion.CAPITAL to TimeSlot.ALL.associate { it.id to complete }, StationRegion.BUSAN to busan)
}

/** One slot's origins × candidates matrix of the combined network. Cells the coverage rules out stay unreachable. */
private fun regionalMatrix(
    network: Network,
    registryVersion: Int,
    candidates: List<String>,
    unsupported: Set<String>,
): OdMatrix {
    val origins = network.origins.map { it.code }
    val costs = regionalMatrixCosts(network)
    val column = origins.withIndex().associate { it.value to it.index }
    val times = IntArray(origins.size * candidates.size)
    val transfers = IntArray(times.size)
    for ((row, origin) in origins.withIndex()) {
        for ((j, candidate) in candidates.withIndex()) {
            val cost = costs[row][column.getValue(candidate)]
            val reachable = cost != infinity && origin !in unsupported && candidate !in unsupported
            times[row * candidates.size + j] = if (reachable) cost.seconds else OdMatrix.UNREACHABLE
            transfers[row * candidates.size + j] = if (reachable) cost.changes else OdMatrix.UNREACHABLE
        }
    }
    return OdMatrix(
        registryVersion,
        origins.map { StationCode.parse(it).value }.toIntArray(),
        candidates.map { StationCode.parse(it).value }.toIntArray(),
        times,
        transfers,
    )
}

/** A regional set read back as the regional server reads it. */
internal class RegionalSet(
    val dataSet: DataSet,
    val lastTrains: LastTrainTable,
    val graph: RouteGraph,
)

/**
 * Reads [manifestText] and the files it points to ([read] by published path) with the server's regional rules, and
 * runs the route gate: the regional graph must recompute every slot cell of every supported origin, and an origin
 * the coverage leaves unsupported must have no reachable cell.
 */
internal fun verifyRegionalSet(
    manifestText: String,
    read: (String) -> ByteArray,
): RegionalSet {
    val manifest = ManifestCodec.parse(manifestText)
    require(manifest.schemaVersion == REGIONAL_MANIFEST_GENERATION) { "not a regional manifest" }
    val files = manifest.files
    val dataSet =
        DataSetLoader.load(
            DataSetBytes(
                manifestText,
                read(files.registry.path),
                read(files.candidates.path),
                read(files.od.path),
                files.odSlots.orEmpty().mapValues { read(it.value.path) },
            ),
            REGIONAL_MANIFEST_GENERATION,
        )
    val lastTrains = DataSetLoader.lastTrains(dataSet, read(requireNotNull(files.lastTrain).path))
    val graph =
        DataSetLoader.routeGraph(
            dataSet,
            read(requireNotNull(files.routeGraph).path),
            RouteGraphCodec.REGIONAL_FORMAT_VERSION,
        )
    val gate = regionalRouteGate(dataSet, graph)
    require(gate.passed) { "Regional route gate failed:\n" + gate.problems.joinToString("\n") }
    return RegionalSet(dataSet, lastTrains, graph)
}

/**
 * The route gate on the regional set: the regional graph must recompute every slot cell of every supported origin, an
 * origin the coverage leaves unsupported must have no reachable cell, and the graph must not reach a cell the matrix
 * leaves unreachable.
 */
private fun regionalRouteGate(
    dataSet: DataSet,
    graph: RouteGraph,
): RouteGateResult {
    val coverage = requireNotNull(dataSet.manifest.regionCoverage)
    val gate = RouteGateResult()
    for (slot in TimeSlot.ALL) {
        val od = requireNotNull(dataSet.odFor(slot))
        val unsupported = coverage.values.flatMap { it.getValue(slot.id).unsupportedOrigins }.toSet()
        val search = RouteSearch(graph, slot)
        for (i in 0 until od.originCount) {
            val origin = od.originCode(i).toString()
            val tree = search.from(origin)
            if (tree == null || origin in unsupported) {
                require(
                    origin in unsupported &&
                        (0 until od.candidateCount).all { od.timeSeconds(i, it) == OdMatrix.UNREACHABLE },
                ) {
                    "$slot: origin $origin has no boarding but is not unsupported"
                }
            } else {
                gate.origin("$slot $origin", od, i, tree, unsupported)
            }
        }
    }
    return gate
}

private fun RouteGateResult.origin(
    label: String,
    od: OdMatrix,
    row: Int,
    tree: app.banbanyeok.core.RouteTree,
    unsupported: Set<String>,
) {
    val origin = od.originCode(row).toString()
    for (j in 0 until od.candidateCount) {
        val destination = od.candidateCode(j).toString()
        val seconds = od.timeSeconds(row, j)
        val cost = RouteCost(seconds, od.transfers(row, j))
        when {
            seconds == OdMatrix.UNREACHABLE -> {
                if (destination !in unsupported && tree.fastest(destination) != null) {
                    problem("$label→$destination: graph reaches an unreachable cell")
                }
            }

            // A route with an outdoor walk (부전 1호선↔동해선) has no display route on the wire; its cost still must match.
            tree.display(destination) == null && tree.trace(destination)?.segments?.any { it.line == null } == true -> {
                if (tree.fastest(destination) !=
                    cost
                ) {
                    problem("$label→$destination: graph ${tree.fastest(destination)}, od $cost")
                }
            }

            else -> {
                cell("$label→$destination", tree, origin, destination, cost)
            }
        }
    }
}

/**
 * ADR-0008's publication condition: on the capital axes the regional set is the capital set. Every slot matrix and the
 * last-train table, cut to the capital's origins and candidates, encode to the capital files byte for byte. The data
 * versions must match, so a capital rebuild needs a regional rebuild before either is published.
 */
internal fun verifyRegionalProjection(
    capital: DataSet,
    capitalLastTrains: LastTrainTable,
    regional: RegionalSet,
) {
    val set = regional.dataSet
    require(set.manifest.dataVersion == capital.manifest.dataVersion) {
        "regional dataVersion ${set.manifest.dataVersion} is not the capital ${capital.manifest.dataVersion}; run regional-build"
    }
    require(set.manifest.lastTrainAsOf == capital.manifest.lastTrainAsOf) {
        "regional lastTrainAsOf differs from the capital"
    }
    for (slot in TimeSlot.ALL) {
        val wanted = requireNotNull(capital.odFor(slot))
        val got = requireNotNull(set.odFor(slot))
        val rows = (0 until wanted.originCount).map { got.indexOfOrigin(wanted.originCode(it)) }
        val columns = (0 until wanted.candidateCount).map { got.indexOfCandidate(wanted.candidateCode(it)) }
        require(rows.none { it < 0 } && columns.none { it < 0 }) { "$slot: a capital axis code is missing" }
        val projected =
            OdMatrix(
                wanted.registryVersion,
                IntArray(wanted.originCount) { wanted.originCodeValue(it) },
                IntArray(wanted.candidateCount) { wanted.candidateCodeValue(it) },
                IntArray(wanted.originCount * wanted.candidateCount) {
                    got.timeSeconds(rows[it / wanted.candidateCount], columns[it % wanted.candidateCount])
                },
                IntArray(wanted.originCount * wanted.candidateCount) {
                    got.transfers(rows[it / wanted.candidateCount], columns[it % wanted.candidateCount])
                },
            )
        require(OdBinCodec.encode(projected).contentEquals(OdBinCodec.encode(wanted))) {
            "$slot: capital matrix changed in the regional set"
        }
    }
    require(
        LtBinCodec.encode(projectLastTrains(regional.lastTrains, capitalLastTrains)).contentEquals(
            LtBinCodec.encode(capitalLastTrains),
        ),
    ) { "Capital last trains changed in the regional set" }
    val problems =
        regionalLastTrainProblems(
            capital.manifest.lastTrainPartialDays,
            set.manifest.lastTrainPartialDays,
            set.registry,
            regional.lastTrains,
        )
    require(problems.isEmpty()) {
        "Regional last trains break the capital's or the regions' rules:\n" +
            problems.joinToString("\n")
    }
}

/**
 * What the capital projection cannot see in the last-train part: the regional manifest keeps the capital's partial
 * days (the server reads them for every region, so a capital screen would lose or gain its "일부 노선만" note), and
 * every cell between two regions stays "확인 필요" (data-format §12).
 */
internal fun regionalLastTrainProblems(
    capitalPartialDays: List<String>?,
    regionalPartialDays: List<String>?,
    registry: Registry,
    table: LastTrainTable,
): List<String> {
    val problems = mutableListOf<String>()
    if (regionalPartialDays != capitalPartialDays) {
        problems += "lastTrainPartialDays $regionalPartialDays is not the capital's $capitalPartialDays"
    }
    val regionOf = registry.stations.associate { StationCode.parse(it.code).value to it.region }
    val homes = List(table.homeCount) { regionOf[table.homeCode(it).value] }
    val meetings = List(table.meetingCount) { regionOf[table.meetingCode(it).value] }
    val crossRegion =
        homes.indices.flatMap { row -> meetings.indices.filter { homes[row] != meetings[it] }.map { row to it } }
    for (day in DayType.entries) {
        problems +=
            crossRegion
                .filter { (row, column) -> table.cell(day, row, column) != LastTrainCell.UNKNOWN }
                .map { (row, column) ->
                    "$day ${table.homeCode(row)} → ${table.meetingCode(column)}: a cell between regions has a time"
                }
    }
    return problems
}

/** The SEO pages' top three of every hub pair, ranked on the regional default matrix, are the published ones. */
private fun verifyRegionalSeo(
    root: Path,
    capital: DataSet,
    regional: DataSet,
) {
    val hubs = readSeoHubs(root, capital.registry)
    val dataVersion = capital.manifest.dataVersion
    val published = parseObject(root.resolve("data/artifacts/dev/seo-pairs.json").readText())
    val fromCapital = seoPairs(capital.registry, capital.od, hubs, dataVersion)
    val capitalOnly =
        OdMatrix(
            regional.od.registryVersion,
            IntArray(capital.od.originCount) { capital.od.originCodeValue(it) },
            IntArray(capital.od.candidateCount) { capital.od.candidateCodeValue(it) },
            IntArray(capital.od.originCount * capital.od.candidateCount) {
                val row = regional.od.indexOfOrigin(capital.od.originCode(it / capital.od.candidateCount))
                regional.od.timeSeconds(
                    row,
                    regional.od.indexOfCandidate(
                        capital.od.candidateCode(it % capital.od.candidateCount),
                    ),
                )
            },
            IntArray(capital.od.originCount * capital.od.candidateCount) {
                val row = regional.od.indexOfOrigin(capital.od.originCode(it / capital.od.candidateCount))
                regional.od.transfers(
                    row,
                    regional.od.indexOfCandidate(
                        capital.od.candidateCode(it % capital.od.candidateCount),
                    ),
                )
            },
        )
    val fromRegional = seoPairs(capital.registry, capitalOnly, hubs, dataVersion)
    require(fromRegional == fromCapital && published["pairs"] == fromCapital["pairs"]) {
        "SEO top three differ between the regional and the published capital matrix"
    }
}

/**
 * `stage-release`'s regional part: when [source] has a regional pointer, its files are checked, read back as the
 * regional server reads them, held to [verifyRegionalProjection] against the [capital] set being staged and copied to
 * [out] at the same paths, the pointer last. Without a pointer nothing is staged and REGIONAL_ARTIFACTS stays off.
 */
internal fun stageRegional(
    source: Path,
    out: Path,
    capital: DataSet,
    capitalLastTrains: LastTrainTable,
): Boolean {
    val pointer = source.resolve(ManifestNames.REGIONAL)
    if (!pointer.exists()) return false
    val text = pointer.readText()
    val regional = verifyRegionalSet(text) { source.resolve(it).readBytes() }
    verifyRegionalProjection(capital, capitalLastTrains, regional)
    val manifest = regional.dataSet.manifest
    val paths =
        listOfNotNull(
            manifest.files.registry,
            manifest.files.candidates,
            manifest.files.od,
            manifest.files.lastTrain,
            manifest.files.routeGraph,
        ) +
            manifest.files.odSlots
                .orEmpty()
                .values
    paths.distinctBy { it.path }.forEach { file ->
        val target = out.resolve(file.path)
        target.parent.createDirectories()
        target.writeBytes(source.resolve(file.path).readBytes())
    }
    out.resolve(ManifestNames.REGIONAL).writeText(text)
    return true
}
