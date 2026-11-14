package app.banbanyeok.server.artifact

import app.banbanyeok.schema.Sha256
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import kotlin.io.path.exists
import kotlin.io.path.isRegularFile
import kotlin.io.path.name
import kotlin.io.path.readBytes
import kotlin.io.path.relativeTo

/**
 * 디렉토리 하나를 저장소로 쓴다(로컬 개발·테스트용, `data/artifacts/dev`). 버전은 내용의 SHA-256이다.
 * 조건부 쓰기는 이 프로세스 안의 뮤텍스로만 보장한다: 한 프로세스가 쓰는 로컬 용도 전용이다.
 */
public class LocalFileArtifactStore(
    root: Path,
) : ArtifactStore {
    private val root: Path = root.toAbsolutePath().normalize()
    private val lock = Mutex()

    override suspend fun get(key: ArtifactKey): StoredArtifact? =
        withContext(Dispatchers.IO) {
            val file = resolve(key)
            if (!file.isRegularFile()) {
                null
            } else {
                val bytes = file.readBytes()
                StoredArtifact(key, bytes, versionOf(bytes))
            }
        }

    override suspend fun put(
        key: ArtifactKey,
        content: ByteArray,
        ifMatch: ArtifactVersion?,
    ): ArtifactVersion =
        lock.withLock {
            withContext(Dispatchers.IO) {
                val file = resolve(key)
                if (ifMatch != null) {
                    val current = if (file.isRegularFile()) versionOf(file.readBytes()) else ArtifactVersion.ABSENT
                    if (current != ifMatch) throw PreconditionFailedException(key)
                }
                Files.createDirectories(file.parent)
                val temp = Files.createTempFile(file.parent, TEMP_PREFIX, ".part")
                try {
                    Files.write(temp, content)
                    Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
                } finally {
                    Files.deleteIfExists(temp)
                }
                versionOf(content)
            }
        }

    override suspend fun list(prefix: String): List<ArtifactKey> =
        withContext(Dispatchers.IO) {
            if (!root.exists()) {
                emptyList()
            } else {
                Files.walk(root).use { paths ->
                    paths
                        .filter { it.isRegularFile() && !it.name.startsWith(TEMP_PREFIX) }
                        .map { it.relativeTo(root).joinToString("/") }
                        .filter { ArtifactKey.isValid(it) && it.startsWith(prefix) }
                        .sorted()
                        .map { ArtifactKey(it) }
                        .toList()
                }
            }
        }

    private fun resolve(key: ArtifactKey): Path {
        val file = root.resolve(key.value).normalize()
        check(file.startsWith(root)) { "저장소 밖의 경로입니다: $key" }
        return file
    }

    private fun versionOf(bytes: ByteArray) = ArtifactVersion(Sha256.hex(bytes))

    private companion object {
        const val TEMP_PREFIX = ".tmp-"
    }
}
