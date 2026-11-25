@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.artifact

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.ManifestNames
import app.banbanyeok.schema.RouteGraphCodec
import app.banbanyeok.schema.TimeBand
import app.banbanyeok.schema.TimeSlot
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldNotContain
import io.kotest.matchers.comparables.shouldBeLessThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.types.shouldBeSameInstanceAs
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList

private val devArtifacts: Path = Path.of(System.getProperty("artifacts.dev.dir"))

private suspend fun copyDev(
    store: ArtifactStore,
    keep: (String) -> Boolean = { true },
) {
    Files
        .list(devArtifacts)
        .use { files ->
            files.filter { Files.isRegularFile(it) && keep(it.fileName.toString()) }.toList()
        }.forEach { store.put(ArtifactKey(it.fileName.toString()), Files.readAllBytes(it)) }
}

class ArtifactLoaderTest :
    DescribeSpec({
        describe("loading the dev artifacts") {
            it("loads either generation from one store and hides regional files from the legacy selector") {
                val store =
                    LocalFileArtifactStore(Files.createTempDirectory("regional-preview"), UnconfinedTestDispatcher())
                copyDev(store)
                val fixtureRoot = Path.of(System.getProperty("regional.fixture.dir"))
                Files
                    .walk(fixtureRoot.resolve("regional"))
                    .use { files ->
                        files.filter { Files.isRegularFile(it) }.toList()
                    }.forEach { file ->
                        val key = fixtureRoot.relativize(file).joinToString("/")
                        store.put(ArtifactKey(key), Files.readAllBytes(file))
                    }
                val regional = ArtifactLoader(store, regional = true).load()
                regional.dataSet.manifest.schemaVersion shouldBe 5
                regional.dataSet.registry.schemaVersion shouldBe 2
                regional.routeGraph.await()!!.formatVersion shouldBe RouteGraphCodec.REGIONAL_FORMAT_VERSION
                regional.slots.await().size shouldBe 11
                regional.lastTrains.await()!!.homeCount shouldBe 5
                val graphName =
                    regional.dataSet.manifest.files.routeGraph!!
                        .path
                        .substringAfterLast('/')
                val regionalPublished = PublishedArtifacts(store, regional)
                regionalPublished.manifest.content.toList() shouldBe
                    store.get(ArtifactKey(ManifestNames.REGIONAL))!!.content.toList()
                regionalPublished.dataFile(regional.dataVersion, graphName) shouldNotBe null

                val legacy = ArtifactLoader(store).load()
                legacy.dataSet.manifest.schemaVersion shouldBe 4
                legacy.dataSet.registry.schemaVersion shouldBe 1
                legacy.routeGraph.await()!!.formatVersion shouldBe RouteGraphCodec.FORMAT_VERSION
                PublishedArtifacts(store, legacy).dataFile(regional.dataVersion, graphName) shouldBe null
            }

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
                phases shouldContain "artifact-slots-validated"
                phases.indexOf("artifact-validated") shouldBeLessThan phases.indexOf("artifact-slots-validated")
            }

            it("reads generation 1 when generation 2 is absent (data published before T2)") {
                val store = LocalFileArtifactStore(Files.createTempDirectory("gen1-only"), UnconfinedTestDispatcher())
                copyDev(store) {
                    it != ArtifactLoader.MANIFEST_V2_KEY.value &&
                        it != ArtifactLoader.MANIFEST_V3_KEY.value &&
                        it != ArtifactLoader.MANIFEST_V4_KEY.value
                }
                val loaded = ArtifactLoader(store).load()
                loaded.dataSet.manifest.schemaVersion shouldBe 1
                loaded.slots.await() shouldBe emptyMap()
                loaded.lastTrains.await() shouldBe null
            }

            it("verifies the last-train table in the background against the same data set") {
                val phases = mutableListOf<String>()
                val loaded =
                    ArtifactLoader(LocalFileArtifactStore(devArtifacts, UnconfinedTestDispatcher())) { phases += it }
                        .load()
                loaded.dataSet.manifest.schemaVersion shouldBe 4
                val table = loaded.lastTrains.await()!!
                table.homeCount shouldBe loaded.dataSet.od.originCount
                table.meetingCount shouldBe loaded.dataSet.od.candidateCount
                table.registryVersion shouldBe loaded.dataSet.manifest.registryVersion
                phases shouldContain "artifact-last-trains-validated"
                phases.indexOf("artifact-validated") shouldBeLessThan phases.indexOf("artifact-last-trains-validated")
            }

            it("reads generation 2 when generation 3 is absent (data published before last trains)") {
                val store = LocalFileArtifactStore(Files.createTempDirectory("gen2-only"), UnconfinedTestDispatcher())
                copyDev(store) {
                    it != ArtifactLoader.MANIFEST_V3_KEY.value &&
                        it != ArtifactLoader.MANIFEST_V4_KEY.value
                }
                val loaded = ArtifactLoader(store).load()
                loaded.dataSet.manifest.schemaVersion shouldBe 2
                loaded.slots.await().size shouldBe 11
                loaded.lastTrains.await() shouldBe null
            }

            it("ignores a generation 3 manifest whose dataVersion differs and falls back to generation 2") {
                val store = LocalFileArtifactStore(Files.createTempDirectory("stale-v3"), UnconfinedTestDispatcher())
                copyDev(store) { it != ArtifactLoader.MANIFEST_V4_KEY.value }
                val v3 = store.get(ArtifactLoader.MANIFEST_V3_KEY)!!.content.decodeToString()
                val stale = Regex("\"dataVersion\": \"[0-9.]+\"").replace(v3, "\"dataVersion\": \"29991231.1\"")
                store.put(ArtifactLoader.MANIFEST_V3_KEY, stale.encodeToByteArray())
                val loaded = ArtifactLoader(store).load()
                loaded.dataSet.manifest.schemaVersion shouldBe 2
                loaded.dataVersion shouldNotBe "29991231.1"
                loaded.lastTrains.await() shouldBe null
            }

            it("falls back to generation 2 when the generation 3 manifest carries a date that is not on the calendar") {
                // PR #81 검토: lastTrainAsOf만 2026-02-30으로 바꾸면 모양 검사는 통과하고 서버가 날짜를 읽다 기동에 실패했다.
                val store = LocalFileArtifactStore(Files.createTempDirectory("bad-date"), UnconfinedTestDispatcher())
                copyDev(store) { it != ArtifactLoader.MANIFEST_V4_KEY.value }
                val v3 = store.get(ArtifactLoader.MANIFEST_V3_KEY)!!.content.decodeToString()
                val broken =
                    Regex("\"lastTrainAsOf\": \"[0-9-]+\"").replace(v3, "\"lastTrainAsOf\": \"2026-02-30\"")
                (broken == v3) shouldBe false
                store.put(ArtifactLoader.MANIFEST_V3_KEY, broken.encodeToByteArray())
                val loaded = ArtifactLoader(store).load()
                loaded.dataSet.manifest.schemaVersion shouldBe 2
                loaded.slots.await().size shouldBe 11
                loaded.lastTrains.await() shouldBe null
            }

            it(
                "still starts and serves every slot when the last-train table is tampered, and reports only that failure",
            ) {
                val store =
                    LocalFileArtifactStore(Files.createTempDirectory("tampered-lt"), UnconfinedTestDispatcher())
                copyDev(store)
                val key = ArtifactKey("lt.bin")
                val bytes =
                    store
                        .get(key)!!
                        .content
                        .copyOf()
                        .also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() }
                store.put(key, bytes)
                val loaded = ArtifactLoader(store).load()
                loaded.slots.await().size shouldBe 11
                shouldThrow<ArtifactLoadException> { loaded.lastTrains.await() }.message shouldContain "막차"
            }

            it(
                "ignores a generation 2 manifest whose dataVersion differs from manifest.json (stale after a rollback)",
            ) {
                val store = LocalFileArtifactStore(Files.createTempDirectory("stale-v2"), UnconfinedTestDispatcher())
                copyDev(store) {
                    it != ArtifactLoader.MANIFEST_V3_KEY.value &&
                        it != ArtifactLoader.MANIFEST_V4_KEY.value
                }
                val v2 = store.get(ArtifactLoader.MANIFEST_V2_KEY)!!.content.decodeToString()
                val stale = Regex("\"dataVersion\": \"[0-9.]+\"").replace(v2, "\"dataVersion\": \"29991231.1\"")
                store.put(ArtifactLoader.MANIFEST_V2_KEY, stale.encodeToByteArray())
                val loaded = ArtifactLoader(store).load()
                loaded.dataSet.manifest.schemaVersion shouldBe 1
                loaded.dataVersion shouldNotBe "29991231.1"
                loaded.slots.await() shouldBe emptyMap()
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

        describe("starting the background reads later") {
            it("reads neither the slot matrices nor the last-train table until startBackground is called") {
                val phases = CopyOnWriteArrayList<String>()
                val loaded =
                    ArtifactLoader(
                        LocalFileArtifactStore(devArtifacts, UnconfinedTestDispatcher()),
                        backgroundStart = CoroutineStart.LAZY,
                    ) { phases += it }.load()
                loaded.slots.isActive shouldBe false
                loaded.lastTrains.isActive shouldBe false
                phases shouldContain "artifact-validated"
                phases shouldNotContain "artifact-slots-validated"
                phases shouldNotContain "artifact-last-trains-validated"

                loaded.startBackground()
                loaded.startBackground() // 두 번째부터는 아무 일도 하지 않는다
                loaded.slots.await().size shouldBe 11
                loaded.lastTrains.await() shouldNotBe null
                phases.count { it == "artifact-slots-validated" } shouldBe 1
                phases.count { it == "artifact-last-trains-validated" } shouldBe 1
            }

            it(
                "lets a waiting request start the slot matrices before startBackground, and leaves the last-train table",
            ) {
                val loaded =
                    ArtifactLoader(
                        LocalFileArtifactStore(devArtifacts, UnconfinedTestDispatcher()),
                        backgroundStart = CoroutineStart.LAZY,
                    ).load()
                loaded.slots.join()
                loaded.slots.isCompleted shouldBe true
                loaded.lastTrains.isActive shouldBe false
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
