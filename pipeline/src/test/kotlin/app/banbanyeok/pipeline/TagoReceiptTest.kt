package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.input.ltAsOf
import app.banbanyeok.schema.ManifestCodec
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Files
import java.nio.file.Path
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.io.path.copyTo
import kotlin.io.path.createDirectories
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TagoReceiptTest :
    DescribeSpec({
        describe("regional TAGO collection") {
            it("keeps the metropolitan receipt and last-train dates when collecting Busan") {
                val repo = Path.of("..")
                val root = Files.createTempDirectory("tago-receipts")
                val config = root.resolve("data/config").createDirectories()
                val manifest = config.resolve("source-manifest.json")
                val before = sourceReceipts(repo.resolve("data/config/source-manifest.json")) - "S6-busan"
                manifest.writeText(jsonText(jsonValue(before.values)))
                repo.resolve("data/config/tago-scope.json").copyTo(config.resolve("tago-scope.json"))
                repo.resolve("data/artifacts/dev/manifest.v4.json").let {
                    assertEquals(ManifestCodec.parse(it.readText()).lastTrainAsOf, ltAsOf(root))
                }

                val asOf = ltAsOf(root)
                val busanIds = listOf("MTRBGB1S01", "MTRKRK6K110")
                val stationIds = busanIds + listOf("MTRKRK4K322", "MTRS13309", "MTRBS10101")
                val requested = mutableListOf<Triple<String, String, String>>()
                val http =
                    PipelineHttp { url, _ ->
                        val params =
                            url.substringAfter('?').split('&').associate {
                                it.substringBefore('=') to it.substringAfter('=')
                            }
                        val rows =
                            if (url.substringBefore('?').endsWith(TAGO_STATIONS)) {
                                stationIds.map { obj("subwayStationId" to it) }
                            } else {
                                requested +=
                                    Triple(
                                        params.getValue("subwayStationId"),
                                        params.getValue("dailyTypeCode"),
                                        params.getValue("upDownTypeCode"),
                                    )
                                emptyList()
                            }
                        val body =
                            obj(
                                "response" to
                                    obj(
                                        "header" to obj("resultCode" to "00"),
                                        "body" to obj("items" to obj("item" to rows), "totalCount" to rows.size),
                                    ),
                            )
                        Download(body.toString().toByteArray(), "application/json")
                    }
                val clock = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC)
                val region = TagoRegion.BUSAN
                assertEquals(0, tagoFetch(root, region, TagoApi("test", http, region.cache(root)), clock))
                val expected =
                    busanIds.flatMap { id ->
                        listOf("01", "02", "03").flatMap { day -> listOf("U", "D").map { Triple(id, day, it) } }
                    }
                assertEquals(expected, requested)
                assertTrue(Files.notExists(root.resolve("data/raw/tago")))

                val after = sourceReceipts(manifest)
                val busan = after.getValue("S6-busan")
                assertEquals(before, after - "S6-busan")
                assertEquals("data/raw/tago-busan", busan.text("file"))
                assertEquals(clock.instant().toString(), busan.text("fetched_at"))
                assertEquals(asOf, ltAsOf(root))

                val offline = PipelineHttp { _, _ -> error("completed Busan cache should resume offline") }
                assertEquals(0, tagoFetch(root, region, TagoApi(null, offline, region.cache(root))))
                assertEquals(after, sourceReceipts(manifest))
            }
        }
    })

private fun sourceReceipts(path: Path) =
    Json
        .parseToJsonElement(path.readText())
        .jsonArray
        .map { it.jsonObject }
        .associateBy { it.text("id") }
