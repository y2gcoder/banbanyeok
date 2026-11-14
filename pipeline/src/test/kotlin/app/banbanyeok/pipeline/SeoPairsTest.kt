package app.banbanyeok.pipeline

import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationStatus
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
import kotlin.io.path.readBytes
import kotlin.io.path.readText
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

private fun seoRegistry(): Registry =
    Registry(
        1,
        1,
        (1..4).map { index ->
            Station(
                "00$index",
                listOf("출발A", "출발B", "후보C", "후보D")[index - 1],
                StationStatus.ACTIVE,
                37.5,
                127.0,
                listOf("1"),
                emptyList(),
                emptyMap(),
                1,
            )
        },
    )

private fun seoMatrix(): OdMatrix =
    OdMatrix(
        1,
        intArrayOf(1, 2, 3, 4),
        intArrayOf(3, 4),
        intArrayOf(600, 300, 600, 900, 0, 300, 300, 0),
        IntArray(8),
    )

class SeoPairsTest :
    DescribeSpec({
        it("normalizes pair axes and uses fair top results with shared Korean reasons") {
            val result = seoPairs(seoRegistry(), seoMatrix(), listOf("002", "001"), "20261114.1")
            assertEquals("20261114.1", result.text("dataVersion"))
            val pair =
                result
                    .getValue("pairs")
                    .jsonArray
                    .single()
                    .jsonObject
            assertEquals("001", pair.text("a"))
            assertEquals("002", pair.text("b"))
            val ranked = pair.getValue("results").jsonArray.map { it.jsonObject }
            assertEquals(listOf("003", "004"), ranked.map { it.text("stationCode") })
            assertEquals("[600,600]", ranked[0].getValue("times").toString())
            assertEquals("600", ranked[0].text("maxSeconds"))
            assertEquals("0", ranked[0].text("spreadSeconds"))
            assertEquals("1200", ranked[0].text("totalSeconds"))
            assertEquals("둘 다 10분이에요. 2위 후보D보다 가장 오래 걸리는 사람이 5분 덜 걸려요.", ranked[0].text("reason"))
            assertTrue(ranked[1].text("reason").contains("후보C"))
        }
        it("deduplicates hubs and orders all distinct unordered pairs deterministically") {
            val result = seoPairs(seoRegistry(), seoMatrix(), listOf("003", "001", "002", "001"), "20261114.1")
            val pairs = result.getValue("pairs").jsonArray.map { it.jsonObject }
            assertEquals(listOf("001:002", "001:003", "002:003"), pairs.map { it.text("a") + ":" + it.text("b") })
            assertEquals(result, seoPairs(seoRegistry(), seoMatrix(), listOf("002", "003", "001"), "20261114.1"))
        }
        it("matches the committed SEO artifact with three fair results and no temporal or person placeholders") {
            val root = Path.of("..")
            val output = root.resolve("data/artifacts/dev")
            val dataset =
                DataSetLoader.load(
                    output.resolve("manifest.json").readText(),
                    output.resolve("stations.json").readBytes(),
                    output.resolve("candidates.json").readBytes(),
                    output.resolve("od.bin").readBytes(),
                )
            val stored = parseObject(output.resolve("seo-pairs.json").readText())
            assertEquals(
                seoPairs(
                    dataset.registry,
                    dataset.od,
                    readSeoHubs(root, dataset.registry),
                    dataset.manifest.dataVersion,
                ),
                stored,
            )
            stored.getValue("pairs").jsonArray.map { it.jsonObject }.forEach { pair ->
                assertTrue(pair.text("a") < pair.text("b"))
                assertEquals(3, pair.getValue("results").jsonArray.size)
                pair.getValue("results").jsonArray.map { it.jsonObject }.forEach { result ->
                    assertTrue(listOf("지금", "오늘", "친구").none { it in result.text("reason") })
                }
            }
        }
        it("rejects hubs outside the active origin axis") {
            assertFailsWith<IllegalArgumentException> {
                seoPairs(
                    seoRegistry(),
                    seoMatrix(),
                    listOf("001", "005"),
                    "20261114.1",
                )
            }
        }
    })
