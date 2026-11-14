package app.banbanyeok.pipeline

import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.readText

/**
 * Compares in-train time (no initial wait, best path) with operator-published ride times recorded by hand in
 * data/config/official-times.csv. Published tables run from departure at A to arrival at B, while our edges add the
 * dwell at each arrival station, so Δ ≈ +dwell at B is expected. Report only; never a gate.
 */
internal fun writeOfficialComparison(
    root: Path,
    net: Network,
) {
    val file = root.resolve("data/config/official-times.csv")
    if (!file.exists()) return
    val platforms = net.nodes.indices.groupBy { net.nodes[it].first }
    val rows = csv(file.readText()).drop(1)
    val cache = mutableMapOf<String, List<Cost>>()
    val results =
        rows.mapNotNull { row ->
            val from = net.origins.singleOrNull { it.name == row[0] }
            val to = net.origins.singleOrNull { it.name == row[1] }
            if (from == null || to == null) return@mapNotNull null
            val distances =
                cache.getOrPut(from.code) { shortest(net.graph, platforms.getValue(from.code).associateWith { 0 }) }
            val ride = platforms.getValue(to.code).minOf { distances[it] }
            obj(
                "from" to row[0],
                "to" to row[1],
                "officialSeconds" to row[2].toInt(),
                "rideSeconds" to ride.seconds,
                "transfers" to ride.changes,
                "deltaSeconds" to ride.seconds - row[2].toInt(),
                "source" to row[3],
            )
        }
    val deltas = results.map { it.text("deltaSeconds").toInt() }
    root.resolve("data/config/official-comparison.json").writeJson(
        obj(
            "basis" to
                "rideSeconds = 출발역 대기 없이 그래프 최단 승차시간. Δ = rideSeconds − 운영사 공개 소요시간. " +
                "공개표는 출발→도착(중간역 정차 포함)이고 그래프 간선은 도착역 정차를 더하므로 Δ ≈ +정차시간이 정상",
            "pairs" to results.size,
            "unmatchedRows" to rows.size - results.size,
            "deltaSeconds" to distribution(deltas),
            "absDeltaSeconds" to distribution(deltas.map { kotlin.math.abs(it) }),
            "results" to results,
        ).toString(),
    )
}
