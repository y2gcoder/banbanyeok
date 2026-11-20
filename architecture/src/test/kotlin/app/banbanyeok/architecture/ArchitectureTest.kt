package app.banbanyeok.architecture

import com.lemonappdev.konsist.api.Konsist
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldBeEmpty
import java.io.File

class ArchitectureTest :
    DescribeSpec({
        describe("module boundaries") {
            it("shared sources do not import platform, persistence or server APIs") {
                Konsist
                    .scopeFromDirectory("shared")
                    .files
                    .filter { it.path.contains("Main/") }
                    .flatMap { it.imports }
                    .filter {
                        listOf("java.", "javax.", "io.ktor.", "org.jetbrains.exposed.", "kotlin.io.", "kotlinx.io.")
                            .any { prefix -> it.name.startsWith(prefix) }
                    }.shouldBeEmpty()
            }
            it("pipeline only depends on schema, core and app-logic among shared modules") {
                val dependencies =
                    Regex("""project\("(:shared:[^"]+)"\)""")
                        .findAll(File("pipeline/build.gradle.kts").readText())
                        .map { it.groupValues[1] }
                        .toList()
                Konsist
                    .scopeFromDirectory("pipeline/src")
                    .files
                    .flatMap { it.imports }
                    .filter { it.name.startsWith("app.banbanyeok.") }
                    .filterNot {
                        listOf(
                            "app.banbanyeok.pipeline.",
                            "app.banbanyeok.schema.",
                            "app.banbanyeok.core.",
                            "app.banbanyeok.applogic.",
                        ).any { prefix -> it.name.startsWith(prefix) }
                    }.shouldBeEmpty()
                dependencies
                    .filterNot {
                        it in
                            setOf(
                                ":shared:schema",
                                ":shared:core",
                                ":shared:app-logic",
                            )
                    }.shouldBeEmpty()
            }
            it("server feature modules do not depend on each other") {
                val features =
                    File("server")
                        .listFiles()
                        .orEmpty()
                        .filter { it.isDirectory && it.name !in setOf("app", "src", "build", "db") }
                features
                    .filter { File(it, "src").exists() }
                    .flatMap { module ->
                        Konsist
                            .scopeFromDirectory("server/${module.name}/src")
                            .files
                            .flatMap { it.imports }
                            .filter { imported ->
                                features.any { other ->
                                    other != module && imported.name.startsWith("app.banbanyeok.server.${other.name}.")
                                }
                            }
                    }.shouldBeEmpty()
                features
                    .flatMap { module ->
                        val build = File(module, "build.gradle.kts")
                        features.filter { other ->
                            other != module && build.exists() && build.readText().contains(":server:${other.name}")
                        }
                    }.shouldBeEmpty()
            }
            it("server feature modules do not depend on the app module or know the HTTP framework") {
                val featureImports =
                    listOf("room", "recommendation", "artifact").flatMap { module ->
                        Konsist
                            .scopeFromDirectory("server/$module/src/main")
                            .files
                            .flatMap { it.imports }
                    }
                featureImports
                    .filter { it.name.startsWith("app.banbanyeok.server.app.") || it.name.startsWith("io.ktor.") }
                    .shouldBeEmpty()
            }
            it("only the room exposed package knows Exposed and only the GCS store knows the GCS client") {
                val serverMain = Konsist.scopeFromDirectory("server").files.filter { it.path.contains("/src/main/") }
                serverMain
                    .filterNot { it.path.contains("/server/room/src/main/") && it.path.contains("/exposed/") }
                    .flatMap { it.imports }
                    .filter { it.name.startsWith("org.jetbrains.exposed.") }
                    .shouldBeEmpty()
                serverMain
                    .filterNot { it.path.endsWith("/GcsArtifactStore.kt") }
                    .flatMap { it.imports }
                    .filter { it.name.startsWith("com.google.cloud.") }
                    .shouldBeEmpty()
            }
            it("server services and application classes do not know Ktor") {
                Konsist
                    .scopeFromDirectory("server/app/src/main/kotlin/app/banbanyeok/server/app/application")
                    .files
                    .flatMap { it.imports }
                    .filter { it.name.startsWith("io.ktor.") }
                    .shouldBeEmpty()
            }
            it("feature main code and app application code never downcast a port to its implementation") {
                // 포트로 받은 값을 구현 클래스로 바꾸면 테스트가 다른 구현을 끼웠을 때 그 동작(예: 구분 행렬 기다림)이 조용히 사라진다.
                val downcast = Regex("""\bas\??\s+(Background|Od|Exposed|Gcs|LocalFile)\w+""")
                (
                    FEATURES.map { "server/$it/src/main" } +
                        "server/app/src/main/kotlin/app/banbanyeok/server/app/application"
                ).flatMap { Konsist.scopeFromDirectory(it).files }
                    .filter { downcast.containsMatchIn(it.text) }
                    .map { it.path }
                    .shouldBeEmpty()
            }
            it("server tests use the real database instead of H2 or an Exposed mock") {
                Konsist
                    .scopeFromDirectory("server")
                    .files
                    .flatMap { it.imports }
                    .filter {
                        it.name.startsWith("org.h2.") ||
                            (it.name.contains("exposed") && it.name.startsWith("io.mockk"))
                    }.shouldBeEmpty()
            }
        }

        describe("recommendation module structure (#88)") {
            val main = Konsist.scopeFromDirectory("server/recommendation/src/main").files

            fun subPackageOf(path: String): String? =
                RECOMMENDATION_SUBPACKAGES.firstOrNull { path.contains("/server/recommendation/$it/") }

            it("concept sub-packages are leaves: they never import the root package (only the root composes them)") {
                main
                    .filter { subPackageOf(it.path) != null }
                    .flatMap { file -> file.imports.map { file.path to it.name } }
                    .filter { (_, name) -> name.substringBeforeLast('.') == RECOMMENDATION }
                    .shouldBeEmpty()
            }
            it("concept sub-packages do not import each other, except the shared time package") {
                main
                    .mapNotNull { file -> subPackageOf(file.path)?.let { file to it } }
                    .flatMap { (file, own) ->
                        file.imports
                            .map { it.name }
                            .filter { name ->
                                RECOMMENDATION_SUBPACKAGES.any { other ->
                                    other != own && other != "time" && name.startsWith("$RECOMMENDATION.$other.")
                                }
                            }.map { file.path to it }
                    }.shouldBeEmpty()
            }

            val appMain = Konsist.scopeFromDirectory("server/app/src/main").files

            it("the app uses only the listed recommendation surface (grow it on purpose, not by accident)") {
                appMain
                    .flatMap { it.imports }
                    .map { it.name }
                    .filter { it.startsWith("$RECOMMENDATION.") }
                    .map { it.removePrefix("$RECOMMENDATION.") }
                    .toSet()
                    .minus(RECOMMENDATION_APP_SURFACE)
                    .shouldBeEmpty()
            }
            it("the app never measures travel times itself: one evaluate() per request reads the matrix once") {
                appMain
                    .filter { Regex("""\.measure\(""").containsMatchIn(it.text) }
                    .map { it.path }
                    .shouldBeEmpty()
            }
        }
    })

