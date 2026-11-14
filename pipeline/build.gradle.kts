plugins {
    id("banbanyeok.cli-app")
}

application {
    mainClass.set("app.banbanyeok.pipeline.MainKt")
}

dependencies {
    // pipeline은 shared:schema에만 의존한다(검증용으로 shared:core를 쓰게 되면 그때 추가).
    implementation(project(":shared:schema"))

    testImplementation(kotlin("test"))
    "integrationTestRuntimeOnly"(libs.postgres.jdbc)
}

tasks.named<Test>("integrationTest") {
    systemProperty("kotest.framework.config.fqn", "app.banbanyeok.pipeline.ProjectConfig")
}
