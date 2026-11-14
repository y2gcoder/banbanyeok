package app.banbanyeok.server.app

import app.banbanyeok.server.app.config.AppConfig
import app.banbanyeok.server.app.config.ConfigException
import app.banbanyeok.server.app.ops.Seeder
import app.banbanyeok.server.artifact.ArtifactLoadException
import io.ktor.server.application.ApplicationStopped
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import kotlinx.coroutines.runBlocking
import org.slf4j.LoggerFactory
import kotlin.system.exitProcess

private val logger = LoggerFactory.getLogger("main")

private const val USAGE = "usage: server [serve|cleanup|seed]"

/**
 * 진입점. 하위 명령: `serve`(기본, HTTP 서버), `cleanup`(만료된 방 정리), `seed`(로컬 예시 방).
 * 설정이 잘못되었거나 산출물 검증에 실패하면 시작하지 않는다.
 */
fun main(args: Array<String>) {
    val command = args.firstOrNull() ?: "serve"
    if (command !in setOf("serve", "cleanup", "seed")) fail("알 수 없는 명령: $command\n$USAGE")
    val config =
        try {
            AppConfig.load()
        } catch (e: ConfigException) {
            fail(e.message.orEmpty())
        }
    val components =
        try {
            runBlocking { CompositionRoot.create(config) }
        } catch (e: ArtifactLoadException) {
            fail("산출물을 불러오지 못해 시작하지 않습니다: ${e.message}")
        }
    when (command) {
        "serve" -> serve(components)
        "cleanup" -> components.use { runBlocking { println("cleanup: ${it.cleanup.run()}") } }
        else -> components.use { runBlocking { Seeder(it).run() } }
    }
}

private fun serve(components: Components) {
    val config = components.config
    logger.info("서버 시작: {}", config)
    val server =
        embeddedServer(Netty, port = config.port, host = "0.0.0.0") {
            apiModule(config, components.services, components.clock)
            monitor.subscribe(ApplicationStopped) { components.close() }
        }
    server.start(wait = true)
}

private fun fail(message: String): Nothing {
    System.err.println(message)
    exitProcess(1)
}
