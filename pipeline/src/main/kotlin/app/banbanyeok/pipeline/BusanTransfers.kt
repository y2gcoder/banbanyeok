package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Estimated walking time for ordinary OD. No last-train evidence is inferred from these rules. */
internal class BusanTransfers(
    data: JsonObject,
) {
    private val defaultSeconds = data.getValue("defaultSeconds").jsonPrimitive.int
    private val longSeconds = data.getValue("longSeconds").jsonPrimitive.int
    val longStations: Set<String> = data.getValue("longStations").jsonObject.keys
    val outdoor: Map<String, Map<String, Int>> =
        data["outdoorLinks"]
            ?.jsonArray
            .orEmpty()
            .flatMap {
                val row = it.jsonObject
                val codes = row.getValue("stations").jsonArray.map { code -> code.jsonPrimitive.content }
                val seconds = row.getValue("seconds").jsonPrimitive.int
                require(codes.size == 2 && codes[0] != codes[1] && seconds in 1..0xFFFE) {
                    "An outdoor transfer requires two distinct station codes and a positive walk"
                }
                listOf(Triple(codes[0], codes[1], seconds), Triple(codes[1], codes[0], seconds))
            }.groupBy { it.first }
            .mapValues { (_, links) ->
                require(links.size == 1) { "An outdoor transfer endpoint must belong to a single pair" }
                links.associate { (_, to, seconds) -> to to seconds }
            }

    init {
        require(defaultSeconds > 0 && longSeconds >= defaultSeconds) { "Invalid Busan transfer walks" }
    }

    fun seconds(code: String): Int = if (code in longStations) longSeconds else defaultSeconds
}
