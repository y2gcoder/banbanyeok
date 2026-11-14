package app.banbanyeok.architecture

import com.lemonappdev.konsist.api.Konsist
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldBeEmpty
import java.io.File

class ArchitectureTest :
    DescribeSpec({
        describe("module boundaries") {
            it("shared sources do not import platform, persistence or server APIs") {
                Konsist
                    .scopeFromDirectory("shared")
                    .files
                    .filter { it.path.contains("Main/") }
                    .flatMap { it.imports }
                    .filter {
                        listOf("java.", "javax.", "io.ktor.", "org.jetbrains.exposed.", "kotlin.io.", "kotlinx.io.")
                            .any { prefix -> it.name.startsWith(prefix) }
                    }.shouldBeEmpty()
            }
            it("pipeline only depends on schema, core and app-logic among shared modules") {
                val dependencies =
                    Regex("""project\("(:shared:[^"]+)"\)""")
                        .findAll(File("pipeline/build.gradle.kts").readText())
                        .map { it.groupValues[1] }
                        .toList()
                Konsist
                    .scopeFromDirectory("pipeline/src")
                    .files
                    .flatMap { it.imports }
                    .filter { it.name.startsWith("app.banbanyeok.") }
                    .filterNot {
                        listOf(
                            "app.banbanyeok.pipeline.",
                            "app.banbanyeok.schema.",
                            "app.banbanyeok.core.",
                            "app.banbanyeok.applogic.",
                        ).any { prefix -> it.name.startsWith(prefix) }
                    }.shouldBeEmpty()
                dependencies
                    .filterNot {
                        it in
                            setOf(
                                ":shared:schema",
                                ":shared:core",
                                ":shared:app-logic",
                            )
                    }.shouldBeEmpty()
            }
            it("server feature modules do not depend on each other") {
                val features =
                    File("server")
                        .listFiles()
                        .orEmpty()
                        .filter { it.isDirectory && it.name !in setOf("app", "src", "build", "db") }
                features
                    .filter { File(it, "src").exists() }
                    .flatMap { module ->
                        Konsist
                            .scopeFromDirectory("server/${module.name}/src")
                            .files
                            .flatMap { it.imports }
                            .filter { imported ->
                                features.any { other ->
                                    other != module && imported.name.startsWith("app.banbanyeok.server.${other.name}.")
                                }
                            }
                    }.shouldBeEmpty()
                features
                    .flatMap { module ->
                        val build = File(module, "build.gradle.kts")
                        features.filter { other ->
                            other != module && build.exists() && build.readText().contains(":server:${other.name}")
                        }
                    }.shouldBeEmpty()
            }
            it("server feature modules do not depend on the app module or know the HTTP framework") {
                val featureImports =
                    listOf("room", "recommendation", "artifact").flatMap { module ->
                        Konsist
                            .scopeFromDirectory("server/$module/src/main")
                            .files
                            .flatMap { it.imports }
                    }
                featureImports
                    .filter { it.name.startsWith("app.banbanyeok.server.app.") || it.name.startsWith("io.ktor.") }
                    .shouldBeEmpty()
            }
            it("only the room exposed package knows Exposed and only the GCS store knows the GCS client") {
                val serverMain = Konsist.scopeFromDirectory("server").files.filter { it.path.contains("/src/main/") }
                serverMain
                    .filterNot { it.path.contains("/server/room/src/main/") && it.path.contains("/exposed/") }
                    .flatMap { it.imports }
                    .filter { it.name.startsWith("org.jetbrains.exposed.") }
                    .shouldBeEmpty()
                serverMain
                    .filterNot { it.path.endsWith("/GcsArtifactStore.kt") }
                    .flatMap { it.imports }
                    .filter { it.name.startsWith("com.google.cloud.") }
                    .shouldBeEmpty()
            }
            it("server services and application classes do not know Ktor") {
                Konsist
                    .scopeFromDirectory("server/app/src/main/kotlin/app/banbanyeok/server/app/application")
                    .files
                    .flatMap { it.imports }
                    .filter { it.name.startsWith("io.ktor.") }
                    .shouldBeEmpty()
            }
            it("server tests use the real database instead of H2 or an Exposed mock") {
                Konsist
                    .scopeFromDirectory("server")
                    .files
                    .flatMap { it.imports }
                    .filter {
                        it.name.startsWith("org.h2.") ||
                            (it.name.contains("exposed") && it.name.startsWith("io.mockk"))
                    }.shouldBeEmpty()
            }
        }
    })
