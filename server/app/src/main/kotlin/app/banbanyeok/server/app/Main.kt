package app.banbanyeok.server.app

import app.banbanyeok.server.app.config.AppConfig
import app.banbanyeok.server.app.config.ConfigException
import app.banbanyeok.server.app.ops.Seeder
import app.banbanyeok.server.artifact.ArtifactLoadException
import io.ktor.server.application.ApplicationStarted
import io.ktor.server.application.ApplicationStopped
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import kotlinx.coroutines.runBlocking
import org.slf4j.LoggerFactory
import java.util.concurrent.CompletableFuture
import kotlin.concurrent.thread
import kotlin.system.exitProcess

private val logger by lazy { LoggerFactory.getLogger("main") }

private const val USAGE = "usage: server [serve|cleanup|seed]"

/**
 * 진입점. 하위 명령: `serve`(기본, HTTP 서버), `cleanup`(만료된 방 정리), `seed`(로컬 예시 방).
 * 설정이 잘못되었거나 산출물 검증에 실패하면 시작하지 않는다.
 */
fun main(args: Array<String>) {
    val timeline = StartupTimeline(System.currentTimeMillis())
    val command = args.firstOrNull() ?: "serve"
    if (command !in setOf("serve", "cleanup", "seed")) fail("알 수 없는 명령: $command\n$USAGE")
    val config =
        try {
            AppConfig.load()
        } catch (e: ConfigException) {
            fail(e.message.orEmpty())
        }
    // 산출물 읽기(GCS 토큰·TLS·왕복, 로거를 쓰지 않음)를 별도 스레드에서 바로 시작하고, 그동안 이 스레드는 로깅 초기화를 한다
    // (콜드스타트 단축: 두 일이 겹친다). 로거를 쓰는 DB 풀 준비는 로깅이 준비된 뒤에 한다(SLF4J 초기화 경합 방지). 결과는 아래에서 기다린다.
    val assembly = startAssembly(config, timeline)
    logger.info("시작 중: 명령 {}", command) // 로깅 초기화를 여기서 한다(시작 작업과 겹친다)
    timeline.markLoggingReady() // 조립 스레드는 이것을 기다린 뒤에야 로거를 쓰는 일을 한다
    val components = awaitAssembly(assembly, timeline)
    timeline.flush()
    when (command) {
        "serve" -> serve(components, timeline)
        "cleanup" -> components.use { runBlocking { println("cleanup: ${it.cleanup.run()}") } }
        else -> components.use { runBlocking { Seeder(it).run() } }
    }
}

private fun startAssembly(
    config: AppConfig,
    timeline: StartupTimeline,
): CompletableFuture<Result<Components>> {
    val future = CompletableFuture<Result<Components>>()
    thread(name = "assemble") {
        future.complete(runCatching { runBlocking { CompositionRoot.create(config, timeline = timeline) } })
    }
    return future
}

private fun awaitAssembly(
    assembly: CompletableFuture<Result<Components>>,
    timeline: StartupTimeline,
): Components =
    assembly.get().getOrElse { e ->
        timeline.flush() // 시작 실패 때도 어디까지 갔는지 단계 시간을 남긴다
        if (e is ArtifactLoadException) fail("산출물을 불러오지 못해 시작하지 않습니다: ${e.message}") else throw e
    }

private fun serve(
    components: Components,
    timeline: StartupTimeline,
) {
    val config = components.config
    logger.info("서버 시작: {}", config)
    val server =
        embeddedServer(Netty, port = config.port, host = "0.0.0.0") {
            apiModule(config, components.services, components.clock)
            startAfterFirstResponse(components.startBackground)
            monitor.subscribe(ApplicationStopped) { components.close() }
            monitor.subscribe(ApplicationStarted) { timeline.mark("ktor-started") }
        }
    server.start(wait = true)
}

private fun fail(message: String): Nothing {
    System.err.println(message)
    exitProcess(1)
}
