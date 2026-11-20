package app.banbanyeok.pipeline

import app.banbanyeok.schema.CandidateList
import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.RegistryCodec
import app.banbanyeok.schema.RegistryCompatibility
import app.banbanyeok.schema.StationStatus
import app.banbanyeok.schema.TimeSlot
import kotlinx.serialization.json.JsonObject
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.readBytes
import kotlin.io.path.readText

fun main(args: Array<String>) {
    val root =
        generateSequence(Path.of("").toAbsolutePath()) {
            it.parent
        }.first { it.resolve("contracts/data-format.md").exists() }
    if (args.firstOrNull() == "stage-release") {
        // 발행 디렉터리(기본 build/release). 업로드는 scripts/publish-artifacts.sh.
        require(args.size <= 2) { "Usage: stage-release [outDir]" }
        stageRelease(root.resolve("data/artifacts/dev"), root.resolve(args.getOrElse(1) { "build/release" }))
        return
    }
    if (args.firstOrNull() == "tago-fetch") {
        tagoCommand(root, args.drop(1))
        return
    }
    if (args.singleOrNull() == "seoul-fetch") {
        // The only command that needs SEOUL_OPENAPI_KEY. Exit 2 = limit reached; rerun to resume.
        kotlin.system.exitProcess(seoulFetch(root))
    }
    when (args.singleOrNull()) {
        "fetch" -> {
            fetch(root)
        }

        "spotcheck" -> {
            spotcheck(root)
        }

        "headways" -> {
            refreshHeadways(root)
        }

        "refresh" -> {
            require(!System.getenv("SEOUL_OPENAPI_KEY").isNullOrBlank()) {
                "SEOUL_OPENAPI_KEY is required for refresh; build/all use configured headways"
            }
            val before = network(root)
            val oldCosts = matrixCosts(before)
            check(seoulFetch(root) == 0) { "Seoul S5 cache incomplete (limit reached); rerun refresh to resume" }
            refreshHeadways(root)
            build(root)
            validate(root)
            writeHeadwayComparison(root, before, oldCosts)
        }

        "build" -> {
            build(root)
        }

        "validate" -> {
            validate(root)
        }

        "all" -> {
            if (!root.resolve("data/raw/kric.xlsx").exists()) fetch(root)
            build(root)
            validate(root)
        }

        else -> {
            error(
                "Usage: fetch|seoul-fetch|headways|build|validate|all|spotcheck|refresh|tago-fetch [probe]|" +
                    "stage-release [outDir]",
            )
        }
    }
}

/** 130 since D1: 97 Seoul Metro candidates + 30 metropolitan ones adopted after user review. */
private val CANDIDATE_RANGE = 50..130

private fun build(root: Path) {
    val input = readInput(root)
    val slots = slotNetworks(input)
    val net = slots.getValue(TimeSlot.DEFAULT)
    // name,reason,reviewed: reviewed is the human review state carried into candidate-review.json.
    val seeds = csv(root.resolve("data/config/candidate-places.csv").readText()).drop(1)
    require(
        seeds.all { it.size == 3 && it[2] in setOf("true", "false") },
    ) { "candidate-places.csv: name,reason,reviewed" }
    val candidateReasons = seeds.associate { it[0] to it[1] }
    val reviewed = seeds.associate { it[0] to (it[2] == "true") }
    val candidates = candidateStations(net.origins, candidateReasons.keys)
    require(candidates.size in CANDIDATE_RANGE) { "Candidate count ${candidates.size}" }
    val candidateList = CandidateList(1, net.registry.registryVersion, candidates.map { it.code })
    RegistryCodec.validateAgainst(candidateList, net.registry)
    val candidateIndexes = candidates.map { net.origins.indexOf(it) }
    val results = slots.mapValues { (_, slotNet) -> slotResult(slotNet, candidateIndexes) }
    val appendOnly =
        RegistryCompatibility.checkAppendOnly(net.previous, net.registry) + baselineViolations(root, net.registry)
    val passed = writeValidationReport(root, net, candidates.size, results, appendOnly)
    writeCoverage(root, net)
    writeOfficialComparison(root, net)
    writeRegistryAudit(root, net.registry)
    writeSlotReport(root, slots, results, candidates)
    // Registry and review draft are control-plane inputs, not published travel artifacts.
    root.resolve("data/registry/stations.json").writeJson(RegistryCodec.encode(net.registry))
    root.resolve("data/registry/candidates.json").writeJson(RegistryCodec.encodeCandidates(candidateList))
    root.resolve("data/registry/candidate-review.json").writeJson(
        jsonValue(
            candidates.map { station ->
                obj(
                    "code" to station.code,
                    "name" to station.name,
                    "reason" to candidateReasons.getValue(station.name),
                    "reviewed" to reviewed.getValue(station.name),
                )
            },
        ).toString(),
    )
    println(
        "Registry ${net.registry.stations.size}; origins ${net.origins.size}; candidates ${candidates.size}; " +
            "slots ${results.size}; gates ${results.count { it.value.passed }}/${results.size} passed",
    )
    require(passed) { "Validation gate failed; no travel artifacts written. See data/config/validation-report.json" }
    val started = System.nanoTime()
    val lastTrains = buildLastTrains(root, input, net, candidateList)
    root.resolve("data/config/last-train-report.json").writeJson(lastTrains.report.toString())
    println(
        "Last trains as of ${lastTrains.asOf}: computed and gated in " +
            "${(System.nanoTime() - started) / 1_000_000} ms; gates ${if (lastTrains.passed) "passed" else "FAILED"}",
    )
    require(lastTrains.passed) {
        "Last-train gate failed; no artifacts written. See data/config/last-train-report.json"
    }
    publish(root, net, candidateList, results.mapValues { it.value.times to it.value.transfers }, lastTrains)
}

