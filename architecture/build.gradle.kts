plugins { id("banbanyeok.kotlin-jvm") }
dependencies { testImplementation(libs.konsist) }
tasks.test {
    workingDir(rootProject.projectDir)
    // The rules read the other modules' sources and build files, so a change there must run them again
    // (without this Gradle replays a cached pass after a rule-breaking edit).
    inputs.files(
        rootProject.fileTree(rootProject.projectDir) {
            include(
                "shared/**/src/**",
                "server/**/src/**",
                "pipeline/src/**",
                "pipeline/build.gradle.kts",
                "server/*/build.gradle.kts",
            )
            exclude("**/build/**")
        },
    )
}
