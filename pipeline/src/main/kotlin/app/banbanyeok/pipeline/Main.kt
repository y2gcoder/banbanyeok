package app.banbanyeok.pipeline

import app.banbanyeok.schema.*
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Path
import java.time.Instant
import java.time.Duration
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.io.path.*

fun main(args: Array<String>) {
    val root = generateSequence(Path.of("").toAbsolutePath()) { it.parent }.first { it.resolve("contracts/data-format.md").exists() }
    when (args.singleOrNull()) {
        "fetch" -> fetch(root)
        "build" -> build(root)
        "validate" -> validate(root)
        "all" -> { fetch(root); build(root); validate(root) }
        else -> error("Usage: fetch|build|validate|all")
    }
}



internal fun matrixCosts(network: Network): List<List<Cost>> = network.origins.map { origin ->
    val seeds = network.nodes.withIndex().filter { it.value.first == origin.code }.associate { it.index to network.waits.getValue(it.value.second) }
    val distances = shortest(network.graph, seeds)
    network.origins.map { destination ->
        if (origin.code == destination.code) Cost(0, 0) else network.nodes.withIndex().filter { it.value.first == destination.code }.minOf { distances[it.index] }
    }
}

private fun build(root: Path) {
    val net = network(root)
    val candidateReasons = csv(root.resolve("data/config/candidate-places.csv").readText()).drop(1).associate { it[0] to it[1] }
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
    val appendOnly = RegistryCompatibility.checkAppendOnly(net.previous, net.registry) + baselineViolations(root, net.registry)
    val spots = spotchecks(net, costs)
    val report = root.resolve("data/config/validation-report.json")
    val reach = 1.0 - unreachable.toDouble() / times.size
    val passed = unreachable == 0 && gate.passed && appendOnly.isEmpty() && spots.all { it.success }
    report.writeText("""{
      "passed":$passed,"registryStations":${net.registry.stations.size},"origins":${net.origins.size},"candidates":${candidates.size},
      "reachability":$reach,"appendOnlyViolations":${strings(appendOnly)},
      ${gate.json},
      "excludedSeoulRecords":${strings(net.excluded)},
      "spotchecks":[${spots.joinToString(",") { it.json }}]
    }
    """.trimIndent())
    val excluded = net.registry.stations.filter { it.status == StationStatus.ACTIVE && it.code !in net.origins.map { origin -> origin.code }.toSet() }
    root.resolve("data/config/coverage-report.json").writeText("""{
      "scope":"서울교통공사 1~8호선 S3 운영 구간",
      "includedPhysicalStations":${net.origins.size},"stateNodes":${net.nodes.size},
      "rideEdges":${net.graph.sumOf { edges -> edges.count { it.changes == 0 } }},
      "transferEdges":${net.graph.sumOf { edges -> edges.count { it.changes > 0 } }},
      "excludedActiveStationCodes":${strings(excluded.map { it.code })},
      "excludedSourceLineNames":${strings(excluded.flatMap { it.lines }.distinct().sorted())},
      "missingFromS1":["GTX-A"],"timetableAvailable":false
    }
""".trimIndent())
    // Registry and review draft are control-plane inputs, not published travel artifacts.
    root.resolve("data/registry/stations.json").writeText(RegistryCodec.encode(net.registry))
    root.resolve("data/registry/candidates.json").writeText(RegistryCodec.encodeCandidates(candidateList))
    root.resolve("data/registry/candidate-review.json").writeText(candidates.joinToString(",\n", "[\n", "\n]\n") { station ->
        """{"code":${quote(station.code)},"name":${quote(station.name)},"reason":${quote(candidateReasons.getValue(station.name))},"reviewed":false}"""
    })
    println("Registry ${net.registry.stations.size}; origins ${net.origins.size}; candidates ${candidates.size}; reachability $reach; graph gate ${gate.passed}")
    require(passed) { "Validation gate failed; no travel artifacts written. See data/config/validation-report.json" }
    val output = root.resolve("data/artifacts/dev").createDirectories()
    val registryBytes = RegistryCodec.encode(net.registry).toByteArray()
    val candidateBytes = RegistryCodec.encodeCandidates(candidateList).toByteArray()
    val od = OdMatrix(net.registry.registryVersion, net.origins.map { StationCode.parse(it.code).value }.toIntArray(), candidates.map { StationCode.parse(it.code).value }.toIntArray(), times, transfers)
    val odBytes = OdBinCodec.encode(od)
    val files = linkedMapOf("stations.json" to registryBytes, "candidates.json" to candidateBytes, "od.bin" to odBytes)
    fun file(name: String): ManifestFile = ManifestFile(name, Sha256.hex(files.getValue(name)), files.getValue(name).size.toLong())
    val now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS)
    val date = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(ZoneOffset.UTC).format(now)
    val previousManifest = output.resolve("manifest.json").takeIf { it.exists() }?.let { ManifestCodec.parse(it.readText()) }
    val revision = previousManifest?.dataVersion?.takeIf { it.startsWith("$date.") }?.substringAfter('.')?.toInt()?.plus(1) ?: 1
    require(revision <= 999) { "Daily dataVersion revision exhausted" }
    val version = "$date.$revision"
    val manifest = Manifest(1, 1, version, previousDataVersion = previousManifest?.dataVersion, generatedAt = now.toString(), registryVersion = net.registry.registryVersion, timeModel = "weekday-offpeak-estimated-half-headway", originCount = net.origins.size, candidateCount = candidates.size, files = ManifestFiles(file("stations.json"), file("candidates.json"), file("od.bin")))
    val manifestText = ManifestCodec.encode(manifest)
    DataSetLoader.load(manifestText, registryBytes, candidateBytes, odBytes)
    files.forEach { (name, bytes) -> output.resolve(name).writeBytes(bytes) }
    val glyphs = (net.registry.stations.joinToString("") { it.name } + root.resolve("data/config/og-copy.txt").readText()).filter { !it.isISOControl() }.toSet().sorted().joinToString("")
    output.resolve("og-glyphs.txt").writeText(glyphs + "\n")
    output.resolve("manifest.json").writeText(manifestText)
    println("Published dev artifacts: ${files.values.sumOf { it.size }} bytes (+ manifest/glyphs)")
}

