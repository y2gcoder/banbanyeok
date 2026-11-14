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
     * @param store 테스트가 저장소를 바꿔 끼울 때만 넘긴다. 없으면 설정이 고른다(로컬 파일 또는 GCS).
     * @param database 테스트가 이미 만든 DB를 넘길 때만 쓴다. 없으면 설정으로 연결하고 [Components.close]가 닫는다.
     */
    suspend fun create(
        config: AppConfig,
        clock: Clock = Clock.systemUTC(),
        store: ArtifactStore = artifactStore(config),
        database: ConnectedDatabase? = null,
    ): Components {
        val loaded = ArtifactLoader(store).load()
        val directory = StationDirectory(loaded.dataSet)
        val owned = if (database == null) DatabaseFactory.connect(config.database) else null
        val db = (database ?: requireNotNull(owned)).database

        val ids = SecureRandomIdGenerator()
        val tokens = TokenService(config.tokenPepper.toByteArray(Charsets.UTF_8), ids)
        val roomRepository = ExposedRoomRepository(db)
        val anonRepository = ExposedAnonUserRepository(db)
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
        return Components(config, clock, services, RoomCleanup(roomRepository, anonRepository, clock)) {
            owned?.close()
        }
    }

    private fun artifactStore(config: AppConfig): ArtifactStore =
        when (config.artifacts.kind) {
            ArtifactStoreKind.LOCAL -> LocalFileArtifactStore(Path.of(config.artifacts.localDir))
            ArtifactStoreKind.GCS ->
                GcsArtifactStore.withDefaultCredentials(
                    requireNotNull(config.artifacts.gcsBucket) { "GCS 버킷 이름이 없습니다" },
                    config.artifacts.gcsPrefix,
                )
        }
}
