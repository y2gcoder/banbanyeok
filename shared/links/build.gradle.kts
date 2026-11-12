// shared:links — 공유 URL(/s) 코덱과 지도 앱(카카오맵·네이버지도) 길찾기 링크 생성기.
// 규칙의 원본은 contracts/data-format.md §7과 contracts/golden/link-vectors.json이다.
plugins {
    id("banbanyeok.kmp-library")
    id("banbanyeok.contract-test-data")
}

kotlin {
    sourceSets {
        commonMain.dependencies {
            api(project(":shared:schema"))
        }
        commonTest.dependencies {
            // 링크 벡터(JSON)를 읽는 테스트 전용
            implementation(libs.kotlinx.serialization.json)
        }
    }
}
