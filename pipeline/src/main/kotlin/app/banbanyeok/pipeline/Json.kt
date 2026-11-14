package app.banbanyeok.pipeline

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path
import kotlin.io.path.writeText

internal fun jsonValue(value: Any?): JsonElement =
    when (value) {
        null -> JsonNull
        is JsonElement -> value
        is Boolean -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        is String -> JsonPrimitive(value)
        is Collection<*> -> JsonArray(value.map(::jsonValue))
        else -> error("Unsupported JSON value")
    }

internal fun obj(vararg fields: Pair<String, Any?>): JsonObject =
    JsonObject(fields.associate { it.first to jsonValue(it.second) })

internal fun parseObject(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

internal fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content

/** Stable UTF-8 JSON output; array order is part of the data contract. */
internal fun jsonText(value: JsonElement): String =
    outputJson.encodeToString(JsonElement.serializer(), sortedJson(value)) + "\n"

internal fun jsonText(value: String): String = jsonText(Json.parseToJsonElement(value))

internal fun Path.writeJson(value: String) = writeText(jsonText(value))

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
private val outputJson =
    Json {
        prettyPrint = true
        prettyPrintIndent = "  "
    }

private fun sortedJson(value: JsonElement): JsonElement =
    when (value) {
        is JsonObject -> JsonObject(value.toSortedMap().mapValues { sortedJson(it.value) })
        is JsonArray -> JsonArray(value.map(::sortedJson))
        else -> value
    }
