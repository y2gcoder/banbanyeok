import org.gradle.api.DefaultTask
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.tasks.IgnoreEmptyDirectories
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.SkipWhenEmpty
import org.gradle.api.tasks.TaskAction

/** commonMain 소스가 플랫폼 API를 import하지 않는지 검사한다. 컴파일러 검사에 더한 이중 안전장치. */
abstract class CommonMainPurityTask : DefaultTask() {
    @get:InputFiles
    @get:SkipWhenEmpty
    @get:IgnoreEmptyDirectories
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sources: ConfigurableFileCollection

    @TaskAction
    fun check() {
        val forbidden =
            Regex(
                """^\s*(import\s+(java|javax|android|androidx|platform|kotlinx\.browser|org\.w3c|org\.khronos)\.|import\s+kotlin\.js\.|import\s+kotlin\.native\.|import\s+kotlin\.io\.path\.|import\s+kotlin\.concurrent\.)""",
            )
        val violations =
            sources.asFileTree.files
                .filter { it.extension == "kt" }
                .flatMap { file ->
                    file.readLines().mapIndexedNotNull { i, line ->
                        if (forbidden.containsMatchIn(line)) "${file.path}:${i + 1}: ${line.trim()}" else null
                    }
                }
        if (violations.isNotEmpty()) {
            throw org.gradle.api.GradleException(
                "commonMain에 플랫폼 API import가 있습니다:\n" + violations.joinToString("\n"),
            )
        }
    }
}
