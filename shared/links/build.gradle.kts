// shared:links — 자리표시 모듈. 구현은 해당 작업 단위(종합 문서 5절)가 채운다.
plugins {
    id("banbanyeok.kmp-library")
}

kotlin {
    sourceSets {
        commonMain.dependencies {
            api(project(":shared:schema"))
        }
    }
}
