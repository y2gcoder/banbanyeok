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
    // 산출물 읽기·DB 풀 준비(GCS 클라이언트·인증·네트워크 왕복)를 별도 스레드에서 바로 시작하고, 그동안 이 스레드는 로깅 초기화를 한다
    // (콜드스타트 단축: 두 일이 겹친다). 결과는 아래에서 기다린다.
    val assembly = startAssembly(config, timeline)
    timeline.mark("main")
    val components = awaitAssembly(assembly)
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
        timeline.mark("assembly-thread-started")
        future.complete(runCatching { runBlocking { CompositionRoot.create(config, timeline = timeline) } })
    }
    return future
}

private fun awaitAssembly(assembly: CompletableFuture<Result<Components>>): Components =
    assembly.get().getOrElse { e ->
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
            monitor.subscribe(ApplicationStopped) { components.close() }
            monitor.subscribe(ApplicationStarted) { timeline.mark("ktor-started") }
        }
    server.start(wait = true)
}

private fun fail(message: String): Nothing {
    System.err.println(message)
    exitProcess(1)
}
