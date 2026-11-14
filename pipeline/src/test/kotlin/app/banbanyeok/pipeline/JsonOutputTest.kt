package app.banbanyeok.pipeline

import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import java.nio.file.Files
import kotlin.io.path.readBytes
import kotlin.io.path.readText

class JsonOutputTest :
    DescribeSpec({
        it("writes recursively sorted keys, preserves arrays and repeats identical UTF-8 bytes") {
            val file = Files.createTempFile("json-output", ".json")
            try {
                file.writeJson("""{"z":[{"나":2,"a":1},3],"a":"민수"}""")
                file.readText() shouldBe
                    "{\n  \"a\": \"민수\",\n  \"z\": [\n    {\n      \"a\": 1,\n      \"나\": 2\n    },\n    3\n  ]\n}\n"
                val first = file.readBytes()
                file.writeJson("""{ "a":"민수", "z":[{"a":1,"나":2},3]}""")
                file.readBytes().toList() shouldBe first.toList()
            } finally {
                Files.deleteIfExists(file)
            }
        }
    })
