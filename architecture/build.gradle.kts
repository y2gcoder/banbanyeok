plugins { id("banbanyeok.kotlin-jvm") }
dependencies { testImplementation(libs.konsist) }
tasks.test {
    workingDir(rootProject.projectDir)
    // ArchitectureTest(Konsist)는 다른 모듈의 소스와 빌드 스크립트를 실행 중에 읽는다. 그 파일들을 입력으로 선언하지 않으면
    // 금지 import를 넣어도 이전 결과(UP-TO-DATE·FROM-CACHE)가 재사용돼 초록이 된다(PR #95 검토). 경로는 저장소 기준 상대 경로로 본다.
    // 파일 없는 새 디렉터리도 범위 검사 대상이다(파일 트리는 빈 디렉터리를 입력으로 보지 않는다).
    inputs.property(
        "architectureDirectories",
        provider {
            listOf("server", "server/recommendation/src/main/kotlin/app/banbanyeok/server/recommendation")
                .flatMap { dir ->
                    rootDir
                        .resolve(dir)
                        .listFiles()
                        .orEmpty()
                        .filter { it.isDirectory }
                        .map { "$dir/${it.name}" }
                }.sorted()
        },
    )
    inputs
        .files(
            listOf("server", "pipeline", "shared", "build-logic").map { dir ->
                fileTree(rootDir.resolve(dir)) {
                    include("**/src/**/*.kt", "**/src/**/*.kts", "src/**/*.kt", "src/**/*.kts", "**/build.gradle.kts")
                    exclude("**/build/**")
                }
            },
        ).withPropertyName("konsistSources")
        .withPathSensitivity(PathSensitivity.RELATIVE)
}
