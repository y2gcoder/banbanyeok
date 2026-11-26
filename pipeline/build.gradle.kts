plugins {
    id("banbanyeok.cli-app")
}

application {
    mainClass.set("app.banbanyeok.pipeline.MainKt")
}

dependencies {
    // SEO 사전계산은 앱/서버와 같은 순위 및 이유 생성 구현을 사용한다.
    implementation(project(":shared:schema"))
    implementation(project(":shared:core"))
    implementation(project(":shared:app-logic"))
    implementation(libs.kotlinx.serialization.json)

    testImplementation(kotlin("test"))
    "integrationTestRuntimeOnly"(libs.postgres.jdbc)
}

// The committed-data tests read these; without them a data-only change would replay a cached test result.
tasks.named<Test>("test") {
    inputs.dir(rootProject.file("data/artifacts/dev")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(rootProject.file("data/config")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(rootProject.file("data/registry")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.file(rootProject.file("web/src/lib/stations/index.gen.json")).withPathSensitivity(PathSensitivity.RELATIVE)
}

tasks.named<Test>("integrationTest") {
    systemProperty("kotest.framework.config.fqn", "app.banbanyeok.pipeline.ProjectConfig")
}