private val FEATURES = listOf("room", "recommendation", "artifact")

private const val RECOMMENDATION = "app.banbanyeok.server.recommendation"

/** recommendation 모듈 안의 개념 하위 패키지. 루트(RecommendationService·Evaluation·요청/응답 모델·포트)만 이들을 조합한다. */
private val RECOMMENDATION_SUBPACKAGES = listOf("time", "lasttrain", "mapmiddle")

/**
 * app(server/app/src/main)이 import해도 되는 recommendation 선언(루트 기준 이름). 늘릴 때는 이 목록을 함께 고친다(아키텍처 지표
 * `server_feature_surface`가 2주마다 같은 수를 잰다).
 */
private val RECOMMENDATION_APP_SURFACE =
    setOf(
        // 진입점과 요청·응답
        "RecommendationService",
        "RecommendRequest",
        "RecommendParticipant",
        "RecommendMode",
        "Recommendation",
        "RecommendedStation",
        "ParticipantTime",
        "MapMiddle",
        "RecommendationError",
        "RecommendationException",
        // app이 구현하거나 조립하는 포트
        "TravelTimeProvider",
        "OdTravelTimeProvider",
        "StationNames",
        "SlotMatrices",
        "SlotReadiness",
        "mapmiddle.StationLocations",
        "mapmiddle.GeoPoint",
        "lasttrain.LastTrainSource",
        "lasttrain.LastTrainData",
        // 막차 응답
        "lasttrain.LastTrainBasis",
        "lasttrain.ParticipantLastTrain",
        // 약속 시각 → 구분
        "time.TimeBasis",
        "time.DayCertainty",
        "time.TimeSlotResolver",
        "time.HolidayCalendar",
    )
