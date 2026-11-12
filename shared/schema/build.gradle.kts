// shared:schema — 데이터 계약의 Kotlin 타입, od.bin·manifest reader/writer, 레지스트리 파서.
// 형식 정의는 contracts/data-format.md. pipeline은 이 모듈만 의존한다(10.4).
plugins {
    id("banbanyeok.kmp-library")
    id("banbanyeok.contract-test-data")
    id("banbanyeok.serialization")
}

kotlin {
    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.serialization.json)
        }
    }
}
