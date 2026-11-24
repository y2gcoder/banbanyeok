package app.banbanyeok.applogic

import app.banbanyeok.contracts.ContractFiles
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** contracts/golden/display-minutes.json 전체를 통과해야 한다. 웹(web/src/lib/display/minutes.test.ts)도 같은 파일을 읽는다. */
class DisplayMinutesVectorsTest {
    private val file: JsonObject = Json.parseToJsonElement(ContractFiles.text("golden/display-minutes.json")).jsonObject

    private fun section(name: String) = file.getValue(name).jsonArray.map { it.jsonObject }

    private fun JsonObject.int(key: String) = getValue(key).jsonPrimitive.int

    private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content

    @Test
    fun vectorFileHasExpectedShape() {
        assertEquals(1, file.int("formatVersion"))
        listOf("fromSeconds", "format", "formatSeconds", "transferLabel").forEach {
            assertTrue(section(it).isNotEmpty(), "빈 구역: $it")
        }
    }

    @Test
    fun secondsRoundHalfUpToMinutes() {
        section("fromSeconds").forEach {
            assertEquals(it.int("minutes"), DisplayMinutes.fromSeconds(it.int("seconds")), "${it.int("seconds")}초")
        }
    }

    @Test
    fun minutesAreFormattedWithHoursFromSixty() {
        section("format").forEach { assertEquals(it.text("text"), DisplayMinutes.format(it.int("minutes"))) }
        section("formatSeconds").forEach {
            assertEquals(it.text("text"), DisplayMinutes.formatSeconds(it.int("seconds")))
        }
    }

    @Test
    fun transferLabels() {
        section("transferLabel").forEach {
            assertEquals(it.text("text"), DisplayMinutes.transferLabel(it.int("transfers")))
        }
    }
}
