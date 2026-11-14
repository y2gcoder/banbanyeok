/*
 * server 기능 모듈(room, recommendation, artifact)의 컨벤션. 기능 모듈끼리는 서로 의존하지 않는다(Konsist가 검사).
 * testFixtures에 fake와 계약 테스트를 두어 단위 테스트(test), 통합 테스트(integrationTest), app 모듈이 같이 쓴다.
 */
plugins {
    id("banbanyeok.kotlin-jvm")
    id("banbanyeok.serialization")
    `java-library`
    `java-test-fixtures`
}

val serverLibs = extensions.getByType<VersionCatalogsExtension>().named("libs")
dependencies {
    listOf("kotest-runner", "kotest-assertions", "kotlinx-coroutines-test").forEach {
        add("testFixturesApi", serverLibs.findLibrary(it).get())
    }
}

// integrationTest는 같은 모듈의 단위 테스트 헬퍼도 쓴다.
sourceSets.named("integrationTest") {
    compileClasspath += sourceSets.named("test").get().output
    runtimeClasspath += sourceSets.named("test").get().output
}
