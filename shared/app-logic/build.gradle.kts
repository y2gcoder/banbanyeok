// shared:app-logic — 앱·서버가 같이 쓰는 클라이언트 쪽 로직: 참가자 표시 이름, 추천 이유 문장 생성, 입력 검증, 극단 상황 문구.
// shared:core에는 의존하지 않는다(코어 타입과의 어댑터는 서버가 붙인다). 규칙표는 docs/setup/p6-notes.md.
plugins {
    id("banbanyeok.kmp-library")
    id("banbanyeok.contract-test-data")
}

kotlin {
    sourceSets {
        commonMain.dependencies {
            implementation(project(":shared:schema")) // StationCode 형식 검사
            implementation(project(":shared:links")) // 별칭 규칙(코드포인트 20자)
        }
        commonTest.dependencies {
            // 표시 이름 벡터(JSON)를 읽는 테스트 전용
            implementation(libs.kotlinx.serialization.json)
        }
    }
}
