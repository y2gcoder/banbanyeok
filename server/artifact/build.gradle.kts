// server:artifact — ArtifactStore 포트(로컬 파일·GCS 구현)와 manifest 기반 산출물 로딩.
plugins { id("banbanyeok.server-lib") }

dependencies {
    api(project(":shared:schema"))
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.google.cloud.storage)
    testFixturesImplementation(libs.kotlinx.coroutines.core)
}

tasks.named<Test>("integrationTest") {
    systemProperty("kotest.framework.config.fqn", "app.banbanyeok.server.artifact.ProjectConfig")
}

tasks.named<Test>("test") {
    systemProperty(
        "artifacts.dev.dir",
        rootProject.layout.projectDirectory
            .dir("data/artifacts/dev")
            .asFile.path,
    )
}
