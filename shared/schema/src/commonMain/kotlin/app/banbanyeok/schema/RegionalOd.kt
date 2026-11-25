package app.banbanyeok.schema

/** Checks coverage against every regional OD block before the matrix can be used. */
internal fun validateRegionalOd(
    core: DataSet,
    slot: TimeSlot,
    od: OdMatrix,
) {
    val coverage = core.manifest.regionCoverage ?: return
    val regions = core.registry.stations.associate { it.code to requireNotNull(it.region) }
    val originCodes = List(od.originCount) { od.originCode(it).toString() }
    val origins = originCodes.groupBy(regions::getValue)
    val candidates = List(od.candidateCount) { od.candidateCode(it).toString() }
    schemaCheck(originCodes.toSet().containsAll(candidates)) { "권역 OD 후보역이 출발역 축에 없습니다" }
    schemaCheck(coverage.keys == origins.keys) { "권역 가용성과 OD 출발역 권역이 다릅니다" }
    val unsupported = mutableSetOf<String>()
    for ((region, codes) in origins) {
        val known = coverage.getValue(region).getValue(slot.id)
        schemaCheck(codes.containsAll(known.unsupportedOrigins)) { "$region $slot: 미지원 출발역이 권역의 OD 축에 없습니다" }
        schemaCheck(!known.available || codes.size - known.unsupportedOrigins.size >= 2) {
            "$region $slot: 지원 출발역이 두 곳 미만입니다"
        }
        unsupported += known.unsupportedOrigins
        if (!known.available) unsupported += codes
        if (region == StationRegion.CAPITAL) {
            schemaCheck(known.available && known.unsupportedOrigins.isEmpty() && known.missingServices.isEmpty()) {
                "수도권 OD 투영에는 기존 배차 범위가 필요합니다"
            }
        }
    }
    for ((row, code) in originCodes.withIndex()) {
        val region = regions.getValue(code)
        for ((column, candidate) in candidates.withIndex()) {
            val reachable = region == regions.getValue(candidate) && code !in unsupported && candidate !in unsupported
            schemaCheck((od.timeSeconds(row, column) != OdMatrix.UNREACHABLE) == reachable) {
                "$slot: 권역 또는 구분 지원과 OD 도달 여부가 다릅니다"
            }
        }
    }
}

internal fun validateRegionalGraph(
    core: DataSet,
    graph: RouteGraph,
) {
    val coverage = core.manifest.regionCoverage ?: return
    val stationRegions =
        core.registry.stations.associate {
            StationCode.parse(it.code).value to
                requireNotNull(it.region)
        }
    val regions = List(graph.nodeCount) { stationRegions.getValue(graph.codeValue(it)) }
    val services = mutableMapOf<Int, StationRegion>()
    for ((node, region) in regions.withIndex()) {
        val previous = services.put(graph.service(node), region)
        schemaCheck(previous == null || previous == region) { "rg.bin 계통이 여러 권역에 속합니다" }
        for (edge in graph.edgeStart(node) until graph.edgeEnd(node)) {
            schemaCheck(regions[graph.edgeTarget(edge)] == region) { "rg.bin 간선이 서로 다른 권역을 잇습니다" }
        }
    }
    for (slot in TimeSlot.ALL) {
        val waits = graph.waitsFor(slot)
        for ((region, slots) in coverage) {
            val missing =
                services
                    .filter { (index, owner) -> owner == region && waits[index] == RouteGraph.UNAVAILABLE_WAIT }
                    .keys
                    .map { graph.lines[graph.lineIndexOfService(it)] }
                    .distinct()
                    .sorted()
            schemaCheck(slots.getValue(slot.id).missingServices == missing) {
                "$slot: rg.bin 대기와 미확인 계통 목록이 다릅니다"
            }
        }
    }
}
