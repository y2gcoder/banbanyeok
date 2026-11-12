plugins {
    `kotlin-dsl`
}

dependencies {
    // api: 모듈 빌드 스크립트의 kotlin { } 접근자가 KGP 타입을 볼 수 있어야 한다
    api(libs.kotlin.gradle.plugin)
    api(libs.kotlin.serialization.gradle.plugin)
}
