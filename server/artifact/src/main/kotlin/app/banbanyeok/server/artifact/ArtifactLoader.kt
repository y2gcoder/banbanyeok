package app.banbanyeok.server.artifact

import app.banbanyeok.schema.DataSet
import app.banbanyeok.schema.DataSetBytes
import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.ManifestCodec
import app.banbanyeok.schema.ManifestNames
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.SchemaException
import app.banbanyeok.schema.TimeSlot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/** 산출물을 읽지 못했거나 검증(contracts/data-format.md §5)에 실패했다. 서버는 기동하지 않는다. */
public class ArtifactLoadException(
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

/**
 * manifest 원문과 검증을 통과한 데이터. [dataSet]은 기본 구분(평일 낮) 행렬까지이고, 그 밖의 구분 행렬은 [slots]가 뒤에서 채운다
 * (기동을 기다리게 하지 않으려고). manifest 1세대 데이터면 [slots]는 바로 빈 맵이다.
 */
public class LoadedArtifacts(
    public val dataSet: DataSet,
    public val manifestJson: ByteArray,
    public val manifestVersion: ArtifactVersion,
    public val slots: Deferred<Map<TimeSlot, OdMatrix>> = CompletableDeferred(dataSet.odSlots),
) {
    public val dataVersion: String get() = dataSet.manifest.dataVersion
}

/**
 * `manifest.json`이 가리키는 산출물 전부를 읽어 검증한다. 파일 경로는 manifest 기준 상대 경로이며 키로 그대로 쓴다.
 * 구분 행렬은 [background]에서 읽고 검사하며, 실패하면 [LoadedArtifacts.slots]가 예외로 끝난다(기본 구분으로는 계속 계산한다).
 */
public class ArtifactLoader(
    private val store: ArtifactStore,
    private val background: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    /** 단계 경과를 남기는 훅(시작 시간 측정용). 값은 단계 이름뿐이다. */
    private val onPhase: (String) -> Unit = {},
) {
    public suspend fun load(): LoadedArtifacts {
        val manifest = currentManifest()
        onPhase("artifact-manifest-read")
        val manifestText = manifest.content.decodeToString()
        val dataSet = validated("산출물 검증 실패") { core(manifestText) }
        return LoadedArtifacts(dataSet, manifest.content, manifest.version, background.async { slots(dataSet) })
    }

    /**
     * 세대 2(구분 행렬 포함)와 세대 1을 함께 읽어 세대 2를 쓴다(data-format §5). 단 세대 1(발행 때 마지막에 바뀌는 포인터)과
     * dataVersion이 다르면 세대 2는 지난 것이다(예: 옛 스크립트로 T2 이전 데이터로 되돌림) — 그때와 세대 2가 없을 때는 세대 1을 쓴다.
     */
    private suspend fun currentManifest(): StoredArtifact {
        val (v2, v1) =
            coroutineScope {
                val v2 = async { store.get(MANIFEST_V2_KEY) }
                val v1 = async { store.get(MANIFEST_KEY) }
                v2.await() to v1.await()
            }
        if (v1 == null) return v2 ?: throw ArtifactLoadException("manifest.json이 저장소에 없습니다")
        if (v2 == null) return v1
        return if (dataVersionOf(v2) != null && dataVersionOf(v2) == dataVersionOf(v1)) v2 else v1
    }

    private fun dataVersionOf(manifest: StoredArtifact): String? =
        try {
            ManifestCodec.parse(manifest.content.decodeToString()).dataVersion
        } catch (_: SchemaException) {
            null
        }

    /** manifest와 기본 파일 세 개. 서로 독립이라 동시에 읽는다(원격 저장소에서 왕복이 직렬로 쌓이지 않게). */
    private suspend fun core(manifestText: String): DataSet {
        val files = ManifestCodec.parse(manifestText).files
        val (registry, candidates, od) =
            coroutineScope {
                val registry = async { read(files.registry.path) }
                val candidates = async { read(files.candidates.path) }
                val od = async { read(files.od.path) }
                Triple(registry.await(), candidates.await(), od.await())
            }
        onPhase("artifact-files-read")
        return DataSetLoader.load(DataSetBytes(manifestText, registry, candidates, od), deferSlots = true).also {
            onPhase("artifact-validated")
        }
    }

    /** 구분 행렬. 내용이 같은 구분은 한 파일을 함께 가리키므로(토요일·일요일) 경로마다 한 번만 읽는다. */
    private suspend fun slots(dataSet: DataSet): Map<TimeSlot, OdMatrix> {
        val paths =
            dataSet.manifest.files.odSlots
                .orEmpty()
                .mapValues { it.value.path }
        val bytes =
            coroutineScope {
                paths.values
                    .distinct()
                    .associateWith { async { read(it) } }
                    .mapValues { it.value.await() }
            }
        return validated("구분 행렬 검증 실패") {
            DataSetLoader.slotMatrices(dataSet, paths.mapValues { bytes.getValue(it.value) })
        }.also { onPhase("artifact-slots-validated") }
    }

    private inline fun <T> validated(
        what: String,
        block: () -> T,
    ): T =
        try {
            block()
        } catch (e: SchemaException) {
            throw ArtifactLoadException("$what: ${e.message}", e)
        }

    private suspend fun read(path: String): ByteArray =
        store.get(ArtifactKey(path))?.content
            ?: throw ArtifactLoadException("manifest가 가리키는 파일이 없습니다: $path")

    public companion object {
        public val MANIFEST_KEY: ArtifactKey = ArtifactKey(ManifestNames.GENERATION_ONE)
        public val MANIFEST_V2_KEY: ArtifactKey = ArtifactKey(ManifestNames.GENERATION_TWO)
    }
}
