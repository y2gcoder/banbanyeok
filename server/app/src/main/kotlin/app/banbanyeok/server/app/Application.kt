package app.banbanyeok.server.app

import app.banbanyeok.server.app.config.AppConfig
import app.banbanyeok.server.app.http.ApiServices
import app.banbanyeok.server.app.http.IdempotencyCache
import app.banbanyeok.server.app.http.RateLimiting
import app.banbanyeok.server.app.http.apiRoutes
import app.banbanyeok.server.app.http.installCommonPlugins
import app.banbanyeok.server.app.http.installErrorHandling
import io.ktor.http.ContentType
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCallPipeline
import io.ktor.server.application.call
import io.ktor.server.request.path
import io.ktor.server.response.respondText
import io.ktor.server.routing.routing
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
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

private val HEALTH_PATHS = setOf("/healthz", "/v1/healthz")

/**
 * 콜드스타트를 줄이는 모듈: 서버가 먼저 떠서 `/healthz`·`/v1/healthz`에 바로 답하고, 산출물 읽기·DB 풀 준비([assemble])는
 * 뒤에서 하는 동안 다른 요청은 준비가 끝날 때까지 기다린다(라우트는 준비가 끝난 뒤에 붙인다). 그래서
 * 웹이 입력 화면에서 미리 보내는 서버 깨우기 요청은 데이터 로딩을 기다리지 않는다.
 *
 * - 건강 확인은 라우팅을 거치지 않고 파이프라인 앞단에서 응답한다. 준비 중에는 라우트 트리를 만지는 요청이 없어서
 *   (다른 요청은 모두 여기서 대기) 라우트를 나중에 붙여도 동시 수정 문제가 없다.
 * - [assemble]이 실패하면 대기 중이던 요청은 오류를 받고, 호출한 쪽(Main)이 프로세스를 종료한다.
 */
fun Application.warmStartModule(
    config: AppConfig,
    clock: Clock = Clock.systemUTC(),
    assemble: suspend () -> ApiServices,
) {
    installErrorHandling()
    installCommonPlugins(config, RateLimiting(config.rateLimit, clock))
    // 라우팅 플러그인은 요청을 받기 전에 설치해 둔다(나중에 설치하면 이미 대기 중인 요청의 파이프라인에는 빠진다). 라우트만 나중에 붙인다.
    routing { }
    val ready = CompletableDeferred<Unit>()
    intercept(ApplicationCallPipeline.Plugins) {
        if (call.request.path() in HEALTH_PATHS) {
            call.respondText("ok", ContentType.Text.Plain)
            finish()
        } else {
            ready.await()
        }
    }
    launch {
        runCatching { assemble() }
            .onSuccess { services ->
                routing { apiRoutes(services, IdempotencyCache(clock)) }
                ready.complete(Unit)
            }.onFailure { ready.completeExceptionally(it) }
    }
}
