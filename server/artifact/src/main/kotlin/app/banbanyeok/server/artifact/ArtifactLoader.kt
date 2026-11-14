package app.banbanyeok.server.artifact

import app.banbanyeok.schema.DataSet
import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.ManifestCodec
import app.banbanyeok.schema.SchemaException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

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
    /** 단계 경과를 남기는 훅(시작 시간 측정용). 값은 단계 이름뿐이다. */
    private val onPhase: (String) -> Unit = {},
) {
    public suspend fun load(): LoadedArtifacts {
        val manifest = store.get(MANIFEST_KEY) ?: throw ArtifactLoadException("manifest.json이 저장소에 없습니다")
        onPhase("artifact-manifest-read")
        val manifestText = manifest.content.decodeToString()
        try {
            val parsed = ManifestCodec.parse(manifestText)
            val files = parsed.files
            // 세 파일은 서로 독립이라 동시에 읽는다(원격 저장소에서 왕복이 직렬로 쌓이지 않게).
            val (registry, candidates, od) =
                coroutineScope {
                    val registry = async { read(files.registry.path) }
                    val candidates = async { read(files.candidates.path) }
                    val od = async { read(files.od.path) }
                    Triple(registry.await(), candidates.await(), od.await())
                }
            onPhase("artifact-files-read")
            val dataSet = DataSetLoader.load(manifestText, registry, candidates, od)
            onPhase("artifact-validated")
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
