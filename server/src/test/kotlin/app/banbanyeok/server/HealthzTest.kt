package app.banbanyeok.server

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import kotlin.test.Test
import kotlin.test.assertEquals

class HealthzTest {
    @Test
    fun healthzReturnsOk() {
        val server = createServer(0) // 0 = 빈 포트
        server.start()
        try {
            val url = URI("http://127.0.0.1:${server.address.port}/healthz")
            val response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(url).build(), HttpResponse.BodyHandlers.ofString())
            assertEquals(200, response.statusCode())
            assertEquals("ok", response.body())
        } finally {
            server.stop(0)
        }
    }
}
