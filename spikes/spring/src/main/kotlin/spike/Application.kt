package spike

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import jakarta.servlet.http.HttpServletResponse
import java.io.File

object Payload { lateinit var bytes: ByteArray }

@SpringBootApplication(proxyBeanMethods = false)
class Application

@RestController
class Endpoints {
    @GetMapping("/healthz")
    fun health(response: HttpServletResponse): String {
        response.setHeader("X-Virtual-Thread", Thread.currentThread().isVirtual.toString())
        return "ok:${Payload.bytes.size}"
    }
    @GetMapping("/v1/recommend", produces = ["application/json"])
    fun recommend(): String {
        val data = Payload.bytes
        val score = (0 until 1000).sumOf { data[it % data.size].toInt() and 255 }
        return """{"stationId":"AAA","score":$score,"bytes":${data.size}}"""
    }
}
fun main(args: Array<String>) {
    Payload.bytes = File(System.getenv("DATA_FILE") ?: "data/133120.bin").readBytes()
    runApplication<Application>(*args)
}
