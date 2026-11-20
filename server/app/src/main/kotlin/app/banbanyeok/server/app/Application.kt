package app.banbanyeok.server.app

import app.banbanyeok.server.app.config.AppConfig
import app.banbanyeok.server.app.http.ApiServices
import app.banbanyeok.server.app.http.IdempotencyCache
import app.banbanyeok.server.app.http.RateLimiting
import app.banbanyeok.server.app.http.apiRoutes
import app.banbanyeok.server.app.http.installCommonPlugins
import app.banbanyeok.server.app.http.installErrorHandling
import io.ktor.server.application.Application
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.application.hooks.ResponseSent
import io.ktor.server.application.install
import io.ktor.server.routing.routing
import java.time.Clock
import java.util.concurrent.atomic.AtomicBoolean

/** Ktor 모듈: 플러그인과 라우트를 설치한다. 서비스는 이미 조립된 상태로 받는다(테스트는 가짜 서비스를 넣는다). */
fun Application.apiModule(
    config: AppConfig,
    services: ApiServices,
    clock: Clock = Clock.systemUTC(),
) {
    installErrorHandling()
    installCommonPlugins(config, RateLimiting(config.rateLimit, clock))
    routing { apiRoutes(services, IdempotencyCache(clock), anonEnabled = config.anonEnabled) }
}

/**
 * 첫 응답을 내보낸 직후 한 번만 [start]를 부른다. 서버가 요청을 받을 수 있게 된 뒤에 뒤에서 하는 일(구분 행렬·막차 표 검사)을
 * 시작하려는 것이다: 그 일이 첫 요청과 CPU를 다투지 않게, 첫 응답이 나간 다음에 시작한다.
 */
fun Application.startAfterFirstResponse(start: () -> Unit) {
    val started = AtomicBoolean(false)
    install(
        createApplicationPlugin("StartAfterFirstResponse") {
            on(ResponseSent) { if (started.compareAndSet(false, true)) start() }
        },
    )
}
