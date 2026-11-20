package app.banbanyeok.architecture

import com.lemonappdev.konsist.api.Konsist
import com.lemonappdev.konsist.api.declaration.KoFileDeclaration
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldBeEmpty

private const val PIPELINE_MAIN = "pipeline/src/main/kotlin/app/banbanyeok/pipeline"
private const val LAST_TRAIN = "app.banbanyeok.pipeline.lasttrain"

/**
 * Sub-package of a last-train file: `model`, `input`, `compute`, `gate`, `output`, or "" for the package itself
 * (the compiler that composes them). Null for a file outside `pipeline/lasttrain`.
 */
private fun lastTrainPart(file: KoFileDeclaration): String? =
    Regex("""/pipeline/lasttrain/(?:([a-z]+)/)?[^/]+\.kt$""").find(file.path)?.let { it.groupValues[1] }

/** Which sub-package an import of a last-train declaration reaches ("" for the package itself). */
private fun importedPart(import: String): String? =
    Regex("""^${Regex.escape(LAST_TRAIN)}\.(?:([a-z]+)\.)?[A-Za-z_]\w*$""").find(import)?.let { it.groupValues[1] }

/**
 * #92 (R5): the pipeline's last-train code is split into packages by what it may touch.
 *
 * - `model`: the types and their problem-file JSON. Knows no other part.
 * - `input`: reads the caches and config files (and downloads the operator's file). Knows `model` only.
 * - `compute`: the pure computation (trains, chains, the backward search). Knows `model` only.
 * - `gate`: the gates and the report of them. Knows `model` and `compute`.
 * - `output`: writes the report and the oracle's problem file. Knows `model` only.
 * - the package itself: composes `model`, `compute` and `gate` into the table; reads and writes nothing.
 */
class PipelineLastTrainArchitectureTest :
    DescribeSpec({
        val allowed =
            mapOf(
                "model" to emptySet(),
                "input" to setOf("model"),
                "compute" to setOf("model"),
                "gate" to setOf("model", "compute"),
                "output" to setOf("model"),
                "" to setOf("model", "compute", "gate"),
            )
        val files = Konsist.scopeFromDirectory(PIPELINE_MAIN).files
        val lastTrain = files.filter { lastTrainPart(it) != null }

        describe("pipeline last-train packages") {
            it("exist as the five parts and the composing package") {
                lastTrain
                    .mapNotNull { lastTrainPart(it) }
                    .filter { it !in allowed }
                    .shouldBeEmpty()
                (allowed.keys - lastTrain.mapNotNull { lastTrainPart(it) }.toSet()).shouldBeEmpty()
            }

            it("keep the package of a file equal to its directory") {
                lastTrain
                    .filter {
                        val part = lastTrainPart(it)
                        it.packagee?.name != if (part.isNullOrEmpty()) LAST_TRAIN else "$LAST_TRAIN.$part"
                    }.map { it.path }
                    .shouldBeEmpty()
            }

            it("compute, gate, model and the composing package know no file or network") {
                // Only `input` reads and downloads, only `output` writes. Everything else gets its data as arguments.
                val ioPrefixes = listOf("java.io.", "java.nio.", "java.net.", "kotlin.io.", "kotlinx.io.")
                val ioHelpers =
                    Regex(
                        "app\\.banbanyeok\\.pipeline\\.(writeJson|readInput|readTago|readSeoulTimetables|" +
                            "verifyRaw|PipelineHttp|JdkPipelineHttp)",
                    )
                val code = Regex("""/\*.*?\*/|//[^\n]*""", RegexOption.DOT_MATCHES_ALL)
                lastTrain
                    .filter { lastTrainPart(it) !in setOf("input", "output") }
                    .flatMap { file ->
                        val imports =
                            file.imports
                                .map { it.name }
                                .filter { import ->
                                    ioPrefixes.any { import.startsWith(it) } ||
                                        ioHelpers.matches(import)
                                }
                        // The same without an import: `java.nio.file.Files.readString(...)` written out.
                        val qualified =
                            code
                                .replace(
                                    file.text
                                        .lineSequence()
                                        .filterNot { it.startsWith("import ") }
                                        .joinToString("\n"),
                                    "",
                                ).let { body -> ioPrefixes.filter { body.contains(it) } }
                        (imports + qualified).map { "${file.path}: $it" }
                    }.shouldBeEmpty()
            }

            it("depend only in the direction model < compute < gate < the composing package") {
                lastTrain
                    .flatMap { file ->
                        val part = requireNotNull(lastTrainPart(file))
                        file.imports
                            .map { it.name }
                            .mapNotNull { import -> importedPart(import)?.let { import to it } }
                            .filter { (_, target) -> target != part && target !in allowed.getValue(part) }
                            .map { (import, _) -> "${file.path} (${part.ifEmpty { "lasttrain" }}) imports $import" }
                    }.shouldBeEmpty()
            }

            it("are reached from the rest of the pipeline through the stage list, not from Main or the writers") {
                // New products are one entry in ARTIFACT_STAGES: Main knows only the keyless `official-fetch` download,
                // LastTrainStage is the one stage that drives the package, everything else sees the model's types.
                files
                    .filter { lastTrainPart(it) == null }
                    .flatMap { file ->
                        val permitted =
                            when (file.name) {
                                "LastTrainStage" -> { import: String -> import.startsWith("$LAST_TRAIN.") }
                                "Main" -> { import: String -> import == "$LAST_TRAIN.input.officialFetch" }
                                else -> { import: String -> import.startsWith("$LAST_TRAIN.model.") }
                            }
                        file.imports
                            .map { it.name }
                            .filter { it.startsWith("$LAST_TRAIN.") && !permitted(it) }
                            .map { "${file.path} imports $it" }
                    }.shouldBeEmpty()
            }
        }
    })
