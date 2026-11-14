package app.banbanyeok.pipeline

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

internal data class Download(
    val bytes: ByteArray,
    val contentType: String,
)

internal fun interface PipelineHttp {
    fun request(
        url: String,
        form: String?,
    ): Download
}

/** Never propagate HTTP exceptions: Seoul credentials are embedded in URI paths. */
internal class JdkPipelineHttp : PipelineHttp {
    private val client =
        HttpClient
            .newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .connectTimeout(Duration.ofSeconds(30))
            .build()

    override fun request(
        url: String,
        form: String?,
    ): Download =
        try {
            val request = HttpRequest.newBuilder(URI(url)).timeout(Duration.ofSeconds(90))
            if (form == null) {
                request.GET()
            } else {
                request
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(form))
            }
            val response = client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray())
            check(response.statusCode() == 200) { "HTTP status failure" }
            Download(response.body(), response.headers().firstValue("Content-Type").orElse(""))
        } catch (_: Exception) {
            error("Download failed: HTTP/URI/timeout (request URL redacted)")
        }
}
