package app.banbanyeok.pipeline

import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.copyTo
import kotlin.io.path.createDirectories
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private const val KEY = "SECRET-KEY-123"

private const val STATIONS_PAGE =
    """{"SearchInfoBySubwayNameService":{"list_total_count":2,"RESULT":{"CODE":"INFO-000","MESSAGE":"ok"},
    "row":[{"STATION_CD":"0150","STATION_NM":"서울역","LINE_NUM":"01호선","FR_CODE":"133"},
           {"STATION_CD":"9999","STATION_NM":"범위밖","LINE_NUM":"09호선","FR_CODE":"999"}]}}"""

private fun timetablePageJson(
    week: String,
    direction: String,
) = """{"SearchSTNTimeTableByIDService":{"list_total_count":2,"RESULT":{"CODE":"INFO-000","MESSAGE":"ok"},
    "row":[{"LINE_NUM":"01호선","STATION_CD":"0150","TRAIN_NO":"1","LEFTTIME":"10:00:00","WEEK_TAG":"$week",
            "INOUT_TAG":"$direction","EXPRESS_YN":"G","BRANCH_LINE":""},
           {"LINE_NUM":"01호선","STATION_CD":"0150","TRAIN_NO":"2","LEFTTIME":"10:06:00","WEEK_TAG":"$week",
            "INOUT_TAG":"$direction","EXPRESS_YN":"G","BRANCH_LINE":""}]}}"""

private fun tempRoot(): Path {
    val root = Files.createTempDirectory("seoul-fetch")
    root.resolve("data/config").createDirectories()
    Path.of("../data/config/network-rules.json").copyTo(root.resolve("data/config/network-rules.json"))
    root.resolve("data/config/source-manifest.json").writeText("[]")
    return root
}

/** Fake S2/S5: answers by path, counts calls, and fails with the traffic-limit code after [limit] calls. */
private class FakeSeoul(
    private val limit: Int = Int.MAX_VALUE,
) : PipelineHttp {
    val urls = mutableListOf<String>()

    override fun request(
        url: String,
        form: String?,
    ): Download {
        urls.add(url)
        val body =
            when {
                urls.size > limit -> {
                    """{"RESULT":{"CODE":"ERROR-337","MESSAGE":"limit"}}"""
                }

                SEOUL_STATIONS in url -> {
                    STATIONS_PAGE
                }

                else -> {
                    url.trimEnd('/').split('/').takeLast(2).let { (week, direction) ->
                        timetablePageJson(week, direction)
                    }
                }
            }
        return Download(body.toByteArray(), "application/json")
    }
}

class SeoulFetchTest :
    DescribeSpec({
        describe("seoul-fetch") {
            val scope = { setOf("1" to "서울역") }
            it("caches every day type and direction, writes the S5 receipt and resumes without new calls") {
                val root = tempRoot()
                val http = FakeSeoul()
                assertEquals(0, seoulFetch(root, KEY, http, scope = scope))
                // 1 station list + 1 station × 3 day types × 2 directions.
                assertEquals(7, http.urls.size)
                assertTrue(http.urls.drop(1).all { "/0150/" in it })
                val receipt =
                    parseObject("""{"r":${root.resolve("data/config/source-manifest.json").readText()}}""")
                        .getValue("r")
                        .jsonArray
                        .single()
                        .jsonObject
                assertEquals("S5", receipt.text("id"))
                assertFalse(receipt.toString().contains(KEY))
                val again = FakeSeoul()
                assertEquals(0, seoulFetch(root, KEY, again, scope = scope))
                assertEquals(0, again.urls.size)
            }
            it("stops with exit 2 on the traffic limit without caching the error, then resumes") {
                val root = tempRoot()
                assertEquals(2, seoulFetch(root, KEY, FakeSeoul(limit = 3), scope = scope))
                val partial =
                    seoulCache(root)
                        .resolve("timetable")
                        .toFile()
                        .listFiles()
                        .orEmpty()
                assertEquals(2, partial.size)
                assertTrue(partial.none { it.readText().contains("ERROR") })
                val rest = FakeSeoul()
                assertEquals(0, seoulFetch(root, KEY, rest, scope = scope))
                assertEquals(4, rest.urls.size)
            }
            it("reports status codes without echoing the response body or key") {
                val failure =
                    runCatching {
                        timetablePage("""{"RESULT":{"CODE":"INFO-100","MESSAGE":"key $KEY invalid"}}""")
                    }.exceptionOrNull()
                assertTrue(failure is IllegalArgumentException)
                assertTrue(failure.message.orEmpty().contains("INFO-100"))
                assertFalse(failure.message.orEmpty().contains(KEY))
            }
        }
    })
