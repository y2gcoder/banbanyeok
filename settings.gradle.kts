// 이후 작업자가 이 파일을 고치지 않도록 모든 모듈을 미리 포함한다. 모듈 빌드 파일만 채운다.
pluginManagement {
    includeBuild("build-logic")
    repositories {
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        // Android 타깃을 켤 때(A1) google()을 여기에 추가한다. 예: google { content { ... } }
    }
}

rootProject.name = "banbanyeok"

// KMP 공유 모듈 (타깃: jvm만. android/ios는 해당 단계에서 build-logic의 kmp-library 플러그인에 추가)
include(
    ":shared:schema",
    ":shared:core",
    ":shared:links",
    ":shared:api-client",
    ":shared:app-logic",
    ":shared:analytics",
)

// JVM 앱: server(프레임워크 미정, 자리표시), pipeline(Kotlin CLI)
include(":server", ":pipeline")

// 후속 단계에서 활성화:
//   include(":android:app")   // A1. android/ 디렉토리와 함께 추가
