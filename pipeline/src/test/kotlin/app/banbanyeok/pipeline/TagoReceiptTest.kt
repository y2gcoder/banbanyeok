package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.input.ltAsOf
import app.banbanyeok.schema.ManifestCodec
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFileAttributeView
import java.nio.file.attribute.PosixFilePermissions
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlin.io.path.copyTo
import kotlin.io.path.createDirectories
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
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
                val requested = mutableListOf<Triple<String, String, String>>()
                val http =
                    timetableHttp(busanIds + listOf("MTRKRK4K322", "MTRS13309", "MTRBS10101"), requested::add)
                val permissions = Files.getFileAttributeView(manifest, PosixFileAttributeView::class.java)
                val mode = PosixFilePermissions.fromString("rw-r-----")
                permissions?.setPermissions(mode)
                val clock = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC)
                val region = TagoRegion.BUSAN
                assertEquals(0, tagoFetch(root, region, TagoApi("test", http, region.cache(root)), clock))
                val expected =
                    busanIds.flatMap { id ->
                        listOf("01", "02", "03").flatMap { day -> listOf("U", "D").map { Triple(id, day, it) } }
                    }
                assertEquals(expected, requested)
                assertTrue(Files.notExists(root.resolve("data/raw/tago")))
                permissions?.let { assertEquals(mode, it.readAttributes().permissions()) }

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

            it("keeps the Busan receipt and cache when collecting a new metropolitan timetable") {
                val root = Files.createTempDirectory("tago-receipts")
                val config = root.resolve("data/config").createDirectories()
                val manifest = config.resolve("source-manifest.json")
                config.resolve("tago-scope.json").writeText(
                    """{"regions":{
                        "capital":{"routePrefixes":{"MTRKRK4":"capital"},"extraStations":{},"excludedStations":{}},
                        "busan":{"routePrefixes":{"MTRBGB1":"busan"},"extraStations":{},"excludedStations":{}}},
                        "dailyTypes":["01"]}""",
                )
                manifest.writeText("[]")
                val busan = TagoRegion.BUSAN
                val capital = TagoRegion.CAPITAL
                val busanId = "MTRBGB10101"
                val capitalId = "MTRKRK4K322"
                val http = timetableHttp(listOf(busanId, capitalId))
                assertEquals(0, tagoFetch(root, capital, TagoApi("test", http, capital.cache(root))))
                assertEquals(0, tagoFetch(root, busan, TagoApi("test", http, busan.cache(root))))
                val before = sourceReceipts(manifest)
                Files.delete(capital.cache(root).resolve("stations/all-p1.json"))
                Files.delete(capital.cache(root).resolve("schedule/mtrkrk4k322-01-u-p1.json"))
                val requested = mutableListOf<Triple<String, String, String>>()
                val newerStationList = timetableHttp(listOf(capitalId, busanId), requested::add)
                assertEquals(0, tagoFetch(root, capital, TagoApi("test", newerStationList, capital.cache(root))))
                val after = sourceReceipts(manifest)
                assertEquals(before - "S6", after - "S6")
                assertNotEquals(before.getValue("S6").text("sha256"), after.getValue("S6").text("sha256"))
                assertEquals(listOf(Triple(capitalId, "01", "U")), requested)

                val offline = PipelineHttp { _, _ -> error("completed Busan cache should resume offline") }
                assertEquals(0, tagoFetch(root, busan, TagoApi(null, offline, busan.cache(root))))
                assertEquals(after, sourceReceipts(manifest))
            }
        }
    })

private fun timetableHttp(
    stationIds: List<String>,
    requestSchedule: (Triple<String, String, String>) -> Unit = {},
): PipelineHttp =
    PipelineHttp { url, _ ->
        val rows =
            if (url.substringBefore('?').endsWith(TAGO_STATIONS)) {
                stationIds.map { obj("subwayStationId" to it) }
            } else {
                val params =
                    url.substringAfter('?').split('&').associate {
                        it.substringBefore('=') to
                            it.substringAfter('=')
                    }
                requestSchedule(
                    Triple(
                        params.getValue("subwayStationId"),
                        params.getValue("dailyTypeCode"),
                        params.getValue("upDownTypeCode"),
                    ),
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

private fun sourceReceipts(path: Path) =
    Json
        .parseToJsonElement(path.readText())
        .jsonArray
        .map { it.jsonObject }
        .associateBy { it.text("id") }
