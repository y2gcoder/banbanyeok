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

// The included build applies the same detekt version/configuration on JDK 25.
tasks.register("detektBuildLogic") {
    dependsOn(gradle.includedBuild("build-logic").task(":detekt"))
}
