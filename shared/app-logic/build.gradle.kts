// shared:app-logic — 앱·서버가 같이 쓰는 클라이언트 쪽 로직: 추천 이유 문장 생성, 입력 검증, 극단 상황 문구.
// shared:core에는 의존하지 않는다(코어 타입과의 어댑터는 서버가 붙인다). 규칙표는 docs/setup/p6-notes.md.
plugins {
    id("banbanyeok.kmp-library")
}

kotlin {
    sourceSets {
        commonMain.dependencies {
            implementation(project(":shared:schema")) // StationCode 형식 검사
            implementation(project(":shared:links")) // 별칭 규칙(코드포인트 20자)
        }
    }
}
