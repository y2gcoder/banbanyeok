package app.banbanyeok.server.app

import app.banbanyeok.schema.DayType
import app.banbanyeok.server.app.application.BackgroundLastTrains
import app.banbanyeok.server.app.application.BackgroundRoutes
import app.banbanyeok.server.app.application.BackgroundSlots
import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.app.application.StatelessRecommendation
import app.banbanyeok.server.app.application.StationDirectory
import app.banbanyeok.server.app.config.AppConfig
import app.banbanyeok.server.app.config.ArtifactStoreKind
import app.banbanyeok.server.app.http.ApiServices
import app.banbanyeok.server.artifact.ArtifactLoader
import app.banbanyeok.server.artifact.ArtifactStore
import app.banbanyeok.server.artifact.GcsArtifactStore
import app.banbanyeok.server.artifact.LoadedArtifacts
import app.banbanyeok.server.artifact.LocalFileArtifactStore
import app.banbanyeok.server.artifact.PublishedArtifacts
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.recommendation.time.HolidayCalendar
import app.banbanyeok.server.recommendation.time.TimeSlotResolver
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
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import java.nio.file.Path
import java.time.Clock
import java.time.LocalDate

/**
 * 조립된 서버: 서비스 묶음과 정리용 자원. 인자 일곱 개는 조립 결과를 모아 둔 것이라 묶을 단위가 없다. LongParameterList는 끈다.
 */
@Suppress("LongParameterList")
class Components(
    val config: AppConfig,
    val clock: Clock,
    val services: ApiServices,
    /** 현재 산출물의 역 정보. 개발용 도구(Seeder)가 쓴다. 서비스는 이것을 좁은 포트로만 받는다. */
    val directory: StationDirectory,
    val cleanup: RoomCleanup,
    /**
     * 구분 행렬·막차 표·노선 그래프를 뒤에서 읽기 시작한다(여러 번 불러도 한 번만 시작한다). 조립은 이 일을 시작하지 않는다: 서버는 Ktor가 첫 응답을
     * 보낸 뒤에 부른다([startAfterFirstResponse]). 막차 표는 이때까지 `current()`가 null이라 막차 항목만 빠지고, 구분 행렬은 기다리는
     * 요청이 있으면 그 요청이 먼저 시작한다([BackgroundSlots.awaitReady]).
     */
    val startBackground: () -> Unit,
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
            // 구분 행렬·막차 표 검사는 LAZY로 두고 서버가 요청을 받기 시작한 뒤에 시작한다(CPU 1개에서 기동과 다투지 않게).
            val loading =
                async(ioDispatcher) {
                    ArtifactLoader(
                        store,
                        onPhase = { timeline?.mark(it) },
                        backgroundStart = CoroutineStart.LAZY,
                        regional = config.artifacts.regional,
                    ).load()
                }
            timeline?.awaitLoggingReady()
            val owned = if (database == null) DatabaseFactory.connect(config.database) else null
            owned?.warmUp { timeline?.mark("database-connection-warm") }
            val db = (database ?: requireNotNull(owned)).database
            timeline?.mark("database-pool-created")
            val loaded = loading.await()
            val slots = BackgroundSlots(loaded.slots)
            val directory = StationDirectory(loaded.dataSet, slots)

            val clock = Clock.systemUTC()
            val ids = SecureRandomIdGenerator()
            val tokens = TokenService(config.tokenPepper.toByteArray(Charsets.UTF_8), ids)
            val roomRepository = ExposedRoomRepository(db, ioDispatcher)
            val anonRepository = ExposedAnonUserRepository(db, ioDispatcher)
            val rooms = RoomService(roomRepository, anonRepository, tokens, ids, directory, clock)
            val recommendation = recommendationService(loaded, directory, slots, clock)
            // 약속 날짜·시각 → 구분 규칙은 한 번만 만들어 방 결과 계산과 방 응답이 함께 쓴다.
            val times = TimeSlotResolver(HolidayCalendar.bundled())
            val services =
                ApiServices(
                    anonUsers = AnonUserService(anonRepository, tokens, ids, clock),
                    rooms = rooms,
                    results = RoomResultService(rooms, recommendation, times),
                    stateless = StatelessRecommendation(recommendation, directory),
                    stations = directory,
                    published = PublishedArtifacts(store, loaded),
                    times = times,
                )
            timeline?.mark("services-assembled")
            Components(
                config,
                clock,
                services,
                directory,
                RoomCleanup(roomRepository, anonRepository, clock),
                startBackground = {
                    timeline?.mark("background-started")
                    loaded.startBackground()
                },
            ) {
                owned?.close()
            }
        }

    /** 추천 계산: 행렬·역 정보는 [directory], 구분 행렬·막차 표·노선 그래프는 뒤에서 읽는 [loaded]의 것을 쓴다. */
    private fun recommendationService(
        loaded: LoadedArtifacts,
        directory: StationDirectory,
        slots: BackgroundSlots,
        clock: Clock,
    ) = RecommendationService(
        directory.travel,
        directory,
        locations = directory,
        lastTrains = backgroundLastTrains(loaded),
        clock = clock,
        slotsReady = slots,
        routes = BackgroundRoutes(loaded.routeGraph),
    )

    /** 수집일은 manifest 검사에서 이미 실제 날짜로 확인했다. 그래도 읽지 못하면 서버는 뜨고 막차만 끈다. */
    private fun backgroundLastTrains(loaded: LoadedArtifacts): BackgroundLastTrains {
        val manifest = loaded.dataSet.manifest
        return BackgroundLastTrains(
            loaded.lastTrains,
            lastTrainAsOf(manifest.lastTrainAsOf),
            lastTrainPartialDays(manifest.lastTrainPartialDays),
        )
    }

    /** manifest의 `lastTrainPartialDays`. 모르는 id는 manifest 검사에서 이미 걸러졌다. */
    internal fun lastTrainPartialDays(ids: List<String>?): Set<DayType> =
        DayType.entries.filter { it.id in ids.orEmpty() }.toSet()

    /** manifest의 `lastTrainAsOf`. 없거나 날짜로 읽을 수 없으면 null(막차 항목 없이 응답한다). */
    internal fun lastTrainAsOf(text: String?): LocalDate? =
        text?.let {
            try {
                LocalDate.parse(it)
            } catch (_: java.time.format.DateTimeParseException) {
                null
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
