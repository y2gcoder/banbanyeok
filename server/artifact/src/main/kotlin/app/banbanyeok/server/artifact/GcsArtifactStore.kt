package app.banbanyeok.server.artifact

import com.google.cloud.storage.Blob
import com.google.cloud.storage.BlobId
import com.google.cloud.storage.BlobInfo
import com.google.cloud.storage.Storage
import com.google.cloud.storage.StorageException
import com.google.cloud.storage.StorageOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Google Cloud Storage 버킷을 저장소로 쓴다. 버전은 객체의 generation이고, `ifMatch`는 `ifGenerationMatch`로 옮긴다
 * (ABSENT는 generation 0 = "없어야 함"). 인증은 Application Default Credentials(Cloud Run 서비스 계정)뿐이며 키 파일을 읽지 않는다.
 * [prefix]는 버킷 안의 루트 접두사다(예: `published`). 비우면 버킷 루트.
 */
public class GcsArtifactStore(
    private val storage: Storage,
    private val bucket: String,
    prefix: String = "",
) : ArtifactStore {
    private val prefix: String = prefix.trim('/').let { if (it.isEmpty()) "" else "$it/" }

    override suspend fun get(key: ArtifactKey): StoredArtifact? =
        withContext(Dispatchers.IO) {
            repeat(READ_ATTEMPTS) {
                val blob = storage.get(blobId(key)) ?: return@withContext null
                try {
                    val bytes = blob.getContent(Blob.BlobSourceOption.generationMatch())
                    return@withContext StoredArtifact(key, bytes, ArtifactVersion(blob.generation.toString()))
                } catch (e: StorageException) {
                    // 읽는 사이에 다른 쪽이 덮어쓴 경우: 최신 generation으로 다시 읽는다.
                    if (e.code != HTTP_PRECONDITION_FAILED && e.code != HTTP_NOT_FOUND) throw e
                }
            }
            error("읽는 도중 계속 바뀌었습니다: $key")
        }

    override suspend fun put(
        key: ArtifactKey,
        content: ByteArray,
        ifMatch: ArtifactVersion?,
    ): ArtifactVersion =
        withContext(Dispatchers.IO) {
            val info = BlobInfo.newBuilder(blobId(key)).build()
            try {
                val blob =
                    when (ifMatch) {
                        null -> {
                            storage.create(info, content)
                        }

                        ArtifactVersion.ABSENT -> {
                            storage.create(info, content, Storage.BlobTargetOption.doesNotExist())
                        }

                        else -> {
                            storage.create(
                                info,
                                content,
                                Storage.BlobTargetOption.generationMatch(ifMatch.token.toLong()),
                            )
                        }
                    }
                ArtifactVersion(blob.generation.toString())
            } catch (e: StorageException) {
                if (e.code == HTTP_PRECONDITION_FAILED) throw PreconditionFailedException(key)
                throw e
            }
        }

    override suspend fun list(prefix: String): List<ArtifactKey> =
        withContext(Dispatchers.IO) {
            storage
                .list(bucket, Storage.BlobListOption.prefix(this@GcsArtifactStore.prefix + prefix))
                .iterateAll()
                .map { it.name.removePrefix(this@GcsArtifactStore.prefix) }
                .filter { ArtifactKey.isValid(it) }
                .sorted()
                .map { ArtifactKey(it) }
        }

    private fun blobId(key: ArtifactKey): BlobId = BlobId.of(bucket, prefix + key.value)

    public companion object {
        private const val HTTP_PRECONDITION_FAILED = 412
        private const val HTTP_NOT_FOUND = 404
        private const val READ_ATTEMPTS = 3

        /** Application Default Credentials로 연결한다. */
        public fun withDefaultCredentials(
            bucket: String,
            prefix: String = "",
        ): GcsArtifactStore = GcsArtifactStore(StorageOptions.getDefaultInstance().service, bucket, prefix)
    }
}
