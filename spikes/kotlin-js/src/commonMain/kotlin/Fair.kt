@file:OptIn(ExperimentalJsExport::class)
import kotlin.js.ExperimentalJsExport
import kotlin.js.JsExport

// JS boundary deliberately uses arrays and integer seconds, no Kotlin collections.
@JsExport
fun rankFair(ids: Array<String>, times: Array<IntArray>): Array<String> {
    require(times.size in 2..4 && ids.toSet().size == ids.size)
    require(times.all { it.size == ids.size && it.all { t -> t >= 0 } })
    return ids.indices.sortedWith(compareBy<Int>(
        { j -> times.maxOf { it[j] } },
        { j -> times.maxOf { it[j] } - times.minOf { it[j] } },
        { j -> times.sumOf { it[j] } },
        { j -> ids[j] }
    )).map { ids[it] }.toTypedArray()
}
