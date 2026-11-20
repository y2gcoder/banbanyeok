import dev.detekt.gradle.Detekt
import org.gradle.api.artifacts.VersionCatalogsExtension

plugins {
    base
    id("dev.detekt")
    id("org.jlleitschuh.gradle.ktlint")
}

val qualityLibs = extensions.getByType<VersionCatalogsExtension>().named("libs")
ktlint {
    version.set(qualityLibs.findVersion("ktlint").get().requiredVersion)
    filter {
        exclude("**/build/**")
    }
}
detekt {
    toolVersion.set(qualityLibs.findVersion("detekt").get().requiredVersion)
    config.setFrom(rootProject.file("config/detekt/detekt.yml"))
    buildUponDefaultConfig.set(true)
    debug.set(providers.gradleProperty("detektDebug").map { it.toBoolean() }.orElse(false))
    basePath.set(rootProject.layout.projectDirectory)
}
// Compilation tasks carry the classpath for full analysis, including KMP JVM.
val typedDetekt =
    tasks.withType<Detekt>().matching {
        it.name != "detekt" && !it.name.endsWith("SourceSet")
    }
tasks.named("detekt") { dependsOn(typedDetekt) }
tasks.named("check") { dependsOn("detekt", "ktlintCheck", ":ktlintBuildScripts", ":detektBuildLogic") }
