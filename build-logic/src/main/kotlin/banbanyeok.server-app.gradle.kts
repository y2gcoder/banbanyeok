// Ktor 서버 앱 컨벤션: 조립(composition root)과 HTTP 계층을 가진 server:app 모듈에 적용한다.
plugins {
    id("banbanyeok.kotlin-jvm")
    id("banbanyeok.serialization")
    application
}

sourceSets.named("integrationTest") {
    compileClasspath += sourceSets.named("test").get().output
    runtimeClasspath += sourceSets.named("test").get().output
}

// Docker 이미지가 같은 클래스패스를 학습(AppCDS)과 실행에 쓰도록 정렬된 lib 목록을 만든다(spikes/cloudrun 교훈).
tasks.named<Sync>("installDist") {
    doLast {
        val lib = destinationDir.resolve("lib")
        val names =
            lib
                .listFiles { f -> f.extension == "jar" }
                .orEmpty()
                .map { it.name }
                .sorted()
        destinationDir.resolve("classpath.txt").writeText(names.joinToString(":") { "/app/lib/$it" })
    }
}