private fun writeValidationReport(
    root: Path,
    net: Network,
    candidateCount: Int,
    results: Map<TimeSlot, SlotResult>,
    appendOnly: List<String>,
): Boolean {
    val passed = results.values.all { it.passed } && appendOnly.isEmpty()
    val defaultResult = results.getValue(TimeSlot.DEFAULT)
    root.resolve("data/config/validation-report.json").writeJson(
        obj(
            "passed" to passed,
            "registryStations" to net.registry.stations.size,
            "origins" to net.origins.size,
            "candidates" to candidateCount,
            "reachability" to defaultResult.reachability,
            "appendOnlyViolations" to appendOnly,
            "graph" to defaultResult.gate.json,
            "timeSlots" to
                JsonObject(
                    results.entries.associate { (slot, result) ->
                        slot.id to
                            obj(
                                "passed" to result.passed,
                                "reachability" to result.reachability,
                                "stateTriangleViolations" to result.gate.json["stateTriangleViolations"],
                                "physicalTriangleBoundViolations" to
                                    result.gate.json["physicalTriangleBoundViolations"],
                                "abnormal" to result.gate.json["abnormal"],
                            )
                    },
                ),
            "excludedSeoulRecords" to net.excluded,
        ).toString(),
    )
    return passed
}

/** One slot's origin × candidate matrix and graph gate. */
internal class SlotResult(
    val costs: List<List<Cost>>,
    val times: IntArray,
    val transfers: IntArray,
    val gate: Gate,
) {
    val unreachable = times.count { it >= infinity.seconds }
    val reachability = 1.0 - unreachable.toDouble() / times.size
    val passed = unreachable == 0 && gate.passed
}

internal fun slotResult(
    net: Network,
    candidateIndexes: List<Int>,
): SlotResult {
    val costs = matrixCosts(net)
    return SlotResult(
        costs,
        costs.flatMap { row -> candidateIndexes.map { row[it].seconds } }.toIntArray(),
        costs.flatMap { row -> candidateIndexes.map { row[it].changes } }.toIntArray(),
        graphGate(net, costs),
    )
}

