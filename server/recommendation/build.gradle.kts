// server:recommendation — shared:core의 rank를 서버 요청에 맞게 감싸고 app-logic의 문장 어댑터를 붙인다.
plugins { id("banbanyeok.server-lib") }

dependencies {
    api(project(":shared:core"))
    api(project(":shared:schema"))
    api(project(":shared:app-logic")) // Recommendation.labels가 ParticipantLabel을 쓴다
    implementation(project(":shared:links")) // 별칭 규칙(코드포인트 20자)
}

dependencies {
    implementation(libs.kotlinx.serialization.json) // contracts/holidays.json 읽기
}

// 공휴일 목록은 contracts/holidays.json 하나가 원본이다(웹도 같은 파일을 쓴다). 리소스로 넣어 서버가 읽는다.
tasks.named<ProcessResources>("processResources") {
    from(rootProject.layout.projectDirectory.file("contracts/holidays.json"))
}

tasks.named<Test>("test") {
    systemProperty(
        "contracts.dir",
        rootProject.layout.projectDirectory
            .dir("contracts")
            .asFile.path,
    )
}
