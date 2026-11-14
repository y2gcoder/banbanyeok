package app.banbanyeok.applogic

import app.banbanyeok.contracts.ContractFiles
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** contracts/golden/display-labels.json 전체를 통과해야 한다. 숨긴 사람은 서버 매퍼처럼 출발역 이름을 넘기지 않는다. */
class DisplayLabelVectorsTest {
    private val file: JsonObject = Json.parseToJsonElement(ContractFiles.text("golden/display-labels.json")).jsonObject
    private val vectors = file.getValue("vectors").jsonArray.map { it.jsonObject }

    @Test
    fun vectorFileHasExpectedShape() {
        assertEquals(1, file.getValue("formatVersion").jsonPrimitive.int)
        assertTrue(vectors.size >= 12, "벡터 수: ${vectors.size}")
        assertEquals(vectors.size, vectors.map { it.getValue("id").jsonPrimitive.content }.toSet().size, "id 중복")
    }

    @Test
    fun everyVectorMatches() {
        for (vector in vectors) {
            val id = vector.getValue("id").jsonPrimitive.content
            val people =
                vector.getValue("people").jsonArray.mapIndexed { i, element ->
                    val person = element.jsonObject
                    val hidden = person.getValue("hidden").jsonPrimitive.boolean
                    PersonRef(
                        id = "p$i",
                        name = person.getValue("name").jsonPrimitive.contentOrNull,
                        originName = if (hidden) null else person.getValue("originName").jsonPrimitive.contentOrNull,
                    )
                }
            val expected =
                vector.getValue("expected").jsonArray.map {
                    val label = it.jsonObject
                    ParticipantLabel(
                        label.getValue("label").jsonPrimitive.content,
                        LabelKind.valueOf(
                            label
                                .getValue("kind")
                                .jsonPrimitive.content
                                .uppercase(),
                        ),
                    )
                }
            assertEquals(expected, ParticipantLabels.of(people), id)
        }
    }
}
