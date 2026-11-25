// server:artifact — ArtifactStore 포트(로컬 파일·GCS 구현)와 manifest 기반 산출물 로딩.
plugins { id("banbanyeok.server-lib") }

dependencies {
    api(project(":shared:schema"))
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)
    // 운영 코드는 GCS 클라이언트 라이브러리를 쓰지 않는다(콜드스타트). 통합 테스트가 에뮬레이터에 버킷을 만들 때만 쓴다.
    "integrationTestImplementation"(libs.google.cloud.storage)
    testFixturesImplementation(libs.kotlinx.coroutines.core)
}

tasks.named<Test>("integrationTest") {
    systemProperty("kotest.framework.config.fqn", "app.banbanyeok.server.artifact.ProjectConfig")
}

tasks.named<Test>("test") {
    inputs.dir(rootProject.file("contracts/fixtures/regional")).withPathSensitivity(PathSensitivity.RELATIVE)
    systemProperty("regional.fixture.dir", rootProject.file("contracts/fixtures").path)
    systemProperty(
        "artifacts.dev.dir",
        rootProject.layout.projectDirectory
            .dir("data/artifacts/dev")
            .asFile.path,
    )
}
