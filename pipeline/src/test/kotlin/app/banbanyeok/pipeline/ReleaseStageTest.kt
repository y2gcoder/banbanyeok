package app.banbanyeok.pipeline

import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.ManifestCodec
import app.banbanyeok.schema.Sha256
import io.kotest.core.spec.style.DescribeSpec
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.readBytes
import kotlin.io.path.readText
import kotlin.io.path.writeBytes
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

private val devArtifacts: Path = Path.of("../data/artifacts/dev")

class ReleaseStageTest :
    DescribeSpec({
        describe("stageRelease") {
            it("writesHashNamedFilesUnderVersionAndManifestPointingAtThem") {
                val out = Files.createTempDirectory("release-stage").resolve("out")
                val manifest = stageRelease(devArtifacts, out)
                val files = manifest.files
                (
                    listOfNotNull(
                        files.registry,
                        files.candidates,
                        files.od,
                        files.seoPages,
                        files.lastTrain,
                        files.routeGraph,
                    ) +
                        files.odSlots.orEmpty().values
                ).forEach { file ->
                    assertTrue(file.path.startsWith("versions/${manifest.dataVersion}/"), file.path)
                    assertTrue(
                        Regex(
                            "^versions/[0-9]{8}\\.[0-9]{1,3}/[a-z-]+\\.[0-9a-f]{16}\\.(json|bin)$",
                        ).matches(file.path),
                        file.path,
                    )
                    assertTrue(file.path.contains(".${file.sha256.take(16)}."), file.path)
                    assertTrue(file.matches(out.resolve(file.path).readBytes()), file.path)
                }
                assertEquals(manifest, ManifestCodec.parse(out.resolve("manifest.v4.json").readText()))
            }

            it("alsoWritesAGenerationThreeManifestWithoutTheRouteGraph") {
                val out = Files.createTempDirectory("release-stage").resolve("out")
                val published = stageRelease(devArtifacts, out)
                assertEquals(4, published.schemaVersion)
                val routeGraph = requireNotNull(published.files.routeGraph)
                assertTrue(
                    Regex("^versions/[0-9.]+/rg\\.[0-9a-f]{16}\\.bin$").matches(routeGraph.path),
                    routeGraph.path,
                )
                val three = ManifestCodec.parse(out.resolve("manifest.v3.json").readText())
                assertEquals(3, three.schemaVersion)
                assertEquals(3, three.minClientSchema)
                assertEquals(published.files.lastTrain, three.files.lastTrain)
                assertEquals(published.dataVersion, three.dataVersion)
                // 세대 3까지만 아는 reader(운영 중인 서버)는 모르는 키를 거부하므로 v3 파일에 노선 그래프가 남으면 안 된다.
                assertTrue("routeGraph" !in out.resolve("manifest.v3.json").readText())
                val dataSet =
                    DataSetLoader.load(
                        app.banbanyeok.schema.DataSetBytes(
                            out.resolve("manifest.v4.json").readText(),
                            out.resolve(published.files.registry.path).readBytes(),
                            out.resolve(published.files.candidates.path).readBytes(),
                            out.resolve(published.files.od.path).readBytes(),
                        ),
                        deferSlots = true,
                    )
                DataSetLoader.routeGraph(dataSet, out.resolve(routeGraph.path).readBytes())
            }

            it("alsoWritesAGenerationTwoManifestWithoutTheLastTrainTable") {
                val out = Files.createTempDirectory("release-stage").resolve("out")
                val published = stageRelease(devArtifacts, out)
                assertEquals(4, published.schemaVersion)
                val lastTrain = requireNotNull(published.files.lastTrain)
                assertTrue(Regex("^versions/[0-9.]+/lt\\.[0-9a-f]{16}\\.bin$").matches(lastTrain.path), lastTrain.path)
                val two = ManifestCodec.parse(out.resolve("manifest.v2.json").readText())
                assertEquals(2, two.schemaVersion)
                assertEquals(2, two.minClientSchema)
                assertEquals(null, two.files.lastTrain)
                assertEquals(null, two.lastTrainAsOf)
                assertEquals(published.files.odSlots, two.files.odSlots)
                assertEquals(published.dataVersion, two.dataVersion)
                // 세대 2까지만 아는 reader(운영 중인 서버)는 모르는 키를 거부하므로 v2 파일에 막차 항목이 남으면 안 된다.
                assertTrue("lastTrain" !in out.resolve("manifest.v2.json").readText())
                assertTrue("routeGraph" !in out.resolve("manifest.v2.json").readText())
                // 발행된 막차 표는 같은 데이터 세트의 축·버전으로 읽힌다.
                val dataSet =
                    DataSetLoader.load(
                        app.banbanyeok.schema.DataSetBytes(
                            out.resolve("manifest.v3.json").readText(),
                            out.resolve(published.files.registry.path).readBytes(),
                            out.resolve(published.files.candidates.path).readBytes(),
                            out.resolve(published.files.od.path).readBytes(),
                        ),
                        deferSlots = true,
                    )
                val table = DataSetLoader.lastTrains(dataSet, out.resolve(lastTrain.path).readBytes())
                assertEquals(dataSet.od.originCount, table.homeCount)
                assertEquals(dataSet.od.candidateCount, table.meetingCount)
            }

            it("alsoWritesAGenerationOneManifestForOlderServers") {
                val out = Files.createTempDirectory("release-stage").resolve("out")
                val published = stageRelease(devArtifacts, out)
                assertEquals(11, published.files.odSlots?.size)
                val old = ManifestCodec.parse(out.resolve("manifest.json").readText())
                assertEquals(1, old.schemaVersion)
                assertEquals(1, old.minClientSchema)
                assertEquals(null, old.files.odSlots)
                assertEquals(published.dataVersion, old.dataVersion)
                assertEquals(published.files.od, old.files.od)
                // 세대 1만 아는 reader(운영 중인 옛 서버)가 그대로 읽는다.
                DataSetLoader.load(
                    out.resolve("manifest.json").readText(),
                    out.resolve(old.files.registry.path).readBytes(),
                    out.resolve(old.files.candidates.path).readBytes(),
                    out.resolve(old.files.od.path).readBytes(),
                    supportedSchema = 1,
                )
            }

            it("keepsContentAndReceiptsUnchanged") {
                val out = Files.createTempDirectory("release-stage").resolve("out")
                val published = stageRelease(devArtifacts, out)
                val original = ManifestCodec.parse(devArtifacts.resolve("manifest.v4.json").readText())
                assertEquals(original.files.od.sha256, published.files.od.sha256)
                assertEquals(original.files.registry.bytes, published.files.registry.bytes)
                assertEquals(original.dataVersion, published.dataVersion)
            }

            it("rejectsSourceFilesThatDoNotMatchTheirManifestHash") {
                val source = Files.createTempDirectory("release-source")
                devArtifacts.toFile().listFiles()!!.forEach { it.copyTo(source.resolve(it.name).toFile()) }
                val od = source.resolve("od.bin")
                od.writeBytes(od.readBytes().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() })
                val out = Files.createTempDirectory("release-stage").resolve("out")
                assertFailsWith<IllegalArgumentException> { stageRelease(source, out) }
                assertTrue(!out.resolve("manifest.json").exists(), "manifest는 검증 전에 쓰지 않는다")
                assertTrue(!out.resolve("manifest.v2.json").exists(), "manifest는 검증 전에 쓰지 않는다")
                assertTrue(!out.resolve("manifest.v3.json").exists(), "manifest는 검증 전에 쓰지 않는다")
                assertTrue(!out.resolve("manifest.v4.json").exists(), "manifest는 검증 전에 쓰지 않는다")
            }

            it("isDeterministic") {
                val a = Files.createTempDirectory("release-a").resolve("out")
                val b = Files.createTempDirectory("release-b").resolve("out")
                stageRelease(devArtifacts, a)
                stageRelease(devArtifacts, b)
                assertEquals(
                    Sha256.hex(
                        listOf("manifest.json", "manifest.v2.json", "manifest.v3.json", "manifest.v4.json")
                            .map { a.resolve(it).readBytes() }
                            .reduce(ByteArray::plus),
                    ),
                    Sha256.hex(
                        listOf("manifest.json", "manifest.v2.json", "manifest.v3.json", "manifest.v4.json")
                            .map { b.resolve(it).readBytes() }
                            .reduce(ByteArray::plus),
                    ),
                )
            }
        }
    })
