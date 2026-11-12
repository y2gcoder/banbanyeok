/**
 * JVM 전용 Kotlin 모듈의 기본 컨벤션(툴체인 JDK 25, JUnit Platform). server-app, cli-app이 이 위에 얹힌다.
 */
plugins {
    id("org.jetbrains.kotlin.jvm")
}

kotlin {
    jvmToolchain(25) // 이유는 mise.toml 참고
}

tasks.withType<Test>().configureEach { useJUnitPlatform() }
