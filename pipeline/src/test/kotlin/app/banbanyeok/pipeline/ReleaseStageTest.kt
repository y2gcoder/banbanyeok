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
                    listOfNotNull(files.registry, files.candidates, files.od, files.seoPages) +
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
                assertEquals(manifest, ManifestCodec.parse(out.resolve("manifest.v2.json").readText()))
            }

            it("alsoWritesAGenerationOneManifestForOlderServers") {
                val out = Files.createTempDirectory("release-stage").resolve("out")
                val published = stageRelease(devArtifacts, out)
                assertEquals(2, published.schemaVersion)
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
                val original = ManifestCodec.parse(devArtifacts.resolve("manifest.v2.json").readText())
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
            }

            it("isDeterministic") {
                val a = Files.createTempDirectory("release-a").resolve("out")
                val b = Files.createTempDirectory("release-b").resolve("out")
                stageRelease(devArtifacts, a)
                stageRelease(devArtifacts, b)
                assertEquals(
                    Sha256.hex(a.resolve("manifest.json").readBytes() + a.resolve("manifest.v2.json").readBytes()),
                    Sha256.hex(b.resolve("manifest.json").readBytes() + b.resolve("manifest.v2.json").readBytes()),
                )
            }
        }
    })
