package app.banbanyeok.server.app

import app.banbanyeok.server.app.http.ProblemTypes
import app.banbanyeok.server.app.http.status
import app.banbanyeok.server.room.RoomError
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path

/**
 * 오류 코드 표의 원본은 contracts/problems.json이다(웹 /problems 페이지가 같은 파일에서 만든다). 서버의 [ProblemTypes]가 그 표와
 * 같은지, 방 모듈의 오류가 모두 표에 있고 상태가 맞는지 고정한다.
 */
class ProblemTypesTest :
    DescribeSpec({
        val table =
            Json
                .parseToJsonElement(
                    Files.readString(Path.of(requireNotNull(System.getProperty("contracts.dir")), "problems.json")),
                ).jsonObject
        val problems = table.getValue("problems").jsonArray.map { it.jsonObject }
        val titles =
            problems.associate {
                it.getValue("code").jsonPrimitive.content to
                    it.getValue("title").jsonPrimitive.content
            }

        it("uses the base URI of the table") {
            ProblemTypes.BASE_URI shouldBe table.getValue("baseUri").jsonPrimitive.content
        }

        it("has the same codes and titles as contracts/problems.json") {
            ProblemTypes.titles shouldBe titles
        }

        it("lists each code once") {
            problems.size shouldBe titles.size
        }

        it("builds the type URI from the code in kebab-case") {
            ProblemTypes.typeUri("ROOM_FULL") shouldBe "https://banbanyeok.app/problems/room-full"
            ProblemTypes.typeUri("INVALID_MEETING_BAND") shouldBe "https://banbanyeok.app/problems/invalid-meeting-band"
        }

        it("falls back to a generic title for a code that is not in the table") {
            ProblemTypes.title("NO_SUCH_CODE") shouldBe ProblemTypes.FALLBACK_TITLE
        }

        it("covers every room error with the status the server answers") {
            val statuses =
                problems.associate {
                    it.getValue("code").jsonPrimitive.content to
                        it.getValue("status").jsonPrimitive.int
                }
            for (error in RoomError.entries) {
                statuses[error.name] shouldBe error.kind.status().value
            }
        }
    })
