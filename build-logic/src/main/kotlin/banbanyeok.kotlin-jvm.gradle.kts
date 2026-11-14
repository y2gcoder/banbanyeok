/*
 * JVM 전용 Kotlin 모듈의 기본 컨벤션(툴체인 JDK 25, JUnit Platform). server-app, cli-app이 이 위에 얹힌다.
 */
plugins {
    id("banbanyeok.quality")
    id("org.jetbrains.kotlin.jvm")
}

kotlin {
    compilerOptions { allWarningsAsErrors.set(true) }
    jvmToolchain(25) // 이유는 mise.toml 참고
}

tasks.withType<Test>().configureEach { useJUnitPlatform() }

val testLibs = extensions.getByType<VersionCatalogsExtension>().named("libs")
dependencies {
    listOf(
        "kotest-runner",
        "kotest-assertions",
        "kotest-property",
        "mockk",
        "testcontainers-postgres",
        "kotlinx-coroutines-test",
    ).forEach {
        add("testImplementation", testLibs.findLibrary(it).get())
    }
}
val integrationTestSourceSet =
    sourceSets.create("integrationTest") {
        compileClasspath += sourceSets.main.get().output
        runtimeClasspath += sourceSets.main.get().output
    }
configurations[integrationTestSourceSet.implementationConfigurationName].extendsFrom(
    configurations.testImplementation.get(),
)
configurations[integrationTestSourceSet.runtimeOnlyConfigurationName].extendsFrom(configurations.testRuntimeOnly.get())
val dockerEndpoint =
    providers.environmentVariable("DOCKER_HOST").orElse(
        providers
            .exec {
                commandLine("docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}")
            }.standardOutput.asText
            .map { it.trim() },
    )
tasks.register<Test>("integrationTest") {
    environment("DOCKER_HOST", dockerEndpoint.get())
    systemProperty("api.version", "1.44")
    description = "Postgres integration tests (Docker required); deliberately separate from check"
    group = "verification"
    testClassesDirs = integrationTestSourceSet.output.classesDirs
    classpath = integrationTestSourceSet.runtimeClasspath
    shouldRunAfter(tasks.test)
}
