package app.banbanyeok.links

import app.banbanyeok.contracts.ContractFiles
import app.banbanyeok.schema.StationCode
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** contracts/golden/link-vectors.json 전체를 통과해야 한다. 웹(TS)·앱 구현과 같은 벡터를 쓴다. */
class LinkVectorsTest {
    private val vectors: JsonObject = Json.parseToJsonElement(ContractFiles.text("golden/link-vectors.json")).jsonObject
    private val encodeVectors: JsonArray = vectors.getValue("encode").jsonArray
    private val decodeVectors: JsonArray = vectors.getValue("decode").jsonArray

    @Test
    fun vectorFileHasExpectedShape() {
        assertEquals(1, vectors.getValue("formatVersion").jsonPrimitive.int)
        assertEquals(ShareLinkCodec.PATH, vectors.getValue("path").jsonPrimitive.content)
        assertTrue(encodeVectors.size >= 9, "encode 벡터 수: ${encodeVectors.size}")
        assertTrue(decodeVectors.size >= 36, "decode 벡터 수: ${decodeVectors.size}")
    }

    @Test
    fun everyEncodeVectorMatches() {
        for (item in encodeVectors) {
            val vector = item.jsonObject
            val id = vector.getValue("id").jsonPrimitive.content
            val link = linkFrom(vector.getValue("input").jsonObject)
            assertEquals(vector.getValue("expectedQuery").jsonPrimitive.content, ShareLinkCodec.encodeQuery(link), id)
        }
    }

    @Test
    fun everyDecodeVectorMatches() {
        for (item in decodeVectors) {
            val vector = item.jsonObject
            val id = vector.getValue("id").jsonPrimitive.content
            val result = ShareLinkCodec.decodeQuery(vector.getValue("query").jsonPrimitive.content)
            val expectedError = vector["expectedError"]?.jsonPrimitive?.content
            if (expectedError != null) {
                assertEquals(LinkDecoding.Failure(LinkErrorCode.valueOf(expectedError)), result, id)
            } else {
                val expected = linkFrom(vector.getValue("expected").jsonObject)
                assertEquals(LinkDecoding.Success(expected), result, id)
            }
        }
    }

    @Test
    fun everyErrorCodeIsExercisedByVectors() {
        val seen = decodeVectors.mapNotNull { it.jsonObject["expectedError"]?.jsonPrimitive?.content }.toSet()
        assertEquals(LinkErrorCode.entries.map { it.name }.toSet(), seen)
    }

    @Test
    fun canonicalEncodingRoundTripsThroughDecoder() {
        for (item in encodeVectors) {
            val link = linkFrom(item.jsonObject.getValue("input").jsonObject)
            val decoded = ShareLinkCodec.decodeQuery(ShareLinkCodec.encodeQuery(link)).getOrNull()
            // 빈 문자열 별칭은 없는 것으로 정규화되므로 null로 바꿔 비교한다
            val normalized = link.copy(nicknames = link.nicknames?.map { it?.ifEmpty { null } })
            assertEquals(normalized, decoded, item.jsonObject.getValue("id").jsonPrimitive.content)
        }
    }

    private fun linkFrom(obj: JsonObject): ShareLink {
        val origins = obj.getValue("origins").jsonArray.map { StationCode.parse(it.jsonPrimitive.content) }
        val mode = when (obj.getValue("mode").jsonPrimitive.content) {
            "fair" -> LinkMode.Fair
            "fast" -> LinkMode.Fast
            "favor" -> LinkMode.Favor(obj.getValue("favorIndex").jsonPrimitive.int)
            else -> error("알 수 없는 mode")
        }
        val nicknames = obj.getValue("nicknames").let { element: JsonElement ->
            if (element is JsonNull) null else element.jsonArray.map { if (it is JsonNull) null else (it as JsonPrimitive).content }
        }
        return ShareLink(origins, mode, nicknames)
    }
}
