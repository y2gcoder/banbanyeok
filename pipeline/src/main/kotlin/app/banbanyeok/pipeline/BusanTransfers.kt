package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Estimated walking time for ordinary OD. No last-train evidence is inferred from these rules. */
internal class BusanTransfers(
    data: JsonObject,
    previousOperatorWalks: Boolean = false,
) {
    private val defaultSeconds = data.getValue("defaultSeconds").jsonPrimitive.int
    private val longSeconds = data.getValue("longSeconds").jsonPrimitive.int
    private val long = data.getValue("longStations").jsonObject.keys
    private val interchanges = data["operatorInterchanges"]?.jsonObject
    private val operatorStations =
        interchanges
            ?.getValue("stations")
            ?.jsonObject
            ?.keys
            .orEmpty()
    private val operatorSeconds = interchanges?.getValue("seconds")?.jsonPrimitive?.int ?: longSeconds
    private val adjusted = if (previousOperatorWalks) longSeconds else operatorSeconds
    val longStations: Set<String> = long + operatorStations
    val outdoor: Map<String, Map<String, Int>> =
        data["outdoorLinks"]
            ?.jsonArray
            .orEmpty()
            .flatMap {
                val row = it.jsonObject
                val codes = row.getValue("stations").jsonArray.map { code -> code.jsonPrimitive.content }
                val estimate = row.getValue("seconds").jsonPrimitive.int
                val operatorInterchange = row["operatorInterchange"]?.jsonPrimitive?.booleanOrNull == true
                val seconds = if (operatorInterchange && !previousOperatorWalks) operatorSeconds else estimate
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
        require(
            defaultSeconds in 1..longSeconds && operatorSeconds in longSeconds..0xFFFE,
        ) { "Invalid Busan transfer walks" }
        require(long.intersect(operatorStations).isEmpty()) { "A Busan station has two walk estimates" }
    }

    fun seconds(code: String): Int =
        when (code) {
            in operatorStations -> adjusted
            in long -> longSeconds
            else -> defaultSeconds
        }
}
