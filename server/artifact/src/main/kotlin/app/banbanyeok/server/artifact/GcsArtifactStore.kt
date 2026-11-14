package app.banbanyeok.server.artifact

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder

/**
 * Google Cloud Storage 버킷을 저장소로 쓴다(JSON API, JDK의 HttpURLConnection). 버전은 객체의 generation이고,
 * `ifMatch`는 `ifGenerationMatch`로 옮긴다(ABSENT는 generation 0 = "없어야 함").
 *
 * 공식 클라이언트 라이브러리 대신 직접 부르는 이유: 콜드스타트다. Cloud Run(min 0) 실측에서 라이브러리의 옵션·인증 초기화와
 * 첫 요청이 시작 시간의 절반 이상(약 1.5초)이었고, 서버가 쓰는 것은 객체 읽기 몇 번뿐이다(docs/setup/p8a-notes.md).
 *
 * 인증은 Cloud Run 실행 계정의 메타데이터 서버 토큰뿐이며 키 파일을 읽지 않는다. 토큰은 만료 전까지 재사용하고 어디에도
 * 기록하지 않는다. [endpoint]를 주면(에뮬레이터: 이미지 AppCDS 학습·로컬·통합 테스트) 인증 없이 그 주소로 간다.
 * [prefix]는 버킷 안의 루트 접두사다(예: `published`). 비우면 버킷 루트.
 */
public class GcsArtifactStore(
    private val bucket: String,
    private val ioDispatcher: CoroutineDispatcher,
    prefix: String = "",
    private val endpoint: String? = null,
    private val tokens: MetadataTokenProvider = MetadataTokenProvider(),
) : ArtifactStore {
    private val prefix: String = prefix.trim('/').let { if (it.isEmpty()) "" else "$it/" }
    private val apiBase: String = (endpoint ?: DEFAULT_ENDPOINT).trimEnd('/')

    override suspend fun get(key: ArtifactKey): StoredArtifact? =
        withContext(ioDispatcher) {
            val url = "$apiBase/storage/v1/b/$bucket/o/${encode(prefix + key.value)}?alt=media"
            retrying {
                val connection = open(url, "GET")
                when (val code = connection.responseCode) {
                    HTTP_OK -> {
                        // 한 응답 안에서 내용과 generation이 함께 오므로 읽는 도중 덮어써도 서로 어긋나지 않는다.
                        val generation = connection.getHeaderField("x-goog-generation").orEmpty()
                        StoredArtifact(key, connection.inputStream.use { it.readBytes() }, ArtifactVersion(generation))
                    }

                    HTTP_NOT_FOUND -> {
                        connection.drain()
                        null
                    }

                    else -> {
                        throw TransientHttpException(code, connection.errorText())
                    }
                }
            }
        }

    override suspend fun put(
        key: ArtifactKey,
        content: ByteArray,
        ifMatch: ArtifactVersion?,
    ): ArtifactVersion =
        withContext(ioDispatcher) {
            val condition =
                when (ifMatch) {
                    null -> ""
                    ArtifactVersion.ABSENT -> "&ifGenerationMatch=0"
                    else -> "&ifGenerationMatch=${ifMatch.token.toLong()}"
                }
            val url = "$apiBase/upload/storage/v1/b/$bucket/o?uploadType=media&name=${encode(
                prefix + key.value,
            )}$condition"
            val connection = open(url, "POST")
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/octet-stream")
            connection.setFixedLengthStreamingMode(content.size)
            connection.outputStream.use { it.write(content) }
            when (val code = connection.responseCode) {
                HTTP_OK -> {
                    val body = connection.inputStream.use { it.readBytes() }.decodeToString()
                    val generation =
                        (
                            Json
                                .parseToJsonElement(
                                    body,
                                ).jsonObject["generation"] as? JsonPrimitive
                        )?.contentOrNull
                    ArtifactVersion(requireNotNull(generation) { "응답에 generation이 없습니다: $key" })
                }

                HTTP_PRECONDITION_FAILED -> {
                    connection.drain()
                    throw PreconditionFailedException(key)
                }

                else -> {
                    throw IOException("GCS 쓰기 실패($code) $key: ${connection.errorText()}")
                }
            }
        }

    override suspend fun list(prefix: String): List<ArtifactKey> =
        withContext(ioDispatcher) {
            val names = mutableListOf<String>()
            var pageToken: String? = null
            do {
                val paging = pageToken?.let { "&pageToken=${encode(it)}" }.orEmpty()
                val url =
                    "$apiBase/storage/v1/b/$bucket/o?prefix=${encode(this@GcsArtifactStore.prefix + prefix)}" +
                        "&fields=items(name),nextPageToken$paging"
                val body =
                    retrying {
                        val connection = open(url, "GET")
                        if (connection.responseCode != HTTP_OK) {
                            throw TransientHttpException(connection.responseCode, connection.errorText())
                        }
                        connection.inputStream.use { it.readBytes() }.decodeToString()
                    }
                val page: JsonObject = Json.parseToJsonElement(body).jsonObject
                page["items"]?.jsonArray?.forEach { item ->
                    (item.jsonObject["name"] as? JsonPrimitive)?.contentOrNull?.let { names += it }
                }
                pageToken = (page["nextPageToken"] as? JsonPrimitive)?.contentOrNull
            } while (pageToken != null)
            names
                .map { it.removePrefix(this@GcsArtifactStore.prefix) }
                .filter { ArtifactKey.isValid(it) }
                .sorted()
                .map { ArtifactKey(it) }
        }

    private fun open(
        url: String,
        method: String,
    ): HttpURLConnection {
        val connection = URI.create(url).toURL().openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = TIMEOUT_MS
        connection.readTimeout = TIMEOUT_MS
        if (endpoint == null) connection.setRequestProperty("Authorization", "Bearer ${tokens.token()}")
        return connection
    }

    /** 5xx와 연결 오류만 짧게 다시 시도한다(최대 [ATTEMPTS]번). */
    private fun <T> retrying(block: () -> T): T {
        var last: Exception? = null
        repeat(ATTEMPTS) { attempt ->
            try {
                return block()
            } catch (e: TransientHttpException) {
                if (e.code < HTTP_SERVER_ERROR) throw IOException("GCS 읽기 실패(${e.code}): ${e.body}", e)
                last = e
            } catch (e: IOException) {
                last = e
            }
            if (attempt < ATTEMPTS - 1) Thread.sleep(RETRY_DELAY_MS * (attempt + 1))
        }
        throw IOException("GCS 요청이 계속 실패했습니다", last)
    }

    private class TransientHttpException(
        val code: Int,
        val body: String,
    ) : IOException("HTTP $code")

    private fun HttpURLConnection.drain() =
        runCatching {
            inputStream?.use { it.readBytes() }
                ?: errorStream?.use { it.readBytes() }
        }

    private fun HttpURLConnection.errorText(): String =
        runCatching {
            errorStream
                ?.use {
                    it.readBytes().decodeToString().take(
                        MAX_ERROR_TEXT,
                    )
                }.orEmpty()
        }.getOrDefault("")

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8)

    private companion object {
        const val DEFAULT_ENDPOINT = "https://storage.googleapis.com"
        const val HTTP_OK = 200
        const val HTTP_NOT_FOUND = 404
        const val HTTP_PRECONDITION_FAILED = 412
        const val HTTP_SERVER_ERROR = 500
        const val TIMEOUT_MS = 15_000
        const val ATTEMPTS = 3
        const val RETRY_DELAY_MS = 200L
        const val MAX_ERROR_TEXT = 300
    }
}
