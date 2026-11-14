package app.banbanyeok.pipeline

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal class NetworkRules(
    private val data: JsonObject,
) {
    private val services = data.getValue("services").jsonObject
    val trunkService: String get() =
        services.entries
            .firstOrNull { "trunkEnd" in it.value.jsonObject }
            ?.key
            .orEmpty()
    val trunkLine: String get() = services[trunkService]?.jsonObject?.text("line").orEmpty()
    val trunkEnd: String get() = services[trunkService]?.jsonObject?.text("trunkEnd").orEmpty()
    val sourceOverrides: Map<String, String> get() =
        data
            .getValue("sourceLineOverrides")
            .jsonObject
            .mapValues { it.value.jsonPrimitive.content }

    fun branchAt(
        line: String,
        name: String,
    ): String =
        services.entries
            .single {
                val rule = it.value.jsonObject
                rule.text("line") == line && rule.text("root") == name
            }.key

    val branchChecks: List<List<String>> get() =
        data["branchChecks"]?.jsonArray.orEmpty().map { check ->
            check.jsonArray.map { it.jsonPrimitive.content }
        }

    fun canonical(name: String): String {
        val base = name.substringBefore('(').trim().removeSuffix("역")
        return data
            .getValue("aliases")
            .jsonObject[base]
            ?.jsonPrimitive
            ?.content ?: base
    }

    fun predecessor(
        line: String,
        name: String,
        previous: String,
    ): String =
        data
            .getValue("predecessors")
            .jsonObject["$line:$name"]
            ?.jsonPrimitive
            ?.content ?: previous

    fun bidirectional(
        line: String,
        from: String,
        to: String,
    ): Boolean {
        val oneWay =
            data
                .getValue("oneWay")
                .jsonObject[line]
                ?.jsonArray
                .orEmpty()
                .map { it.jsonPrimitive.content }
        return !(from in oneWay && to in oneWay)
    }

    fun service(
        line: String,
        name: String,
    ): String =
        services.entries
            .firstOrNull { (_, value) ->
                val rule = value.jsonObject
                rule.text("line") == line &&
                    rule.getValue("stations").jsonArray.any {
                        it.jsonPrimitive.content == canonical(name)
                    }
            }?.key ?: line

    fun sourceLine(
        line: String,
        name: String,
    ): String =
        data
            .getValue("sourceLineOverrides")
            .jsonObject["$line:$name"]
            ?.jsonPrimitive
            ?.content ?: line

    fun branchRoots(): List<Triple<String, String, String>> =
        services.entries
            .filter {
                "trunkEnd" !in it.value.jsonObject
            }.map { (id, value) -> Triple(id, value.jsonObject.text("line"), value.jsonObject.text("root")) }
}
