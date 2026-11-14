package app.banbanyeok.server.artifact

import app.banbanyeok.schema.DataSet
import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.ManifestCodec
import app.banbanyeok.schema.SchemaException

/** 산출물을 읽지 못했거나 검증(contracts/data-format.md §5)에 실패했다. 서버는 기동하지 않는다. */
public class ArtifactLoadException(
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

/** manifest 원문과 검증을 통과한 데이터. */
public class LoadedArtifacts(
    public val dataSet: DataSet,
    public val manifestJson: ByteArray,
    public val manifestVersion: ArtifactVersion,
) {
    public val dataVersion: String get() = dataSet.manifest.dataVersion
}

/** `manifest.json`이 가리키는 산출물 전부를 읽어 검증한다. 파일 경로는 manifest 기준 상대 경로이며 키로 그대로 쓴다. */
public class ArtifactLoader(
    private val store: ArtifactStore,
) {
    public suspend fun load(): LoadedArtifacts {
        val manifest = store.get(MANIFEST_KEY) ?: throw ArtifactLoadException("manifest.json이 저장소에 없습니다")
        val manifestText = manifest.content.decodeToString()
        try {
            val parsed = ManifestCodec.parse(manifestText)
            val files = parsed.files
            val dataSet =
                DataSetLoader.load(
                    manifestText,
                    read(files.registry.path),
                    read(files.candidates.path),
                    read(files.od.path),
                )
            return LoadedArtifacts(dataSet, manifest.content, manifest.version)
        } catch (e: SchemaException) {
            throw ArtifactLoadException("산출물 검증 실패: ${e.message}", e)
        }
    }

    private suspend fun read(path: String): ByteArray =
        store.get(ArtifactKey(path))?.content
            ?: throw ArtifactLoadException("manifest가 가리키는 파일이 없습니다: $path")

    public companion object {
        public val MANIFEST_KEY: ArtifactKey = ArtifactKey("manifest.json")
    }
}