private data class Spot(val success: Boolean, val json: String)
private fun spotchecks(net: Network, costs: List<List<Cost>>): List<Spot> {
    val pairs = listOf("서울역" to "청량리", "강남" to "홍대입구", "성수" to "신설동", "신도림" to "까치산", "강동" to "마천", "강동" to "하남검단산", "응암" to "연신내", "사당" to "잠실", "광화문" to "왕십리", "답십리" to "역삼")
    val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
    return pairs.map { (from, to) ->
        val i = net.origins.indexOfFirst { it.name == from }; val j = net.origins.indexOfFirst { it.name == to }
        val own = costs[i][j].seconds
        try {
            fun encode(s: String): String = URLEncoder.encode(s, Charsets.UTF_8).replace("+", "%20")
            val url = "http://openapi.seoul.go.kr:8088/sample/json/getShtrmPath/1/5/${encode(from)}/${encode(to)}/${encode("2026-11-12 10:00:00")}"
            val response = client.send(HttpRequest.newBuilder(URI(url)).timeout(Duration.ofSeconds(20)).GET().build(), HttpResponse.BodyHandlers.ofString())
            val body = response.body()
            require(response.statusCode() == 200 && Regex("\"resultCode\"\\s*:\\s*\"00\"").containsMatchIn(body)) { "API status/schema failure" }
            fun numbers(field: String) = Regex("\"$field\"\\s*:\\s*\"?([0-9]+)").findAll(body).map { it.groupValues[1].toInt() }.toList()
            val total = numbers("totalReqHr").single()
            val segment = numbers("reqHr").sum()
            val wait = numbers("wtngHr").sum()
            val delta = own - total
            // Store comparison metrics only, never API path rows or absolute source totals.
            val status = if (total == 0 && own > 0) "warning: API returned zero for distinct stations" else "compared; API may use excluded lines"
            Spot(true, """{"from":${quote(from)},"to":${quote(to)},"pipelineSeconds":$own,"deltaSeconds":$delta,"apiTotalMinusSegmentsAndWaitSeconds":${total - segment - wait},"status":${quote(status)}}""")
        } catch (_: Exception) {
            Spot(false, """{"from":${quote(from)},"to":${quote(to)},"pipelineSeconds":$own,"status":"unavailable: HTTP/schema/timeout"}""")
        }
    }
}

private fun validate(root: Path) {
    val output = root.resolve("data/artifacts/dev")
    val dataset = DataSetLoader.load(output.resolve("manifest.json").readText(), output.resolve("stations.json").readBytes(), output.resolve("candidates.json").readBytes(), output.resolve("od.bin").readBytes())
    val registry = RegistryCodec.parse(root.resolve("data/registry/stations.json").readText())
    require(RegistryCompatibility.checkAppendOnly(dataset.registry, registry).isEmpty())
    require(registry == dataset.registry) { "Artifact registry differs from control registry; rebuild required" }
    val net = network(root)
    require(net.registry == registry) { "Raw sources require a registry rebuild" }
    val costs = matrixCosts(net)
    require(graphGate(net, costs).passed) { "Graph validation gate failed" }
    require(baselineViolations(root, registry).isEmpty()) { "Committed registry append-only gate failed" }
    require(dataset.od.originCount == net.origins.size) { "Origin axis incomplete" }
    require(dataset.candidates == RegistryCodec.parseCandidates(root.resolve("data/registry/candidates.json").readText()))
    for (i in 0 until dataset.od.originCount) {
        val origin = net.origins.indexOfFirst { it.code == dataset.od.originCode(i).toString() }
        require(origin >= 0)
        for (j in 0 until dataset.od.candidateCount) {
            val candidate = net.origins.indexOfFirst { it.code == dataset.od.candidateCode(j).toString() }
            require(candidate >= 0)
            require(dataset.od.timeSeconds(i, j) == costs[origin][candidate].seconds && dataset.od.transfers(i, j) == costs[origin][candidate].changes) { "Artifact differs from current graph" }
        }
    }
    println("Validated artifact hashes, contract, append-only registry and recomputed OD cells")
}
