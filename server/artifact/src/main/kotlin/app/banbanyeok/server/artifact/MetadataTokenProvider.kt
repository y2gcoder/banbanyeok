package app.banbanyeok.server.artifact

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.time.Clock

/**
 * Cloud Run(·GCE) 실행 계정의 액세스 토큰을 메타데이터 서버에서 받아 만료 1분 전까지 재사용한다.
 * 토큰은 로그·예외 메시지에 넣지 않는다. 메타데이터 서버는 고정 주소(169.254.169.254)로 부르고, 표준 환경 변수 `GCE_METADATA_HOST`로 바꿀 수 있다(시험용).
 */
public class MetadataTokenProvider(
    private val host: String = System.getenv("GCE_METADATA_HOST") ?: METADATA_IP,
    private val clock: Clock = Clock.systemUTC(),
) {
    private var cached: String? = null
    private var expiresAtMillis = 0L

    /** 캐시된 토큰을 버린다(서버가 401로 거절했을 때). 다음 [token] 호출이 새로 받는다. */
    @Synchronized
    public fun invalidate() {
        cached = null
        expiresAtMillis = 0L
    }

    @Synchronized
    public fun token(): String {
        val now = clock.millis()
        cached?.takeIf { now < expiresAtMillis }?.let { return it }
        val connection =
            URI
                .create(
                    "http://$host/computeMetadata/v1/instance/service-accounts/default/token",
                ).toURL()
                .openConnection()
                as HttpURLConnection
        connection.setRequestProperty("Metadata-Flavor", "Google")
        connection.connectTimeout = TIMEOUT_MS
        connection.readTimeout = TIMEOUT_MS
        if (connection.responseCode != HTTP_OK) throw IOException("메타데이터 서버 토큰 요청 실패(${connection.responseCode})")
        val body = Json.parseToJsonElement(connection.inputStream.use { it.readBytes() }.decodeToString()).jsonObject
        val token =
            (body["access_token"] as? JsonPrimitive)?.contentOrNull ?: throw IOException("토큰 응답에 access_token이 없습니다")
        val lifetime = (body["expires_in"] as? JsonPrimitive)?.longOrNull ?: DEFAULT_LIFETIME_SECONDS
        cached = token
        expiresAtMillis = now + (lifetime - REFRESH_MARGIN_SECONDS).coerceAtLeast(0) * MILLIS
        return token
    }

    private companion object {
        // 이름(metadata.google.internal) 대신 고정 주소: DNS 조회를 건너뛴다(콜드스타트). 표준 환경 변수로 바꿀 수 있다.
        const val METADATA_IP = "169.254.169.254"
        const val HTTP_OK = 200
        const val TIMEOUT_MS = 5_000
        const val DEFAULT_LIFETIME_SECONDS = 300L
        const val REFRESH_MARGIN_SECONDS = 60L
        const val MILLIS = 1000L
    }
}
