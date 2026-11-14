package app.banbanyeok.server.app.http

import app.banbanyeok.server.app.config.ClientIpSource
import app.banbanyeok.server.app.config.ClientIpSourceKind
import app.banbanyeok.server.app.config.LimitSpec
import app.banbanyeok.server.app.config.RateLimitConfig
import io.ktor.server.request.ApplicationRequest
import io.ktor.server.request.header
import java.security.MessageDigest
import java.time.Clock
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.ceil

/**
 * 키(클라이언트)별 토큰 버킷. 인스턴스 메모리에만 있으므로 인스턴스가 여럿이거나 scale-to-zero로 내려가면 초기화된다:
 * 정상 사용자를 막지 않으면서 단순한 남용을 줄이는 기본 방어선이다(tech-stack 5.2).
 */
class TokenBucketLimiter(
    private val spec: LimitSpec,
    private val clock: Clock,
) {
    private class Bucket(
        var tokens: Double,
        var updatedAtNanos: Long,
    )

    /** 허용하면 null, 거절하면 다시 시도할 때까지의 초. */
    fun tryAcquire(key: String): Long? {
        val now = nanos()
        if (buckets.size > MAX_KEYS) evict(now)
        val bucket = buckets.computeIfAbsent(key) { Bucket(spec.capacity.toDouble(), now) }
        synchronized(bucket) {
            val elapsedSeconds = (now - bucket.updatedAtNanos) / NANOS_PER_SECOND
            bucket.tokens = minOf(spec.capacity.toDouble(), bucket.tokens + elapsedSeconds * spec.refillPerSecond)
            bucket.updatedAtNanos = now
            if (bucket.tokens >= 1.0) {
                bucket.tokens -= 1.0
                return null
            }
            return ceil((1.0 - bucket.tokens) / spec.refillPerSecond).toLong().coerceAtLeast(1)
        }
    }

    private val buckets = ConcurrentHashMap<String, Bucket>()

    private fun nanos(): Long = clock.instant().let { it.epochSecond * NANOS_PER_SECOND.toLong() + it.nano }

    /** 가득 찬(= 한동안 쓰지 않은) 버킷부터 버린다. 메모리가 무한히 늘지 않게 한다. */
    private fun evict(now: Long) {
        val idleNanos = (spec.capacity / spec.refillPerSecond * NANOS_PER_SECOND).toLong()
        buckets.entries.removeIf { now - it.value.updatedAtNanos > idleNanos }
        if (buckets.size > MAX_KEYS) buckets.clear()
    }

    private companion object {
        const val MAX_KEYS = 50_000
        const val NANOS_PER_SECOND = 1_000_000_000.0
    }
}

/** 웹 프록시(Cloudflare Worker)가 붙이는 헤더. 비밀은 Secret Manager의 `proxy-shared-secret`과 같은 값이다. */
const val PROXY_SECRET_HEADER = "X-Banbanyeok-Proxy-Secret"
const val PROXY_CLIENT_IP_HEADER = "X-Banbanyeok-Client-IP"
private const val MAX_CLIENT_IP_LENGTH = 64

/**
 * 프록시가 공유 비밀(상수 시간 비교)과 함께 넘긴 클라이언트 IP. 비밀이 설정에 없거나 틀리거나 IP 헤더가 비었으면 null이라서,
 * 서버 주소(run.app)를 직접 부르는 쪽이 헤더를 위조해도 효과가 없다(자기 연결 IP의 한도에 걸린다).
 */
private fun trustedProxyClient(
    request: ApplicationRequest,
    source: ClientIpSource,
): String? {
    val expected = source.proxySecret ?: return null
    val presented = request.header(PROXY_SECRET_HEADER) ?: return null
    val sha256 = { text: String -> MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)) }
    // 해시로 길이를 맞춘 뒤 비교한다(MessageDigest.isEqual은 상수 시간).
    if (!MessageDigest.isEqual(sha256(presented), sha256(expected))) return null
    return request
        .header(PROXY_CLIENT_IP_HEADER)
        ?.trim()
        ?.takeIf { it.isNotEmpty() && it.length <= MAX_CLIENT_IP_LENGTH }
}

/**
 * 요청의 클라이언트 키(IP). 신뢰된 프록시의 헤더(공유 비밀이 맞을 때)가 있으면 그것을, 아니면 설정에 따라 직접 연결 또는
 * 앞단 프록시 체인에서 읽은 값을 쓴다. 헤더 이름만 믿지 않는다: 누구나 보낼 수 있기 때문이다.
 */
fun clientKey(
    request: ApplicationRequest,
    source: ClientIpSource,
): String {
    trustedProxyClient(request, source)?.let { return it }
    val fromHeader =
        when (source.kind) {
            ClientIpSourceKind.PEER -> null
            ClientIpSourceKind.XFF_LAST -> request.header("X-Forwarded-For")?.substringAfterLast(',')
            ClientIpSourceKind.HEADER -> source.header?.let { request.header(it) }
        }
    return fromHeader?.trim()?.takeIf { it.isNotEmpty() } ?: request.local.remoteAddress
}

/** 속도 제한에 걸렸다. HTTP 계층이 429와 `Retry-After`로 바꾼다. */
class RateLimitedException(
    val retryAfterSeconds: Long,
) : RuntimeException("요청이 너무 많습니다")

/**
 * 기본 속도 제한 세 가지: 전체 요청, 변경 요청(POST/PUT/PATCH/DELETE), 생성 요청(익명 사용자·방 만들기, 일일 상한 포함).
 * 한도에 걸리면 [RateLimitedException]을 던진다.
 */
class RateLimiting(
    private val config: RateLimitConfig,
    clock: Clock,
) {
    private val general = TokenBucketLimiter(config.general, clock)
    private val write = TokenBucketLimiter(config.write, clock)
    private val creation = TokenBucketLimiter(config.creation, clock)

    fun check(
        method: String,
        path: String,
        request: ApplicationRequest,
    ) {
        if (!config.enabled || path == "/healthz" || path == "/v1/healthz") return
        val key = clientKey(request, config.clientIp)
        val denied =
            general.tryAcquire(key)
                ?: writeDenied(method, key)
                ?: creationDenied(method, path, key)
        if (denied != null) throw RateLimitedException(denied)
    }

    private fun writeDenied(
        method: String,
        key: String,
    ): Long? = if (method != "GET") write.tryAcquire(key) else null

    private fun creationDenied(
        method: String,
        path: String,
        key: String,
    ): Long? = if (method == "POST" && path in CREATION_PATHS) creation.tryAcquire(key) else null

    private companion object {
        val CREATION_PATHS = setOf("/v1/anon", "/v1/rooms")
    }
}
