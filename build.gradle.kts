// 루트에는 설정이 없다. 공통 설정은 build-logic의 컨벤션 플러그인(banbanyeok.*)이 맡고,
// Kotlin 플러그인 버전은 gradle/libs.versions.toml 한 곳에서 고정한다.

// One CLI process over staged paths also covers root/build-logic scripts without compiling them.
val ktlintCli =
    configurations.create("ktlintCli") {
        attributes.attribute(Bundling.BUNDLING_ATTRIBUTE, objects.named(Bundling.SHADOWED))
    }
dependencies { add(ktlintCli.name, libs.ktlint.cli) }
tasks.register<JavaExec>("ktlintStaged") {
    classpath = ktlintCli
    mainClass.set("com.pinterest.ktlint.Main")
    args(providers.gradleProperty("stagedKotlinFiles").get().split(","))
}

val kotlinBuildScripts =
    files("build.gradle.kts", "settings.gradle.kts") +
        // 관례 플러그인은 src/main/kotlin의 *.gradle.kts(precompiled script)라 .kts도 포함해야 한다.
        fileTree("build-logic") { include("*.kts", "src/**/*.kt", "src/**/*.kts") }
listOf("ktlintBuildScripts" to false, "ktlintFormatBuildScripts" to true).forEach { (taskName, format) ->
    tasks.register<JavaExec>(taskName) {
        classpath = ktlintCli
        mainClass.set("com.pinterest.ktlint.Main")
        if (format) args("--format")
        args(kotlinBuildScripts.files.map { it.relativeTo(rootDir).path })
    }
}

// Included build cannot apply its own precompiled plugin; bridge it to the same detekt configuration.
val detektBuildLogicCli = configurations.create("detektBuildLogicCli")
dependencies { add(detektBuildLogicCli.name, libs.detekt.cli) }
val detektJavaHome =
    providers
        .exec {
            commandLine("mise", "where", "java@temurin-21.0.9+10.0.LTS")
        }.standardOutput.asText
        .map { it.trim() }
tasks.register<JavaExec>("detektBuildLogic") {
    setExecutable(detektJavaHome.get() + "/bin/java")
    classpath = detektBuildLogicCli
    mainClass.set("io.gitlab.arturbosch.detekt.cli.Main")
    args(
        "--input",
        "build-logic/src/main/kotlin",
        "--config",
        "config/detekt/detekt.yml",
        "--build-upon-default-config",
        "--jvm-target",
        "17",
    )
}
