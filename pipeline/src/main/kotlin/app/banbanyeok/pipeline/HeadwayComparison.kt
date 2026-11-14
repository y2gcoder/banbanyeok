package app.banbanyeok.pipeline

import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.io.path.writeText

internal fun writeHeadwayComparison(
    root: Path,
    before: Network,
    oldCosts: List<List<Cost>>,
) {
    val after = network(root)
    val newCosts = matrixCosts(after)
    val comparison =
        representativePairs.map { (from, to) ->
            val old =
                oldCosts[
                    before.origins.indexOfFirst {
                        it.name == from
                    },
                ][before.origins.indexOfFirst { it.name == to }]
            val new =
                newCosts[after.origins.indexOfFirst { it.name == from }][
                    after.origins.indexOfFirst {
                        it.name ==
                            to
                    },
                ]
            obj(
                "from" to from,
                "to" to to,
                "beforeSeconds" to old.seconds,
                "afterSeconds" to new.seconds,
                "deltaSeconds" to new.seconds - old.seconds,
            )
        }
    root.resolve("data/config/headway-comparison.json").writeJson(jsonValue(comparison).toString())
    val notes = root.resolve("docs/setup/p2b-notes.md")
    val heading = "## 배차 갱신 비교 (자동 생성)"
    val table =
        comparison.joinToString("\n") { row ->
            "| ${row.text("from")}→${row.text("to")} | ${row.text("beforeSeconds")} | " +
                "${row.text("afterSeconds")} | ${row.text("deltaSeconds")} |"
        }
    notes.writeText(
        notes.readText().substringBefore(heading).trimEnd() + "\n\n" + heading +
            "\n\n단위: 초. 갱신 전 설정과 갱신 후 시간표 집계를 같은 원본 그래프에서 비교한다.\n\n" +
            "| 쌍 | 갱신 전 | 갱신 후 | 변화 |\n|---|---:|---:|---:|\n" + table + "\n",
    )
    println("Wrote ten before/after pairs to data/config/headway-comparison.json")
}
