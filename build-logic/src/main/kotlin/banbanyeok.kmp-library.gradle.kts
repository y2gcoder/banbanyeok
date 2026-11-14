/*
 * shared 아래 모듈의 KMP 컨벤션.
 *
 * 타깃은 jvm만 켠다. 웹은 추천을 직접 계산하지 않고 서버 API(contracts/openapi.yaml)를 호출하므로 js 타깃은 쓰지 않는다
 * (코디네이터 결정 2026-11-12). android·ios는 해당 단계에서 아래 자리에 추가한다.
 * commonMain은 플랫폼 API(java.*, DOM, 파일 I/O)에 의존하지 않는다 -> checkCommonMainPurity가 검사한다.
 * (주의: KDoc 안에 '슬래시+별표'를 쓰면 중첩 주석이 열려 plugins 블록이 주석 안으로 들어간다.)
 */
plugins {
    id("banbanyeok.quality")
    id("org.jetbrains.kotlin.multiplatform")
}

kotlin {
    compilerOptions { allWarningsAsErrors.set(true) }
    explicitApi()
    jvmToolchain(25) // 이유는 mise.toml 참고. 빌드·테스트는 JDK 25에서 돈다.

    jvm {
        // 라이브러리 바이트코드는 17로 낮춰 둔다: A1 단계 Android(JDK 17)가 같은 모듈을 소비할 수 있게.
        compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
    }

    // ---- 후속 단계에서 추가할 타깃 (지금은 켜지 마라: AGP·macOS 러너가 필요) ----
    // A1: Android. libs.versions.toml에 AGP를 추가하고 settings의 repositories에 google()을 넣은 뒤
    //       plugins { id("com.android.kotlin.multiplatform.library") } 와
    //       kotlin { androidLibrary { namespace = "app.banbanyeok.<module>"; compileSdk = 36; minSdk = 26 } }
    // I1: iOS.
    //       listOf(iosArm64(), iosSimulatorArm64()).forEach { it.binaries.framework { baseName = "Shared" } }
    //     (direct integration으로 Xcode에서 링크. macOS 러너 필요)

    sourceSets {
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

tasks.withType<Test>().configureEach { useJUnitPlatform() }

val checkCommonMainPurity =
    tasks.register<CommonMainPurityTask>("checkCommonMainPurity") {
        sources.from(layout.projectDirectory.dir("src/commonMain"))
    }
tasks.named("check") { dependsOn(checkCommonMainPurity) }

val testLibs = extensions.getByType<VersionCatalogsExtension>().named("libs")
kotlin.sourceSets.named("commonTest") {
    dependencies {
        implementation(testLibs.findLibrary("kotest-assertions").get())
        implementation(testLibs.findLibrary("kotest-property").get())
        implementation(testLibs.findLibrary("kotlinx-coroutines-test").get())
    }
}
