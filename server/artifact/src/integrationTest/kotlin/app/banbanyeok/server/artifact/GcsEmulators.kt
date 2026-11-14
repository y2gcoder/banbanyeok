@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.artifact

import com.google.cloud.NoCredentials
import com.google.cloud.storage.BucketInfo
import com.google.cloud.storage.Storage
import com.google.cloud.storage.StorageOptions
import io.kotest.core.config.AbstractProjectConfig
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import org.testcontainers.containers.GenericContainer
import org.testcontainers.containers.wait.strategy.Wait
import org.testcontainers.utility.DockerImageName

/** 후보 GCS 에뮬레이터 두 개. 같은 계약 테스트를 돌려 통과하는 쪽을 고른다(docs/setup/p3-notes.md). */
enum class Emulator(
    val image: String,
    val port: Int,
    val command: List<String>,
) {
    FLOCI("floci/floci-gcp:0.12.0", 4588, emptyList()),
    FAKE_GCS(
        "fsouza/fake-gcs-server:1.56.1",
        4443,
        listOf("-scheme", "http", "-port", "4443", "-public-host", "localhost"),
    ),
}

class RunningEmulator(
    val emulator: Emulator,
) {
    private val container: GenericContainer<*> =
        GenericContainer(DockerImageName.parse(emulator.image))
            .withExposedPorts(emulator.port)
            .also { if (emulator.command.isNotEmpty()) it.withCommand(emulator.command.joinToString(" ")) }
            .waitingFor(Wait.forListeningPort())

    val storage: Storage by lazy {
        container.start()
        StorageOptions
            .newBuilder()
            .setHost("http://${container.host}:${container.getMappedPort(emulator.port)}")
            .setProjectId("test-project")
            .setCredentials(NoCredentials.getInstance())
            .build()
            .service
    }

    fun newBucketStore(): ArtifactStore {
        val bucket = "bucket-${java.util.UUID.randomUUID()}"
        storage.create(BucketInfo.of(bucket))
        return GcsArtifactStore(storage, bucket, UnconfinedTestDispatcher())
    }

    fun stop() = container.stop()
}

object Emulators {
    val running: Map<Emulator, RunningEmulator> = Emulator.entries.associateWith { RunningEmulator(it) }
}

class ProjectConfig : AbstractProjectConfig() {
    override suspend fun afterProject() {
        Emulators.running.values.forEach { runCatching { it.stop() } }
    }
}
