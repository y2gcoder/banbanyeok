@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.artifact

import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import java.nio.file.Files
import java.nio.file.Path

class LocalFileArtifactStoreTest :
    DescribeSpec({
        val root: Path = Files.createTempDirectory("artifact-store-test")
        it("schedules file IO on the injected dispatcher") {
            runTest {
                val store = LocalFileArtifactStore(root, StandardTestDispatcher(testScheduler))
                val write =
                    async(
                        start = CoroutineStart.UNDISPATCHED,
                    ) { store.put(ArtifactKey("scheduled.json"), byteArrayOf(1)) }
                write.isCompleted shouldBe false
                runCurrent()
                write.isCompleted shouldBe true
                store.get(ArtifactKey("scheduled.json"))?.version shouldBe write.await()
            }
        }
        afterSpec { root.toFile().deleteRecursively() }
        include("local file store", artifactStoreContract { LocalFileArtifactStore(root, UnconfinedTestDispatcher()) })
    })
