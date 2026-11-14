package app.banbanyeok.server.app

import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.app.application.StationDirectory
import app.banbanyeok.server.app.config.AppConfig
import app.banbanyeok.server.app.config.ArtifactStoreKind
import app.banbanyeok.server.app.http.ApiServices
import app.banbanyeok.server.artifact.ArtifactLoader
import app.banbanyeok.server.artifact.ArtifactStore
import app.banbanyeok.server.artifact.GcsArtifactStore
import app.banbanyeok.server.artifact.LocalFileArtifactStore
import app.banbanyeok.server.artifact.PublishedArtifacts
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.room.AnonUserService
import app.banbanyeok.server.room.RoomCleanup
import app.banbanyeok.server.room.RoomService
import app.banbanyeok.server.room.SecureRandomIdGenerator
import app.banbanyeok.server.room.TokenService
import app.banbanyeok.server.room.exposed.ConnectedDatabase
import app.banbanyeok.server.room.exposed.DatabaseFactory
import app.banbanyeok.server.room.exposed.ExposedAnonUserRepository
import app.banbanyeok.server.room.exposed.ExposedRoomRepository
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.nio.file.Path
import java.time.Clock

/** 조립된 서버: 서비스 묶음과 정리용 자원. */
class Components(
    val config: AppConfig,
    val clock: Clock,
    val services: ApiServices,
    val cleanup: RoomCleanup,
    private val closeResources: () -> Unit,
) : AutoCloseable {
    override fun close() = closeResources()
}

/**
 * 조립 지점(composition root): DI 프레임워크 없이 생성자 주입으로 직접 엮는다. 서비스는 Ktor를 모르는 일반 클래스이고
 * 포트(저장소, 시계, ID 생성기)의 구현은 여기서만 고른다. 시작할 때 manifest가 가리키는 산출물을 읽어 검증하고,
 * 실패하면 예외로 기동을 멈춘다.
 */
object CompositionRoot {
    /**
     * 시계는 항상 UTC 시스템 시계다(서비스 단위 테스트가 가짜 시계를 쓴다).
     * @param store 테스트가 저장소를 바꿔 끼울 때만 넘긴다. 없으면 설정이 고른다(로컬 파일 또는 GCS).
     * @param database 테스트가 이미 만든 DB를 넘길 때만 쓴다. 없으면 설정으로 연결하고 [Components.close]가 닫는다.
     */
    suspend fun create(
        config: AppConfig,
        ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
        timeline: StartupTimeline? = null,
        store: ArtifactStore =
            artifactStore(config, ioDispatcher, timeline).also { timeline?.mark("artifact-store-created") },
        database: ConnectedDatabase? = null,
    ): Components =
        coroutineScope {
            timeline?.mark("assembly-started")
            // 산출물 읽기는 IO 스레드에서 바로 시작한다(로거를 쓰지 않는다). DB 풀(Hikari는 로거를 쓴다)은 로깅 초기화가 끝난 뒤에 만들고
            // 첫 연결을 뒤에서 맺기 시작한다. 둘은 겹쳐서 돈다.
            val loading = async(ioDispatcher) { ArtifactLoader(store) { timeline?.mark(it) }.load() }
            timeline?.awaitLoggingReady()
            val owned = if (database == null) DatabaseFactory.connect(config.database) else null
            owned?.warmUp { timeline?.mark("database-connection-warm") }
            val db = (database ?: requireNotNull(owned)).database
            timeline?.mark("database-pool-created")
            val loaded = loading.await()
            val directory = StationDirectory(loaded.dataSet)

            val clock = Clock.systemUTC()
            val ids = SecureRandomIdGenerator()
            val tokens = TokenService(config.tokenPepper.toByteArray(Charsets.UTF_8), ids)
            val roomRepository = ExposedRoomRepository(db, ioDispatcher)
            val anonRepository = ExposedAnonUserRepository(db, ioDispatcher)
            val rooms = RoomService(roomRepository, anonRepository, tokens, ids, directory, clock)
            val recommendation = RecommendationService(directory.travel, directory)
            val services =
                ApiServices(
                    anonUsers = AnonUserService(anonRepository, tokens, ids, clock),
                    rooms = rooms,
                    results = RoomResultService(rooms, recommendation),
                    recommendation = recommendation,
                    directory = directory,
                    published = PublishedArtifacts(store, loaded),
                )
            timeline?.mark("services-assembled")
            Components(config, clock, services, RoomCleanup(roomRepository, anonRepository, clock)) {
                owned?.close()
            }
        }

    private fun artifactStore(
        config: AppConfig,
        ioDispatcher: CoroutineDispatcher,
        timeline: StartupTimeline?,
    ): ArtifactStore =
        when (config.artifacts.kind) {
            ArtifactStoreKind.LOCAL -> {
                LocalFileArtifactStore(Path.of(config.artifacts.localDir), ioDispatcher)
            }

            ArtifactStoreKind.GCS -> {
                GcsArtifactStore(
                    bucket = requireNotNull(config.artifacts.gcsBucket) { "GCS 버킷 이름이 없습니다" },
                    ioDispatcher = ioDispatcher,
                    prefix = config.artifacts.gcsPrefix,
                    endpoint = config.artifacts.gcsEndpoint,
                    onPhase = { timeline?.mark(it) },
                ).also { it.warmUp() }
            }
        }
}
