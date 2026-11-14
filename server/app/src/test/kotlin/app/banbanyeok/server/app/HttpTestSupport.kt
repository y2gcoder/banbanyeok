package app.banbanyeok.server.app

import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.app.application.StationDirectory
import app.banbanyeok.server.app.config.AppConfig
import app.banbanyeok.server.app.http.ApiServices
import app.banbanyeok.server.artifact.ArtifactLoader
import app.banbanyeok.server.artifact.LocalFileArtifactStore
import app.banbanyeok.server.artifact.PublishedArtifacts
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.room.AnonUserService
import app.banbanyeok.server.room.RoomService
import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import java.nio.file.Path
import java.time.Clock

/** data/artifacts/dev의 실제 산출물. 읽기 전용이라 모든 테스트가 한 번만 읽어 공유한다. */
object DevArtifacts {
    val dir: Path = Path.of(requireNotNull(System.getProperty("artifacts.dev.dir")))
    val store = LocalFileArtifactStore(dir)
    private val loaded by lazy { runBlocking { ArtifactLoader(store).load() } }
    val directory: StationDirectory by lazy { StationDirectory(loaded.dataSet) }
    val published: PublishedArtifacts by lazy { PublishedArtifacts(store, loaded) }
    val origins: List<String> get() = directory.originCodes
}

/** HTTP 계층 테스트용: 서비스는 MockK로 대체하고 라우트·오류 형식·인증 헤더·플러그인만 실제로 돌린다. */
class MockedServices {
    val anon = mockk<AnonUserService>()
    val rooms = mockk<RoomService>()
    val results = mockk<RoomResultService>()
    val recommendation = mockk<RecommendationService>()

    fun api() = ApiServices(anon, rooms, results, recommendation, DevArtifacts.directory, DevArtifacts.published)
}

fun testConfig(env: Map<String, String> = emptyMap()): AppConfig = AppConfig.load(env)

fun withMockedApi(
    config: AppConfig = testConfig(),
    clock: Clock = Clock.systemUTC(),
    block: suspend ApplicationTestBuilder.(MockedServices) -> Unit,
) {
    val services = MockedServices()
    testApplication {
        application { apiModule(config, services.api(), clock) }
        block(services)
    }
}

suspend fun HttpClient.json(
    method: HttpMethod,
    path: String,
    body: String? = null,
    token: String? = null,
    configure: HttpRequestBuilder.() -> Unit = {},
): HttpResponse =
    request(path) {
        this.method = method
        token?.let { header(HttpHeaders.Authorization, "Bearer $it") }
        if (body != null) {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        configure()
    }

private fun HttpRequestBuilder.header(
    name: String,
    value: String,
) = headers.append(name, value)
