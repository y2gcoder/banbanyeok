package app.banbanyeok.architecture

import com.lemonappdev.konsist.api.Konsist
import com.lemonappdev.konsist.api.declaration.KoFileDeclaration
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.shouldBe

private const val PIPELINE_MAIN = "pipeline/src/main/kotlin/app/banbanyeok/pipeline"
private const val LAST_TRAIN = "app.banbanyeok.pipeline.lasttrain"

private val ALLOWED_DIRS = setOf("", "model", "input", "compute", "gate", "output")

/**
 * Directory of a file below `pipeline/lasttrain`, relative to it and at any depth: "" for the package itself,
 * `model`, `compute/internal`, ... Null for a file outside `pipeline/lasttrain`.
 */
internal fun lastTrainDir(path: String): String? =
    Regex("""/pipeline/lasttrain/(.*)\.kt$""")
        .find(path)
        ?.groupValues
        ?.get(1)
        ?.substringBeforeLast('/', "")

private fun lastTrainDir(file: KoFileDeclaration): String? = lastTrainDir(file.path)

/** The part a file belongs to: the first directory below `lasttrain` ("" for the package itself). */
private fun lastTrainPart(file: KoFileDeclaration): String? = lastTrainDir(file)?.substringBefore('/')

private val PARTS = setOf("model", "input", "compute", "gate", "output")

/**
 * Which part of the last-train package a reference reaches: its sub-package, or "" for a declaration of the package
 * itself. Null when it names no part (the package `lasttrain` alone, or something else).
 */
internal fun importedPart(reference: String): String? {
    val rest = reference.removePrefix("$LAST_TRAIN.").removeSuffix(".*")
    if (rest == reference || rest.isEmpty()) return null
    val first = rest.substringBefore('.')
    return if (first in PARTS) first else ""
}

/**
 * Every reference a file makes to a last-train declaration: its imports (an alias resolves to the original, a package
 * import stays `pkg` or `pkg.*`) and the fully qualified names in its code. Comments and strings are left out. This is the
 * shared reference reader (SourceUnit), the same one ArchitectureTest uses.
 */
