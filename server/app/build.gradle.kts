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
    implementation(libs.logback.classic)

    testImplementation(testFixtures(project(":server:room")))
    testImplementation(testFixtures(project(":server:artifact")))
    testImplementation(testFixtures(project(":server:recommendation")))
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
    // 경로만 넘기면 Gradle이 changelog 내용 변경을 모르고 테스트를 건너뛴다.
    inputs
        .dir(rootProject.layout.projectDirectory.dir("server/db/changelog"))
        .withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("changelog")
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
    inputs.file(rootProject.file("contracts/openapi.yaml")).withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(rootProject.file("contracts/fixtures/regional")).withPathSensitivity(PathSensitivity.RELATIVE)
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

// 로컬 실행은 저장소 루트를 작업 디렉토리로 써서 data/artifacts/dev 상대 경로가 맞는다.
tasks.named<JavaExec>("run") { workingDir = rootProject.projectDir }

// 테스트 픽스처의 Liquibase가 운영 서버로 새어 들어오지 않게 전이 의존성까지 검사한다.
val runtimeComponents =
    configurations.named("runtimeClasspath").map {
        it.incoming.resolutionResult.allComponents
            .mapNotNull { component ->
                (component.id as? org.gradle.api.artifacts.component.ModuleComponentIdentifier)?.let { id ->
                    "${id.group}:${id.module}:${id.version}"
                }
            }.sorted()
    }
val checkNoLiquibaseRuntime by tasks.registering {
    group = "verification"
    description = "Reject Liquibase in the production server runtime dependency graph"
    inputs.property("runtimeComponents", runtimeComponents)
    doLast {
        val components = inputs.properties.getValue("runtimeComponents") as List<*>
        check(components.none { it.toString().startsWith("org.liquibase:") }) {
            "Liquibase must run outside the server: ${components.filter { it.toString().startsWith("org.liquibase:") }}"
        }
    }
}
tasks.named("check") { dependsOn(checkNoLiquibaseRuntime) }
