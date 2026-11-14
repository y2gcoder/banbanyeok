package app.banbanyeok.pipeline

import app.banbanyeok.schema.DataSetLoader
import app.banbanyeok.schema.Manifest
import app.banbanyeok.schema.ManifestCodec
import app.banbanyeok.schema.ManifestFile
import app.banbanyeok.schema.ManifestFiles
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
    val manifestText = source.resolve("manifest.json").readText()
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
    val staged = listOfNotNull(registry, candidates, od, seoPages)
    require(staged.map { it.key }.toSet().size == staged.size) { "발행 파일 이름이 겹칩니다" }
    val published =
        manifest.copy(
            files = ManifestFiles(registry.published(), candidates.published(), od.published(), seoPages?.published()),
        )
    val publishedText = jsonText(ManifestCodec.encode(published))
    if (out.exists()) out.deleteRecursively()
    out.createDirectories()
    staged.forEach { file ->
        val target = out.resolve(file.key)
        target.parent.createDirectories()
        target.writeBytes(file.content)
    }
    // 발행 형식 그대로 다시 읽어 검증한다(서버가 시작할 때 하는 일과 같다).
    DataSetLoader.load(
        publishedText,
        out.resolve(published.files.registry.path).readBytes(),
        out.resolve(published.files.candidates.path).readBytes(),
        out.resolve(published.files.od.path).readBytes(),
    )
    out.resolve("manifest.json").writeText(publishedText)
    println("Staged release $version: ${staged.size} files + manifest.json")
    return published
}
