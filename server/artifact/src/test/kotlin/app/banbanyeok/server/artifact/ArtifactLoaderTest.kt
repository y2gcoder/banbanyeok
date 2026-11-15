@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.artifact

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.TimeBand
import app.banbanyeok.schema.TimeSlot
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.comparables.shouldBeLessThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.types.shouldBeSameInstanceAs
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

            it("verifies every non-default time slot in the background, sharing one matrix per file") {
                val phases = mutableListOf<String>()
                val loaded =
                    ArtifactLoader(LocalFileArtifactStore(devArtifacts, UnconfinedTestDispatcher())) { phases += it }
                        .load()
                val slots = loaded.slots.await()
                slots.keys shouldBe TimeSlot.ALL.filter { it != TimeSlot.DEFAULT }.toSet()
                slots.getValue(TimeSlot(DayType.SATURDAY, TimeBand.NIGHT)) shouldBeSameInstanceAs
                    slots.getValue(TimeSlot(DayType.HOLIDAY, TimeBand.NIGHT))
                slots.values.forEach { it.originCount shouldBe loaded.dataSet.od.originCount }
                phases.last() shouldBe "artifact-slots-validated"
                phases.indexOf("artifact-validated") shouldBeLessThan phases.indexOf("artifact-slots-validated")
            }

            it("still starts on the default slot when a slot file is tampered, and reports the slot failure") {
                val store =
                    LocalFileArtifactStore(Files.createTempDirectory("tampered-slot"), UnconfinedTestDispatcher())
                copyDev(store)
                val key = ArtifactKey("od-weekday-night.bin")
                val bytes =
                    store
                        .get(key)!!
                        .content
                        .copyOf()
                        .also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() }
                store.put(key, bytes)
                val loaded = ArtifactLoader(store).load()
                loaded.dataSet.od.originCount shouldBe loaded.dataSet.manifest.originCount
                shouldThrow<ArtifactLoadException> { loaded.slots.await() }.message shouldContain "구분"
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
