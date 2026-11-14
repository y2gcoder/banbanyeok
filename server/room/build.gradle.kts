// server:room — 방·참여자·토큰·만료·숨기기. RoomRepository는 메모리 fake(testFixtures)와 Exposed 구현이 같은 계약 테스트를 통과한다.
plugins { id("banbanyeok.server-lib") }

dependencies {
    api(libs.kotlinx.coroutines.core)
    implementation(project(":shared:links")) // 별칭 규칙(코드포인트 20자)
    implementation(project(":shared:schema")) // StationCode 형식
    api(libs.exposed.core)
    api(libs.exposed.jdbc)
    implementation(libs.exposed.java.time)
    implementation(libs.hikaricp)
    runtimeOnly(libs.postgres.jdbc)
    testFixturesApi(libs.liquibase.core)
    testFixturesApi(libs.testcontainers.postgres)
    testFixturesApi(libs.postgres.jdbc)
    testFixturesApi(libs.hikaricp)
}

tasks.named<Test>("integrationTest") {
    systemProperty("kotest.framework.config.fqn", "app.banbanyeok.server.room.ProjectConfig")
}

val changelogDir =
    rootProject.layout.projectDirectory
        .dir("server/db/changelog")
        .asFile.path
tasks.named<Test>("integrationTest") { systemProperty("changelog.dir", changelogDir) }
