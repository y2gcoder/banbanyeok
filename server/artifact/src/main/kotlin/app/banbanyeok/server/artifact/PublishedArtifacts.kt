package app.banbanyeok.server.artifact

import app.banbanyeok.schema.Sha256

public class PublishedFile(
    public val content: ByteArray,
    public val contentType: String,
    public val etag: String,
)

/**
 * `/manifest`와 `/data/{version}/{file}`가 내보내는 산출물. 현재 manifest가 가리키는 파일을 먼저 찾고,
 * 없으면 저장소의 `versions/{version}/{file}` 키를 읽는다(이전 버전의 불변 파일도 계속 받을 수 있게).
 */
public class PublishedArtifacts(
    private val store: ArtifactStore,
    private val loaded: LoadedArtifacts,
) {
    public val manifest: PublishedFile =
        PublishedFile(loaded.manifestJson, JSON, etagOf(loaded.manifestJson))

    public suspend fun dataFile(
        version: String,
        file: String,
    ): PublishedFile? {
        if (!SAFE_NAME.matches(file) || !VERSION.matches(version)) return null
        val files = loaded.dataSet.manifest.files
        val current =
            listOfNotNull(files.registry, files.candidates, files.od, files.seoPages)
                .firstOrNull { entry ->
                    entry.path.substringAfterLast('/') == file &&
                        (entry.path.startsWith("versions/$version/") || version == loaded.dataVersion)
                }?.path
        val key = current ?: "versions/$version/$file"
        val stored = store.get(ArtifactKey(key)) ?: return null
        return PublishedFile(stored.content, contentTypeOf(file), etagOf(stored.content))
    }

    private fun contentTypeOf(file: String) = if (file.endsWith(".json")) JSON else "application/octet-stream"

    private fun etagOf(bytes: ByteArray) = "\"${Sha256.hex(bytes).take(ETAG_LENGTH)}\""

    private companion object {
        const val JSON = "application/json"
        const val ETAG_LENGTH = 32
        val SAFE_NAME = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
        val VERSION = Regex("^[0-9]{8}\\.[0-9]{1,3}$")
    }
}
