package app.banbanyeok.architecture

import com.lemonappdev.konsist.api.Konsist
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldBeEmpty
import java.io.File

/** 디렉터리 아래 소스 파일을 [SourceUnit]으로. 규칙은 import뿐 아니라 완전 수식 이름·별칭까지 같은 방식으로 읽는다. */
private fun sources(dir: String): List<SourceUnit> = Konsist.scopeFromDirectory(dir).files.map { it.source() }

/** 금지된 참조를 "파일 -> 참조"로 모은다. 비어야 통과다. */
private fun List<SourceUnit>.referencesMatching(
    all: Boolean = true,
    forbidden: (String) -> Boolean,
): List<String> =
    flatMap { unit ->
        (if (all) unit.allReferences else unit.references).filter(forbidden).map { "${unit.relativePath} -> $it" }
    }

/** 참조의 패키지(처음 나오는 대문자 이름 앞까지). */
private fun packageOf(reference: String): String =
    reference.split('.').takeWhile { it.firstOrNull()?.isUpperCase() != true }.joinToString(".")

class ArchitectureTest :
    DescribeSpec({
        describe("module boundaries") {
            it("shared sources do not import platform, persistence or server APIs") {
                sources("shared")
                    .filter { it.relativePath.contains("Main/") }
                    .referencesMatching {
                        listOf("java.", "javax.", "io.ktor.", "org.jetbrains.exposed.", "kotlin.io.", "kotlinx.io.")
                            .any { prefix -> it.startsWith(prefix) }
                    }.shouldBeEmpty()
            }
            it("pipeline only depends on schema, core and app-logic among shared modules") {
                val dependencies =
                    Regex("""project\("(:shared:[^"]+)"\)""")
                        .findAll(File("pipeline/build.gradle.kts").readText())
                        .map { it.groupValues[1] }
                        .toList()
                sources("pipeline/src")
                    .referencesMatching { reference ->
                        reference.startsWith("app.banbanyeok.") &&
                            listOf(
                                "app.banbanyeok.pipeline.",
                                "app.banbanyeok.schema.",
                                "app.banbanyeok.core.",
                                "app.banbanyeok.applogic.",
                            ).none { prefix -> reference.startsWith(prefix) }
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
                        sources("server/${module.name}/src")
                            .referencesMatching { imported ->
                                features.any { other ->
                                    other != module && imported.startsWith("app.banbanyeok.server.${other.name}.")
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
                listOf("room", "recommendation", "artifact")
                    .flatMap { module -> sources("server/$module/src/main") }
                    .referencesMatching { it.startsWith("app.banbanyeok.server.app.") || it.startsWith("io.ktor.") }
                    .shouldBeEmpty()
            }
            it("only the room exposed package knows Exposed and only the GCS store knows the GCS client") {
                val serverMain = sources("server").filter { it.relativePath.contains("/src/main/") }
                serverMain
                    .filterNot {
                        it.relativePath.startsWith("server/room/src/main/") &&
                            it.relativePath.contains("/exposed/")
                    }.referencesMatching { it.startsWith("org.jetbrains.exposed.") }
                    .shouldBeEmpty()
                serverMain
                    .filterNot { it.relativePath == GCS_STORE }
                    .referencesMatching { it.startsWith("com.google.cloud.") }
                    .shouldBeEmpty()
            }
            it("server services and application classes do not know Ktor") {
                sources(APPLICATION).referencesMatching { it.startsWith("io.ktor.") }.shouldBeEmpty()
            }
            it("feature main code and app application code never downcast a port to its implementation") {
                // 포트로 받은 값을 구현 클래스로 바꾸면 테스트가 다른 구현을 끼웠을 때 그 동작(예: 구분 행렬 기다림)이 조용히 사라진다.
                val implementation = Regex("""(Background|Od|Exposed|Gcs|LocalFile)\w+""")
                (FEATURES.flatMap { sources("server/$it/src/main") } + sources(APPLICATION))
                    .flatMap { unit ->
                        unit.castTargets
                            .filter { implementation.matches(it.substringAfterLast('.')) }
                            .map { "${unit.relativePath} -> as $it" }
                    }.shouldBeEmpty()
            }
            it("server tests use the real database instead of H2 or an Exposed mock") {
                sources("server")
                    .referencesMatching {
                        it.startsWith("org.h2.") || (it.contains("exposed") && it.startsWith("io.mockk"))
                    }.shouldBeEmpty()
            }
        }

        describe("recommendation module structure (#88)") {
            val main = sources("server/recommendation/src/main")

            fun subPackageOf(unit: SourceUnit): String? =
                RECOMMENDATION_SUBPACKAGES.firstOrNull { unit.relativePath.contains("/server/recommendation/$it/") }

            it("concept sub-packages are leaves: they never import the root package (only the root composes them)") {
                main
                    .filter { subPackageOf(it) != null }
                    .referencesMatching { packageOf(it) == RECOMMENDATION }
                    .shouldBeEmpty()
            }
            it("concept sub-packages do not import each other, except the shared time package") {
                main
                    .mapNotNull { unit -> subPackageOf(unit)?.let { unit to it } }
                    .flatMap { (unit, own) ->
                        listOf(unit).referencesMatching { name ->
                            RECOMMENDATION_SUBPACKAGES.any { other ->
                                other != own && other != "time" && name.startsWith("$RECOMMENDATION.$other.")
                            }
                        }
                    }.shouldBeEmpty()
            }

            val appMain = sources("server/app/src/main")

            it("the app uses only the listed recommendation surface (grow it on purpose, not by accident)") {
                appMain
                    .flatMap { it.references }
                    .filter { it.startsWith("$RECOMMENDATION.") }
                    .map { it.removePrefix("$RECOMMENDATION.") }
                    .toSet()
                    .minus(RECOMMENDATION_APP_SURFACE)
                    .shouldBeEmpty()
            }
            it("the app never measures travel times itself: one evaluate() per request reads the matrix once") {
                appMain
                    .filter { Regex("""\.\s*measure\s*\(""").containsMatchIn(it.code) }
                    .map { it.relativePath }
                    .shouldBeEmpty()
            }
        }

        describe("server app structure (#89)") {
            val appMain = sources("server/app/src/main")
            val http = sources("$APP_MAIN/http")
            val application = sources(APPLICATION)

            it("the HTTP package knows the narrow station ports, not StationDirectory or the Background adapters") {
                http
                    .referencesMatching {
                        it.isOrUnder("$APP.application.StationDirectory") ||
                            it.startsWith("$APP.application.Background")
                    }.shouldBeEmpty()
            }
            it(
                "the HTTP package goes through use cases: it never calls the recommendation service or builds its requests",
            ) {
                http
                    .referencesMatching { reference -> HTTP_FORBIDDEN_RECOMMENDATION.any { reference.isOrUnder(it) } }
                    .shouldBeEmpty()
            }
            it("application code does not know the HTTP package") {
                application.referencesMatching { it.startsWith("$APP.http.") }.shouldBeEmpty()
            }
            it("RecommendationError is translated to response codes in one place, http/Errors.kt") {
                appMain
                    .filterNot { it.relativePath == ERRORS_FILE }
                    .referencesMatching { it.isOrUnder("$RECOMMENDATION.RecommendationError") }
                    .shouldBeEmpty()
            }
            it("policies and adapters are created only at the composition root (Components.kt)") {
                appMain
                    .filterNot { it.relativePath == COMPONENTS_FILE }
                    .flatMap { unit ->
                        unit.calls.filter(::createsPolicyOrAdapter).map { "${unit.relativePath} -> $it(...)" }
                    }.shouldBeEmpty()
            }
        }
    })

private const val GCS_STORE = "server/artifact/src/main/kotlin/app/banbanyeok/server/artifact/GcsArtifactStore.kt"

/** 호출 식이 정책(구분 규칙·공휴일 목록)이나 어댑터(Exposed 저장소·산출물 저장소)를 만드는가. 수신 체인은 import 별칭까지 푼 이름이다. */
private fun createsPolicyOrAdapter(call: String): Boolean {
    val simple = call.substringAfterLast('.')
    return call == "$RECOMMENDATION.time.TimeSlotResolver" ||
        call == "$RECOMMENDATION.time.HolidayCalendar.bundled" ||
        (call.startsWith("app.banbanyeok.server.room.exposed.") && Regex("""Exposed\w+Repository""").matches(simple)) ||
        (call.startsWith("app.banbanyeok.server.artifact.") && Regex("""\w+ArtifactStore""").matches(simple))
}

private const val APP = "app.banbanyeok.server.app"

private const val APP_MAIN = "server/app/src/main/kotlin/app/banbanyeok/server/app"

private const val APPLICATION = "$APP_MAIN/application"

/** 저장소 기준 전체 경로. 예외 파일은 끝부분이 아니라 이 경로 전체로 비교한다. */
private const val COMPONENTS_FILE = "$APP_MAIN/Components.kt"

private const val ERRORS_FILE = "$APP_MAIN/http/Errors.kt"

/** http 패키지가 부르면 안 되는 추천 진입점과 요청 조립 타입. 추천 규칙(요청 만들기, 구분 결정)은 유스케이스와 RoomResultService가 한다. */
private val HTTP_FORBIDDEN_RECOMMENDATION =
    setOf(
        "$RECOMMENDATION.RecommendationService",
        "$RECOMMENDATION.RecommendRequest",
        "$RECOMMENDATION.RecommendParticipant",
        "$RECOMMENDATION.time.DayCertainty",
        "$RECOMMENDATION.time.HolidayCalendar",
    )

private val FEATURES = listOf("room", "recommendation", "artifact")

private const val RECOMMENDATION = "app.banbanyeok.server.recommendation"

/** recommendation 모듈 안의 개념 하위 패키지. 루트(RecommendationService·Evaluation·요청/응답 모델·포트)만 이들을 조합한다. */
private val RECOMMENDATION_SUBPACKAGES = listOf("time", "lasttrain", "mapmiddle", "route")

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
        // 사람별 경로(#120): app이 구현하는 그래프 포트와 응답
        "route.RouteSource",
        "route.ParticipantRoute",
        "route.RouteStop",
        // 약속 시각 → 구분
        "time.TimeBasis",
        "time.DayCertainty",
        "time.TimeSlotResolver",
        "time.HolidayCalendar",
    )
