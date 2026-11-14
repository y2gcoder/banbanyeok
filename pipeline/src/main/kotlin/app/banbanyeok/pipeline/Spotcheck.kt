package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URLEncoder
import java.nio.file.Path

internal val representativePairs =
    listOf(
        "서울역" to "청량리",
        "강남" to "홍대입구",
        "성수" to "신설동",
        "신도림" to "까치산",
        "강동" to "마천",
        "강동" to "하남검단산",
        "응암" to "연신내",
        "사당" to "잠실",
        "광화문" to "왕십리",
        "답십리" to "역삼",
    )

private fun numbers(
    element: JsonElement,
    key: String,
): List<Int> =
    when (element) {
        is JsonObject -> {
            element.flatMap { (name, value) ->
                if (name == key) listOf(value.jsonPrimitive.content.toInt()) else numbers(value, key)
            }
        }

        is JsonArray -> {
            element.flatMap { numbers(it, key) }
        }

        else -> {
            emptyList()
        }
    }

internal fun spotcheck(
    root: Path,
    http: PipelineHttp = JdkPipelineHttp(),
) {
    val net = network(root)
    val costs = matrixCosts(net)
    val results =
        representativePairs.map { (from, to) ->
            val own =
                costs[net.origins.indexOfFirst { it.name == from }][net.origins.indexOfFirst { it.name == to }]
                    .seconds
            try {
                fun encode(value: String) = URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")
                val url =
                    "http://openapi.seoul.go.kr:8088/sample/json/getShtrmPath/1/5/" +
                        "${encode(from)}/${encode(to)}/${encode("2026-11-12 10:00:00")}"
                val body = parseObject(http.request(url, null).bytes.toString(Charsets.UTF_8))
                val total = numbers(body, "totalReqHr").single()
                obj(
                    "from" to from,
                    "to" to to,
                    "pipelineSeconds" to own,
                    "deltaSeconds" to own - total,
                    "apiTotalMinusSegmentsAndWaitSeconds" to
                        total - numbers(body, "reqHr").sum() - numbers(body, "wtngHr").sum(),
                    "success" to true,
                )
            } catch (_: Exception) {
                obj("from" to from, "to" to to, "success" to false, "status" to "HTTP/schema/timeout")
            }
        }
    root.resolve("data/config/spotcheck-report.json").writeJson(jsonValue(results).toString())
    require(results.all { it.text("success") == "true" }) { "Spotcheck unavailable; see spotcheck-report.json" }
}
