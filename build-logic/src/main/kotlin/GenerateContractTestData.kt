import org.gradle.api.DefaultTask
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import java.io.File
import java.util.Base64
import java.util.Locale

/**
 * contracts/ 파일을 Kotlin 소스로 만든다. 텍스트는 문자열 조각 목록(JVM 상수 한도 65535바이트 회피),
 * .bin은 base64 문자열. 결정적 출력(경로 정렬, 고정 줄바꿈)이라 캐시 가능하다.
 */
@CacheableTask
abstract class GenerateContractTestData : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val contractsDir: DirectoryProperty

    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val files: ConfigurableFileCollection

    @get:Input
    abstract val packageName: Property<String>

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        val root = contractsDir.get().asFile
        val entries =
            files.files
                .filter { it.isFile }
                .map { it to it.relativeTo(root).invariantSeparatorsPath }
                .sortedBy { it.second }

        val out = StringBuilder()
        out.appendLine("// 자동 생성 파일: banbanyeok.contract-test-data (generateGoldenTests). 수정하지 마라.")
        out.appendLine("@file:Suppress(\"ktlint\", \"unused\")")
        out.appendLine()
        out.appendLine("package ${packageName.get()}")
        out.appendLine()
        out.appendLine("import kotlin.io.encoding.Base64")
        out.appendLine("import kotlin.io.encoding.ExperimentalEncodingApi")
        out.appendLine()
        out.appendLine("@OptIn(ExperimentalEncodingApi::class)")
        out.appendLine("object ContractFiles {")
        out.appendLine("    val paths: List<String> = listOf(${entries.joinToString { quote(it.second) }})")
        out.appendLine()
        out.appendLine("    fun text(path: String): String = when (path) {")
        entries.forEachIndexed {
            i,
            (_, rel),
            ->
            if (!isBinary(rel)) out.appendLine("        ${quote(rel)} -> file$i()")
        }
        out.appendLine("        else -> error(\"텍스트 계약 파일이 없습니다: \$path\")")
        out.appendLine("    }")
        out.appendLine()
        out.appendLine("    fun bytes(path: String): ByteArray = when (path) {")
        entries.forEachIndexed { i, (_, rel) ->
            if (isBinary(rel)) out.appendLine("        ${quote(rel)} -> Base64.decode(file$i())")
        }
        out.appendLine("        else -> text(path).encodeToByteArray()")
        out.appendLine("    }")
        entries.forEachIndexed { i, (file, rel) ->
            val content =
                if (isBinary(rel)) {
                    Base64.getEncoder().encodeToString(file.readBytes())
                } else {
                    file.readText(Charsets.UTF_8).replace("\r\n", "\n")
                }
            val chunks = content.chunked(12_000)
            out.appendLine()
            out.appendLine("    // $rel")
            out.appendLine("    private fun file$i(): String = listOf(")
            chunks.forEach { out.appendLine("        ${quote(it)},") }
            out.appendLine("    ).joinToString(\"\")")
        }
        out.appendLine("}")

        val dir = outputDir.get().asFile
        dir.deleteRecursively()
        val target = File(dir, packageName.get().replace('.', '/') + "/ContractFiles.kt")
        target.parentFile.mkdirs()
        target.writeText(out.toString())
    }

    private fun isBinary(rel: String) = rel.endsWith(".bin")

    private fun quote(text: String): String {
        val sb = StringBuilder("\"")
        for (ch in text) {
            when {
                ch == '\\' -> sb.append("\\\\")
                ch == '"' -> sb.append("\\\"")
                ch == '$' -> sb.append("\\$")
                ch == '\n' -> sb.append("\\n")
                ch == '\r' -> sb.append("\\r")
                ch == '\t' -> sb.append("\\t")
                ch.code < 0x20 || ch.code > 0x7e -> sb.append("\\u%04x".format(Locale.ROOT, ch.code))
                else -> sb.append(ch)
            }
        }
        return sb.append('"').toString()
    }
}
