package app.banbanyeok.pipeline

import app.banbanyeok.schema.DataSetBytes
import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.Manifest
import app.banbanyeok.schema.ManifestCodec
import app.banbanyeok.schema.ManifestFile
import app.banbanyeok.schema.ManifestFiles
import app.banbanyeok.schema.ManifestNames
import app.banbanyeok.schema.generationOne
import app.banbanyeok.schema.generationThree
import app.banbanyeok.schema.generationTwo
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.deleteRecursively
import kotlin.io.path.exists
import kotlin.io.path.readBytes
import kotlin.io.path.readText
import kotlin.io.path.writeBytes
import kotlin.io.path.writeText

private const val HASH_PREFIX_LENGTH = 16

/** manifest 기준 상대 경로와 내용. 발행 이름은 `<종류>.<해시 앞 16자>.<확장자>`(contracts/data-format.md §4.3). */
private class StagedFile(
    val original: ManifestFile,
    val content: ByteArray,
    val sourceName: String,
    version: String,
) {
    private val stem = sourceName.substringBeforeLast('.')
    private val extension = sourceName.substringAfterLast('.', "")
    val key =
        "versions/$version/$stem.${original.sha256.take(HASH_PREFIX_LENGTH)}" +
            if (extension.isEmpty()) "" else ".$extension"

    fun published(): ManifestFile = original.copy(path = key)
}

/**
 * 검증을 통과한 [source] 산출물(dev manifest와 파일들)을 발행 형식으로 [out]에 쓴다:
 * `versions/<dataVersion>/<종류>.<해시16>.<확장자>` 파일들 + 그 경로를 가리키는 `manifest.json`(마지막에 쓴다).
 * 업로드는 이 디렉터리를 그대로 올리는 별도 단계(scripts/publish-artifacts.sh)가 한다: 해시 이름 파일을 먼저,
 * manifest를 마지막에 올려 포인터가 한 번에 바뀌게 한다. [out]은 먼저 비운다.
 */
@OptIn(kotlin.io.path.ExperimentalPathApi::class)
internal fun stageRelease(
    source: Path,
    out: Path,
): Manifest {
    val manifestText = latestManifest(source).readText()
    val manifest = ManifestCodec.parse(manifestText)
    val version = manifest.dataVersion
    val entries = manifest.files

    fun stage(file: ManifestFile): StagedFile {
        val content = source.resolve(file.path).readBytes()
        require(file.matches(content)) { "${file.path}가 manifest의 해시·길이와 다릅니다" }
        return StagedFile(file, content, file.path.substringAfterLast('/'), version)
    }
    val registry = stage(entries.registry)
    val candidates = stage(entries.candidates)
    val od = stage(entries.od)
    val seoPages = entries.seoPages?.let(::stage)
    val odSlots = entries.odSlots?.mapValues { stage(it.value) }
    val lastTrain = entries.lastTrain?.let(::stage)
    val routeGraph = entries.routeGraph?.let(::stage)
    // 내용이 같은 구분 행렬은 한 파일을 함께 가리킨다(같은 해시 = 같은 발행 이름). 한 번만 쓴다.
    val staged =
        (
            listOfNotNull(
                registry,
                candidates,
                od,
                seoPages,
                lastTrain,
                routeGraph,
            ) + odSlots?.values.orEmpty()
        ).distinctBy {
            it.key
        }
    require(staged.map { it.sourceName }.toSet().size == staged.size) { "발행 파일 이름이 겹칩니다" }
    val published =
        manifest.copy(
            files =
                ManifestFiles(
                    registry.published(),
                    candidates.published(),
                    od.published(),
                    seoPages?.published(),
                    odSlots?.mapValues { it.value.published() },
                    lastTrain?.published(),
                    routeGraph?.published(),
                ),
        )
    val publishedText = jsonText(ManifestCodec.encode(published))
    if (out.exists()) out.deleteRecursively()
    out.createDirectories()
    staged.forEach { file ->
        val target = out.resolve(file.key)
        target.parent.createDirectories()
        target.writeBytes(file.content)
    }
    verifyStaged(out, published, publishedText)
    val names = writeManifests(out, published, publishedText)
    println("Staged release $version: ${staged.size} files + ${names.joinToString(" + ")}")
    return published
}

/** 발행 형식 그대로 다시 읽어 검증한다(서버가 시작할 때 하는 일과 같다). */
private fun verifyStaged(
    out: Path,
    published: Manifest,
    publishedText: String,
) {
    val dataSet =
        DataSetLoader.load(
            DataSetBytes(
                publishedText,
                out.resolve(published.files.registry.path).readBytes(),
                out.resolve(published.files.candidates.path).readBytes(),
                out.resolve(published.files.od.path).readBytes(),
                published.files.odSlots
                    .orEmpty()
                    .mapValues { out.resolve(it.value.path).readBytes() },
            ),
        )
    published.files.lastTrain?.let { DataSetLoader.lastTrains(dataSet, out.resolve(it.path).readBytes()) }
    published.files.routeGraph?.let { DataSetLoader.routeGraph(dataSet, out.resolve(it.path).readBytes()) }
}

/**
 * 가장 높은 세대의 manifest와, 그 세대를 모르는 옛 서버가 발행 뒤에도 계속 기동할 수 있게(되돌리기 포함) 아래 세대를 모두 쓴다:
 * 세대 4면 `manifest.v4.json` → `manifest.v3.json`(노선 그래프 없음) → `manifest.v2.json`(막차 표도 없음) → `manifest.json`(구분 행렬도
 * 없음, 마지막). 세대 1뿐이면
 * `manifest.json`만. 세대 1은 세대 1만 아는 reader의 규칙으로 다시 읽어 검증한다.
 */
private fun writeManifests(
    out: Path,
    published: Manifest,
    publishedText: String,
): List<String> {
    if (published.files.odSlots == null) {
        out.resolve(ManifestNames.GENERATION_ONE).writeText(publishedText)
        return listOf(ManifestNames.GENERATION_ONE)
    }
    val generationOne = published.generationOne()
    val generationOneText = jsonText(ManifestCodec.encode(generationOne))
    DataSetLoader.load(
        generationOneText,
        out.resolve(generationOne.files.registry.path).readBytes(),
        out.resolve(generationOne.files.candidates.path).readBytes(),
        out.resolve(generationOne.files.od.path).readBytes(),
        supportedSchema = 1,
    )
    val written = mutableListOf<String>()
    if (published.files.routeGraph != null) {
        out.resolve(ManifestNames.GENERATION_FOUR).writeText(publishedText)
        written.add(ManifestNames.GENERATION_FOUR)
    }
    if (published.files.lastTrain != null) {
        val text =
            if (published.files.routeGraph !=
                null
            ) {
                jsonText(ManifestCodec.encode(published.generationThree()))
            } else {
                publishedText
            }
        out.resolve(ManifestNames.GENERATION_THREE).writeText(text)
        written.add(ManifestNames.GENERATION_THREE)
    }
    out.resolve(ManifestNames.GENERATION_TWO).writeText(jsonText(ManifestCodec.encode(published.generationTwo())))
    out.resolve(ManifestNames.GENERATION_ONE).writeText(generationOneText)
    return written + ManifestNames.GENERATION_TWO + ManifestNames.GENERATION_ONE
}
