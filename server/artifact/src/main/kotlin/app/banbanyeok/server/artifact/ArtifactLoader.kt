package app.banbanyeok.server.artifact

import app.banbanyeok.schema.DataSet
import app.banbanyeok.schema.DataSetBytes
import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.schema.ManifestCodec
import app.banbanyeok.schema.ManifestNames
import app.banbanyeok.schema.OdMatrix
import app.banbanyeok.schema.SchemaException
import app.banbanyeok.schema.TimeSlot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
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
    /**
     * 귀갓길 막차 표(manifest 세대 3). 구분 행렬처럼 뒤에서 읽고 검사한다. 세대 1·2 데이터면 바로 null이고, 읽기나 검증에 실패하면
     * 예외로 끝난다(서버는 계속 돌고 응답에서 막차만 빠진다).
     */
    public val lastTrains: Deferred<LastTrainTable?> = CompletableDeferred(null),
) {
    public val dataVersion: String get() = dataSet.manifest.dataVersion

    /**
     * 뒤에서 읽는 일([slots], [lastTrains])을 시작한다. [ArtifactLoader]가 `CoroutineStart.LAZY`로 만들었을 때 서버가 요청을 받기 시작한
     * 뒤에 부른다. 이미 시작했으면 아무 일도 하지 않는다. 시작 전에 [slots]를 기다리는 쪽(요청 코루틴의 `join`)이 있으면 그것이 먼저 시작한다.
     */
    public fun startBackground() {
        slots.start()
        lastTrains.start()
    }
}

/**
 * `manifest.json`이 가리키는 산출물 전부를 읽어 검증한다. 파일 경로는 manifest 기준 상대 경로이며 키로 그대로 쓴다.
 * 구분 행렬과 막차 표는 [background]에서 읽고 검사하며, 실패하면 [LoadedArtifacts.slots]·[LoadedArtifacts.lastTrains]가 예외로 끝난다
 * (구분은 기본 구분으로 계속 계산하고, 막차는 응답에서 빠진다). [backgroundStart]가 LAZY면 [LoadedArtifacts.startBackground]를 부를 때까지
 * (또는 누가 기다릴 때까지) 읽지 않는다: 서버는 이렇게 해서 이 일이 기동의 CPU를 다투지 않게 한다.
 */
public class ArtifactLoader(
    private val store: ArtifactStore,
    private val background: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val backgroundStart: CoroutineStart = CoroutineStart.DEFAULT,
    /** 단계 경과를 남기는 훅(시작 시간 측정용). 값은 단계 이름뿐이다. */
    private val onPhase: (String) -> Unit = {},
) {
    public suspend fun load(): LoadedArtifacts {
        val manifest = currentManifest()
        onPhase("artifact-manifest-read")
        val manifestText = manifest.content.decodeToString()
        val dataSet = validated("산출물 검증 실패") { core(manifestText) }
        return LoadedArtifacts(
            dataSet,
            manifest.content,
            manifest.version,
            background.async(start = backgroundStart) { slots(dataSet) },
            background.async(start = backgroundStart) { lastTrains(dataSet) },
        )
    }

    /**
     * 세대별 manifest를 함께 읽어 가장 높은 세대를 쓴다(data-format §5). 단 세대 1(발행 때 마지막에 바뀌는 포인터)과 dataVersion이
     * 다른 높은 세대는 지난 것이다(예: 옛 스크립트로 이전 데이터로 되돌림) — 그러면 그 아래 세대를, 끝내 맞는 것이 없으면 세대 1을 쓴다.
     */
    private suspend fun currentManifest(): StoredArtifact {
        val found =
            coroutineScope {
                ManifestNames.NEWEST_FIRST.map { name -> async { store.get(ArtifactKey(name)) } }.map { it.await() }
            }
        val v1 =
            found.last()
                ?: return found.firstNotNullOfOrNull { it } ?: throw ArtifactLoadException("manifest.json이 저장소에 없습니다")
        val version = dataVersionOf(v1)
        return found.dropLast(1).filterNotNull().firstOrNull { version != null && dataVersionOf(it) == version } ?: v1
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

    /** 막차 표. 세대 3 manifest가 가리킬 때만 읽는다. */
    private suspend fun lastTrains(dataSet: DataSet): LastTrainTable? {
        val file = dataSet.manifest.files.lastTrain ?: return null
        val bytes = read(file.path)
        return validated("막차 표 검증 실패") { DataSetLoader.lastTrains(dataSet, bytes) }
            .also { onPhase("artifact-last-trains-validated") }
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
        public val MANIFEST_V3_KEY: ArtifactKey = ArtifactKey(ManifestNames.GENERATION_THREE)
        public val MANIFEST_V4_KEY: ArtifactKey = ArtifactKey(ManifestNames.GENERATION_FOUR)
    }
}
