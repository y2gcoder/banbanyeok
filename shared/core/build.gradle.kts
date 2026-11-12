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
