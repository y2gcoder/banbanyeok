import org.gradle.api.artifacts.VersionCatalogsExtension

plugins {
    base
    id("org.jlleitschuh.gradle.ktlint")
}

val qualityLibs = extensions.getByType<VersionCatalogsExtension>().named("libs")
ktlint {
    version.set(qualityLibs.findVersion("ktlint").get().requiredVersion)
    filter {
        exclude("**/build/**")
    }
}
// detekt 1.23.8 embeds Kotlin 2.0: isolate its CLI on JDK 21, while apps stay on 25.
val detektCli = configurations.create("detektCli")
dependencies { add(detektCli.name, qualityLibs.findLibrary("detekt-cli").get()) }
val detektJavaHome =
    providers
        .exec {
            commandLine("mise", "where", "java@temurin-21.0.9+10.0.LTS")
        }.standardOutput.asText
        .map { it.trim() }
val sourceDirectory = layout.projectDirectory.dir("src").asFile
val configFile = rootProject.file("config/detekt/detekt.yml")
val baselineFile = layout.projectDirectory.file("detekt-baseline.xml").asFile
val pipelineModule = project.path == ":pipeline"

fun JavaExec.configureDetekt(createBaseline: Boolean) {
    setExecutable(detektJavaHome.get() + "/bin/java")
    setClasspath(detektCli)
    mainClass.set("io.gitlab.arturbosch.detekt.cli.Main")
    args("--input", sourceDirectory, "--config", configFile, "--build-upon-default-config", "--jvm-target", "17")
    if (pipelineModule) args("--baseline", baselineFile)
    if (createBaseline) args("--create-baseline")
    inputs.files(fileTree(sourceDirectory) { include("**/*.kt") })
    inputs.file(configFile)
}
tasks.register<JavaExec>("detekt") {
    group = "verification"
    configureDetekt(false)
}
if (pipelineModule) tasks.register<JavaExec>("detektBaseline") { configureDetekt(true) }
tasks.named("check") { dependsOn("detekt", "ktlintCheck", ":ktlintBuildScripts", ":detektBuildLogic") }
