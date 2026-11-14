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

tasks.named<Test>("integrationTest") {
    systemProperty("kotest.framework.config.fqn", "app.banbanyeok.pipeline.ProjectConfig")
}