private fun validate(root: Path) {
    val dataset = loadDevArtifacts(root.resolve("data/artifacts/dev"))
    validateSeo(root, dataset.registry, dataset.od, dataset.manifest)
    val registry = RegistryCodec.parse(root.resolve("data/registry/stations.json").readText())
    require(RegistryCompatibility.checkAppendOnly(dataset.registry, registry).isEmpty())
    require(registry == dataset.registry) { "Artifact registry differs from control registry; rebuild required" }
    val input = readInput(root)
    val slots = slotNetworks(input)
    val net = slots.getValue(TimeSlot.DEFAULT)
    require(net.registry == registry) { "Raw sources require a registry rebuild" }
    require(baselineViolations(root, registry).isEmpty()) { "Committed registry append-only gate failed" }
    require(dataset.od.originCount == net.origins.size) { "Origin axis incomplete" }
    require(
        dataset.candidates == RegistryCodec.parseCandidates(root.resolve("data/registry/candidates.json").readText()),
    )
    val index = net.origins.withIndex().associate { (i, station) -> station.code to i }
    val rows = List(dataset.od.originCount) { index.getValue(dataset.od.originCode(it).toString()) }
    val columns = List(dataset.od.candidateCount) { index.getValue(dataset.od.candidateCode(it).toString()) }
    slots.forEach { (slot, slotNet) ->
        val costs = matrixCosts(slotNet)
        require(graphGate(slotNet, costs).passed) { "Graph validation gate failed ($slot)" }
        val od = requireNotNull(dataset.odFor(slot)) { "Artifact has no $slot matrix" }
        for (i in 0 until od.originCount) {
            val origin = rows[i]
            for (j in 0 until od.candidateCount) {
                val candidate = columns[j]
                require(
                    od.timeSeconds(i, j) == costs[origin][candidate].seconds &&
                        od.transfers(i, j) == costs[origin][candidate].changes,
                ) { "Artifact differs from current graph ($slot)" }
            }
        }
    }
    val lastTrains = buildLastTrains(root, input, net, dataset.candidates)
    require(lastTrains.passed) { "Last-train gate failed" }
    require(lastTrains.table == loadDevLastTrains(root.resolve("data/artifacts/dev"), dataset)) {
        "Artifact last-train table differs from the current timetables; rebuild required"
    }
    require(lastTrains.asOf == dataset.manifest.lastTrainAsOf) { "Artifact last-train date differs; rebuild required" }
    println(
        "Validated artifact hashes, contract, append-only registry, recomputed OD cells of ${slots.size} slots " +
            "and the last-train table",
    )
}

private fun writeCoverage(
    root: Path,
    net: Network,
) {
    val origins = net.origins.map { it.code }.toSet()
    val physical =
        requireNotNull(NetworkRules(parseObject(root.resolve("data/config/network-rules.json").readText())).physical)
    val excluded = net.registry.stations.filter { it.status == StationStatus.ACTIVE && it.code !in origins }
    val (metro, outside) = excluded.partition { physical.inScope(it) }
    val services = net.nodes.groupBy({ it.second }, { it.first }).mapValues { (_, codes) -> codes.distinct().size }
    root.resolve("data/config/coverage-report.json").writeJson(
        obj(
            "scope" to "수도권 도시·광역철도: 서울교통공사 1~8호선 S3 구간 + TAGO 시간표 노선(metro-lines.json)",
            "includedPhysicalStations" to net.origins.size,
            "stateNodes" to net.nodes.size,
            "rideEdges" to net.graph.sumOf { edges -> edges.count { it.changes == 0 } },
            "transferEdges" to net.graph.sumOf { edges -> edges.count { it.changes > 0 } },
            "stationsPerService" to JsonObject(services.toSortedMap().mapValues { jsonValue(it.value) }),
            "excludedMetroActive" to
                metro.sortedBy { it.code }.map { obj("code" to it.code, "name" to it.name, "lines" to it.lines) },
            "excludedOutsideMetroCount" to outside.size,
            "excludedOutsideMetroLineNames" to outside.flatMap { it.lines }.distinct().sorted(),
            "addedFromTago" to
                net.registry.stations
                    .filter { "wikidata" in it.sources }
                    .sortedBy { it.code }
                    .map { obj("code" to it.code, "name" to it.name, "lines" to it.lines) },
        ).toString(),
    )
    net.tagoReport?.let { root.resolve("data/config/tago-report.json").writeJson(it.toString()) }
}

/** The only command that needs TAGO_SERVICE_KEY; everything else reads the cache offline. */
private fun tagoCommand(
    root: Path,
    args: List<String>,
) {
    require(args.size <= 1) { "Usage: tago-fetch [probe]" }
    when (args.firstOrNull()) {
        null -> kotlin.system.exitProcess(tagoFetch(root))
        "probe" -> tagoProbe(root)
        else -> error("Usage: tago-fetch [probe]")
    }
}

/**
 * Candidate seeds are names chosen for Seoul Metro stations (P2). Since D1 a name can also match a different
 * operator's station (신촌 경의중앙선), so the Seoul Metro station wins and the 97 codes stay as reviewed.
 */
internal fun candidateStations(
    origins: List<app.banbanyeok.schema.Station>,
    names: Set<String>,
): List<app.banbanyeok.schema.Station> = names.map { stationNamed(origins, it) }.sortedBy { it.code }
