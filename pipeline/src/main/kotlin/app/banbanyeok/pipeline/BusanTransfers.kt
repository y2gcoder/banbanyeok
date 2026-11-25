package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Estimated walking time for ordinary OD. No last-train evidence is inferred from these rules. */
internal class BusanTransfers(
    data: JsonObject,
) {
    private val defaultSeconds = data.getValue("defaultSeconds").jsonPrimitive.int
    private val longSeconds = data.getValue("longSeconds").jsonPrimitive.int
    val longStations: Set<String> = data.getValue("longStations").jsonObject.keys

    init {
        require(defaultSeconds > 0 && longSeconds >= defaultSeconds) { "Invalid Busan transfer walks" }
    }

    fun seconds(code: String): Int = if (code in longStations) longSeconds else defaultSeconds
}
