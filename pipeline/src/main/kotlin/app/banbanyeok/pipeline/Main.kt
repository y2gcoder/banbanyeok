package app.banbanyeok.pipeline

import app.banbanyeok.schema.CandidateList
import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.RegistryCodec
import app.banbanyeok.schema.RegistryCompatibility
import app.banbanyeok.schema.StationStatus
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
                "SEOUL_OPENAPI_KEY is required for refresh; build/all use configured estimates"
            }
            val before = network(root)
            val oldCosts = matrixCosts(before)
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
            error("Usage: fetch|headways|build|validate|all|spotcheck|refresh|stage-release [outDir]")
        }
    }
}

private fun build(root: Path) {
    val net = network(root)
    val candidateReasons =
        csv(root.resolve("data/config/candidate-places.csv").readText()).drop(1).associate {
            it[0] to
                it[1]
        }
    val candidates = net.origins.filter { it.name in candidateReasons }.sortedBy { it.code }
    require(candidates.size == candidateReasons.size) { "Candidate seed contains unavailable/ambiguous names" }
    require(candidates.size in 50..100) { "Candidate count ${candidates.size}" }
    val candidateList = CandidateList(1, net.registry.registryVersion, candidates.map { it.code })
    RegistryCodec.validateAgainst(candidateList, net.registry)
    val costs = matrixCosts(net)
    val candidateIndexes = candidates.map { net.origins.indexOf(it) }
    val times = costs.flatMap { row -> candidateIndexes.map { row[it].seconds } }.toIntArray()
    val transfers = costs.flatMap { row -> candidateIndexes.map { row[it].changes } }.toIntArray()
    val unreachable = times.count { it >= infinity.seconds }
    val gate = graphGate(net, costs)
    val appendOnly =
        RegistryCompatibility.checkAppendOnly(net.previous, net.registry) + baselineViolations(root, net.registry)
    val report = root.resolve("data/config/validation-report.json")
    val reach = 1.0 - unreachable.toDouble() / times.size
    val passed = unreachable == 0 && gate.passed && appendOnly.isEmpty()
    report.writeJson(
        obj(
            "passed" to passed,
            "registryStations" to net.registry.stations.size,
            "origins" to net.origins.size,
            "candidates" to candidates.size,
            "reachability" to reach,
            "appendOnlyViolations" to appendOnly,
            "graph" to gate.json,
            "excludedSeoulRecords" to net.excluded,
        ).toString(),
    )
    writeCoverage(root, net)
    writeRegistryAudit(root, net.registry)
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
                    "reviewed" to false,
                )
            },
        ).toString(),
    )
    println(
        "Registry ${net.registry.stations.size}; origins ${net.origins.size}; candidates ${candidates.size}; reachability $reach; graph gate ${gate.passed}",
    )
    require(passed) { "Validation gate failed; no travel artifacts written. See data/config/validation-report.json" }
    publish(root, net, candidateList, times to transfers)
}

private fun validate(root: Path) {
    val output = root.resolve("data/artifacts/dev")
    val dataset =
        DataSetLoader.load(
            output.resolve("manifest.json").readText(),
            output.resolve("stations.json").readBytes(),
            output.resolve("candidates.json").readBytes(),
            output.resolve("od.bin").readBytes(),
        )
    validateSeo(root, dataset.registry, dataset.od, dataset.manifest)
    val registry = RegistryCodec.parse(root.resolve("data/registry/stations.json").readText())
    require(RegistryCompatibility.checkAppendOnly(dataset.registry, registry).isEmpty())
    require(registry == dataset.registry) { "Artifact registry differs from control registry; rebuild required" }
    val net = network(root)
    require(net.registry == registry) { "Raw sources require a registry rebuild" }
    val costs = matrixCosts(net)
    require(graphGate(net, costs).passed) { "Graph validation gate failed" }
    require(baselineViolations(root, registry).isEmpty()) { "Committed registry append-only gate failed" }
    require(dataset.od.originCount == net.origins.size) { "Origin axis incomplete" }
    require(
        dataset.candidates == RegistryCodec.parseCandidates(root.resolve("data/registry/candidates.json").readText()),
    )
    for (i in 0 until dataset.od.originCount) {
        val origin = net.origins.indexOfFirst { it.code == dataset.od.originCode(i).toString() }
        require(origin >= 0)
        for (j in 0 until dataset.od.candidateCount) {
            val candidate = net.origins.indexOfFirst { it.code == dataset.od.candidateCode(j).toString() }
            require(candidate >= 0)
            require(
                dataset.od.timeSeconds(i, j) == costs[origin][candidate].seconds &&
                    dataset.od.transfers(i, j) == costs[origin][candidate].changes,
            ) { "Artifact differs from current graph" }
        }
    }
    println("Validated artifact hashes, contract, append-only registry and recomputed OD cells")
}

private fun writeCoverage(
    root: Path,
    net: Network,
) {
    val origins = net.origins.map { it.code }.toSet()
    val excluded = net.registry.stations.filter { it.status == StationStatus.ACTIVE && it.code !in origins }
    root.resolve("data/config/coverage-report.json").writeJson(
        obj(
            "scope" to "서울교통공사 1~8호선 S3 운영 구간",
            "includedPhysicalStations" to net.origins.size,
            "stateNodes" to net.nodes.size,
            "rideEdges" to net.graph.sumOf { edges -> edges.count { it.changes == 0 } },
            "transferEdges" to net.graph.sumOf { edges -> edges.count { it.changes > 0 } },
            "excludedActiveStationCodes" to excluded.map { it.code },
            "excludedSourceLineNames" to excluded.flatMap { it.lines }.distinct().sorted(),
            "missingFromS1" to listOf("GTX-A"),
        ).toString(),
    )
}
