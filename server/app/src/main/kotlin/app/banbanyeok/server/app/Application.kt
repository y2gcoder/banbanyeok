package app.banbanyeok.server.app

import app.banbanyeok.server.app.config.AppConfig
import app.banbanyeok.server.app.http.ApiServices
import app.banbanyeok.server.app.http.IdempotencyCache
import app.banbanyeok.server.app.http.RateLimiting
import app.banbanyeok.server.app.http.apiRoutes
import app.banbanyeok.server.app.http.installCommonPlugins
import app.banbanyeok.server.app.http.installErrorHandling
import io.ktor.server.application.Application
import io.ktor.server.routing.routing
import java.time.Clock

/** Ktor 모듈: 플러그인과 라우트를 설치한다. 서비스는 이미 조립된 상태로 받는다(테스트는 가짜 서비스를 넣는다). */
fun Application.apiModule(
    config: AppConfig,
    services: ApiServices,
    clock: Clock = Clock.systemUTC(),
) {
    installErrorHandling()
    installCommonPlugins(config, RateLimiting(config.rateLimit, clock))
    routing { apiRoutes(services, IdempotencyCache(clock)) }
}
