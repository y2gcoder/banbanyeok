// server:app — 진입점, 설정, HTTP 라우트, 조립(composition root). 기능 모듈을 여기서만 연결한다.
plugins { id("banbanyeok.server-app") }

application {
    mainClass.set("app.banbanyeok.server.app.MainKt")
    applicationDefaultJvmArgs = listOf("-Xms32m", "-Xmx256m")
}

dependencies {
    implementation(project(":server:room"))
    implementation(project(":server:recommendation"))
    implementation(project(":server:artifact"))
    implementation(project(":shared:schema"))
    implementation(project(":shared:links"))
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.netty)
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.ktor.server.status.pages)
    implementation(libs.ktor.server.cors)
    implementation(libs.ktor.server.body.limit)
    runtimeOnly(libs.logback.classic)

    testImplementation(testFixtures(project(":server:room")))
    testImplementation(testFixtures(project(":server:artifact")))
    testImplementation(libs.ktor.server.test.host)
    testImplementation(libs.openapi.request.validator)
    "integrationTestImplementation"(libs.ktor.server.test.host)
}

tasks.named<Test>("integrationTest") {
    systemProperty("kotest.framework.config.fqn", "app.banbanyeok.server.app.ProjectConfig")
    systemProperty(
        "changelog.dir",
        rootProject.layout.projectDirectory
            .dir("server/db/changelog")
            .asFile.path,
    )
    systemProperty(
        "contracts.dir",
        rootProject.layout.projectDirectory
            .dir("contracts")
            .asFile.path,
    )
    systemProperty(
        "artifacts.dev.dir",
        rootProject.layout.projectDirectory
            .dir("data/artifacts/dev")
            .asFile.path,
    )
}
tasks.named<Test>("test") {
    systemProperty(
        "contracts.dir",
        rootProject.layout.projectDirectory
            .dir("contracts")
            .asFile.path,
    )
    systemProperty(
        "artifacts.dev.dir",
        rootProject.layout.projectDirectory
            .dir("data/artifacts/dev")
            .asFile.path,
    )
}
