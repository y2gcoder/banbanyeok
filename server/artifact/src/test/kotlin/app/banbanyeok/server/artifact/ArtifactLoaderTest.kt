@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.artifact

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import java.nio.file.Files
import java.nio.file.Path

private val devArtifacts: Path = Path.of(System.getProperty("artifacts.dev.dir"))

private suspend fun copyDev(store: ArtifactStore) {
    Files
        .list(devArtifacts)
        .use { files ->
            files.filter { Files.isRegularFile(it) }.toList()
        }.forEach { store.put(ArtifactKey(it.fileName.toString()), Files.readAllBytes(it)) }
}

class ArtifactLoaderTest :
    DescribeSpec({
        describe("loading the dev artifacts") {
            it("loads and validates the data set the manifest points to") {
                val loaded = ArtifactLoader(LocalFileArtifactStore(devArtifacts, UnconfinedTestDispatcher())).load()
                loaded.dataVersion shouldBe loaded.dataSet.manifest.dataVersion
                loaded.dataSet.od.originCount shouldBe loaded.dataSet.manifest.originCount
            }
        }

        describe("failing to load") {
            it("fails when manifest.json is missing") {
                val store =
                    LocalFileArtifactStore(Files.createTempDirectory("empty-artifacts"), UnconfinedTestDispatcher())
                shouldThrow<ArtifactLoadException> { ArtifactLoader(store).load() }.message shouldContain
                    "manifest.json"
            }

            it("fails when a referenced file is missing") {
                val store =
                    LocalFileArtifactStore(Files.createTempDirectory("partial-artifacts"), UnconfinedTestDispatcher())
                copyDev(store)
                val copy = Files.createTempDirectory("partial-artifacts2")
                val partial = LocalFileArtifactStore(copy, UnconfinedTestDispatcher())
                store.list().filter { it.value != "od.bin" }.forEach { partial.put(it, store.get(it)!!.content) }
                shouldThrow<ArtifactLoadException> { ArtifactLoader(partial).load() }.message shouldContain "od.bin"
            }

            it("fails when a file's hash does not match the manifest") {
                val store =
                    LocalFileArtifactStore(Files.createTempDirectory("tampered-artifacts"), UnconfinedTestDispatcher())
                copyDev(store)
                val od = store.get(ArtifactKey("od.bin"))!!.content.copyOf()
                od[od.size - 1] = (od[od.size - 1] + 1).toByte()
                store.put(ArtifactKey("od.bin"), od)
                shouldThrow<ArtifactLoadException> { ArtifactLoader(store).load() }.message shouldContain "SHA-256"
            }
        }

        describe("serving published files") {
            it("serves the current files by version and name, and refuses unsafe names") {
                val store = LocalFileArtifactStore(devArtifacts, UnconfinedTestDispatcher())
                val loaded = ArtifactLoader(store).load()
                val published = PublishedArtifacts(store, loaded)
                val file = published.dataFile(loaded.dataVersion, "od.bin")
                file?.contentType shouldBe "application/octet-stream"
                published.dataFile(loaded.dataVersion, "../manifest.json") shouldBe null
                published.dataFile(loaded.dataVersion, "missing.json") shouldBe null
                published.dataFile("not-a-version", "od.bin") shouldBe null
            }
        }
    })
