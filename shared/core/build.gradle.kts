plugins {
    id("banbanyeok.kmp-library")
    id("banbanyeok.contract-test-data")
}

kotlin {
    sourceSets {
        commonMain.dependencies {
            api(project(":shared:schema"))
        }
    }
}