private fun lastTrainReferences(unit: SourceUnit): List<String> =
    unit.references.filter { it.startsWith("$LAST_TRAIN.") }

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
        val units = files.associateWith { it.source() }
        val lastTrain = files.filter { lastTrainDir(it) != null }

        describe("pipeline last-train packages") {
            it("exist as the five parts and the composing package, at depth one") {
                // Every file below lasttrain/, at any depth: its directory must be one of the allowed ones exactly.
                lastTrain
                    .filter { lastTrainDir(it) !in ALLOWED_DIRS }
                    .map { "${it.path}: directory ${lastTrainDir(it)}" }
                    .shouldBeEmpty()
                (ALLOWED_DIRS - lastTrain.mapNotNull { lastTrainDir(it) }.toSet()).shouldBeEmpty()
            }

            it("keep the package of a file equal to its directory") {
                lastTrain
                    .filter {
                        val dir = requireNotNull(lastTrainDir(it))
                        it.packagee?.name !=
                            (listOf(LAST_TRAIN) + dir.split('/').filter(String::isNotEmpty)).joinToString(".")
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
                lastTrain
                    .filter { lastTrainPart(it) !in setOf("input", "output") }
                    .flatMap { file ->
                        // Imports (also aliased or wildcard) and fully qualified names in the code
                        // (`java.nio.file.Files.readString(...)` written out) both count.
                        units
                            .getValue(file)
                            .references
                            .filter { reference ->
                                // `import java.io as io` names the package itself, without the trailing dot.
                                ioPrefixes.any { reference.startsWith(it) || reference == it.removeSuffix(".") } ||
                                    ioHelpers.matches(reference)
                            }.map { "${file.path}: $it" }
                    }.shouldBeEmpty()
            }

            it("depend only in the direction model < compute < gate < the composing package") {
                // Imports and fully qualified names in the code both count.
                lastTrain
                    .flatMap { file ->
                        val part = requireNotNull(lastTrainPart(file))
                        lastTrainReferences(units.getValue(file))
                            .mapNotNull { reference -> importedPart(reference)?.let { reference to it } }
                            .filter { (_, target) -> target != part && target !in allowed.getValue(part) }
                            .map { (reference, _) -> "${file.path} (${part.ifEmpty { "lasttrain" }}) uses $reference" }
                    }.shouldBeEmpty()
            }

            it("are reached from the rest of the pipeline through the stage list, not from Main or the writers") {
                // New products are one entry in ARTIFACT_STAGES: Main knows only the keyless `official-fetch` download,
                // LastTrainStage is the one stage that drives the package, everything else sees the model's types.
                files
                    .filter { lastTrainDir(it) == null }
                    .flatMap { file ->
                        val permitted =
                            when (file.name) {
                                "LastTrainStage" -> { reference: String -> reference.startsWith("$LAST_TRAIN.") }
                                "Main" -> { reference: String -> reference == "$LAST_TRAIN.input.officialFetch" }
                                else -> { reference: String -> reference.startsWith("$LAST_TRAIN.model.") }
                            }
                        lastTrainReferences(units.getValue(file))
                            .filter { !permitted(it) }
                            .map { "${file.path} uses $it" }
                    }.shouldBeEmpty()
            }
        }

        describe("the checks themselves") {
            it("see a file at any depth below lasttrain") {
                val base = "/x/pipeline/src/main/kotlin/app/banbanyeok/pipeline"
                lastTrainDir("$base/lasttrain/LastTrainCompiler.kt") shouldBe ""
                lastTrainDir("$base/lasttrain/compute/LtSources.kt") shouldBe "compute"
                // Regression (#98 review): a file two levels down was matched by no check at all.
                lastTrainDir("$base/lasttrain/compute/internal/Leak.kt") shouldBe "compute/internal"
                lastTrainDir("$base/lasttrain/compute/internal/deep/Leak.kt") shouldBe "compute/internal/deep"
                lastTrainDir("$base/Main.kt") shouldBe null
                ("compute/internal" in ALLOWED_DIRS) shouldBe false
            }

            it("see a fully qualified reference in the code as well as an import") {
                val unit =
                    SourceUnit(
                        "pipeline/src/main/kotlin/app/banbanyeok/pipeline/lasttrain/model/Leak.kt",
                        "package app.banbanyeok.pipeline.lasttrain.model\n" +
                            "import app.banbanyeok.pipeline.lasttrain.compute.ltDay\n" +
                            "// app.banbanyeok.pipeline.lasttrain.gate.NotCode\n" +
                            "internal fun leak() = app.banbanyeok.pipeline.lasttrain.compute.LtRef(\"station\", 0)\n",
                    )
                lastTrainReferences(unit) shouldContainExactlyInAnyOrder
                    listOf(
                        "app.banbanyeok.pipeline.lasttrain.compute.ltDay",
                        "app.banbanyeok.pipeline.lasttrain.compute.LtRef",
                    )
                // An alias resolves to the package it names, a wildcard stays a package import.
                val packages =
                    SourceUnit(
                        "pipeline/src/main/kotlin/app/banbanyeok/pipeline/lasttrain/model/Leak.kt",
                        "package app.banbanyeok.pipeline.lasttrain.model\n" +
                            "import app.banbanyeok.pipeline.lasttrain.compute as c\n" +
                            "import app.banbanyeok.pipeline.lasttrain.gate.*\n",
                    )
                lastTrainReferences(packages) shouldContainExactlyInAnyOrder
                    listOf("app.banbanyeok.pipeline.lasttrain.compute", "app.banbanyeok.pipeline.lasttrain.gate.*")
                importedPart("app.banbanyeok.pipeline.lasttrain.compute.LtRef") shouldBe "compute"
                importedPart("app.banbanyeok.pipeline.lasttrain.compileLastTrains") shouldBe ""
                // A whole package, wildcard or aliased (`import ...lasttrain.compute as c`), and a nested one.
                importedPart("app.banbanyeok.pipeline.lasttrain.compute") shouldBe "compute"
                importedPart("app.banbanyeok.pipeline.lasttrain.compute.*") shouldBe "compute"
                importedPart("app.banbanyeok.pipeline.lasttrain.compute.internal.Leak") shouldBe "compute"
                importedPart("app.banbanyeok.pipeline.lasttrain") shouldBe null
            }
        }
    })
