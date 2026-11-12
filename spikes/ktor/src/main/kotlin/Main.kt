import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.routing.*
import io.ktor.server.response.*
import java.io.File

fun main() {
    val data = File(System.getenv("DATA_FILE") ?: "data/130k.bin").readBytes()
    embeddedServer(Netty, host = "0.0.0.0", port = (System.getenv("PORT") ?: "18080").toInt()) {
        routing {
            get("/healthz") { call.respondText("ok:${data.size}") }
            get("/v1/recommend") {
                val score = (0 until 1000).sumOf { data[it % data.size].toInt() and 255 }
                call.respondText("{\"stationId\":\"AAA\",\"score\":$score,\"bytes\":${data.size}}")
            }
        }
    }.start(wait = true)
}
