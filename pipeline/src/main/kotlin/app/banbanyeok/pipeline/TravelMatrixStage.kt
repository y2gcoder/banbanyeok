package app.banbanyeok.pipeline

import app.banbanyeok.core.Candidate
import app.banbanyeok.schema.CandidateList
import app.banbanyeok.schema.DataSet
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.RegistryCodec
import app.banbanyeok.schema.RegistryCompatibility
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationStatus
import app.banbanyeok.schema.TimeSlot
import kotlinx.serialization.json.JsonObject
import java.nio.file.Path
import kotlin.io.path.readText

/** 130 since D1: 97 Seoul Metro candidates + 30 metropolitan ones adopted after user review. */
private val CANDIDATE_RANGE = 50..130

/**
 * The travel-time matrices (od.bin and the per-slot matrices) with the registry and candidate list they are
 * indexed by, and the graph gates, reports and control-plane files that go with them. The release writer turns the
 * matrices into the published files (and the SEO pairs from the default slot's).
 */
internal object TravelMatrixStage : ArtifactStage {
    override val name = "travel-matrix"

    override fun build(
        context: StageContext,
        parts: ReleaseParts,
    ) {
        val root = context.root
        val slots = context.slots
        val net = context.net
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
        require(
            passed,
        ) { "Validation gate failed; no travel artifacts written. See data/config/validation-report.json" }
        parts.candidates = candidateList
        parts.matrices = results.mapValues { it.value.times to it.value.transfers }
    }

    override fun validate(
        context: StageContext,
        dataset: app.banbanyeok.schema.DataSet,
    ) {
        val root = context.root
        val slots = context.slots
        val net = context.net
        val registry = RegistryCodec.parse(root.resolve("data/registry/stations.json").readText())
        require(RegistryCompatibility.checkAppendOnly(dataset.registry, registry).isEmpty())
        require(registry == dataset.registry) { "Artifact registry differs from control registry; rebuild required" }
        require(net.registry == registry) { "Raw sources require a registry rebuild" }
        require(baselineViolations(root, registry).isEmpty()) { "Committed registry append-only gate failed" }
        require(dataset.od.originCount == net.origins.size) { "Origin axis incomplete" }
        require(
            dataset.candidates ==
                RegistryCodec.parseCandidates(root.resolve("data/registry/candidates.json").readText()),
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
    }
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

/**
 * Candidate seeds are names chosen for Seoul Metro stations (P2). Since D1 a name can also match a different
 * operator's station (신촌 경의중앙선), so the Seoul Metro station wins and the 97 codes stay as reviewed.
 */
internal fun candidateStations(
    origins: List<app.banbanyeok.schema.Station>,
    names: Set<String>,
): List<app.banbanyeok.schema.Station> = names.map { stationNamed(origins, it) }.sortedBy { it.code }
