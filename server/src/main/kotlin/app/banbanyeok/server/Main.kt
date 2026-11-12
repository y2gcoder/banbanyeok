package app.banbanyeok.server

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress

/**
 * 프레임워크 없는 자리표시 서버. `/healthz`만 응답한다. 실제 API(contracts/openapi.yaml)는 프레임워크 결정 후 구현한다.
 * Cloud Run은 PORT 환경 변수로 포트를 알려 준다.
 */
fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
    val server = createServer(port)
    server.start()
    println("server placeholder listening on :${server.address.port} (GET /healthz)")
}

internal fun createServer(port: Int): HttpServer {
    val server = HttpServer.create(InetSocketAddress(port), 0)
    server.createContext("/healthz") { exchange ->
        val ok = exchange.requestMethod == "GET" && exchange.requestURI.path == "/healthz"
        val body = (if (ok) "ok" else "not found").toByteArray()
        exchange.responseHeaders.add("Content-Type", "text/plain; charset=utf-8")
        exchange.sendResponseHeaders(if (ok) 200 else 404, body.size.toLong())
        exchange.responseBody.use { it.write(body) }
    }
    return server
}
