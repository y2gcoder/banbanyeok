package app.banbanyeok.server.app.http

import java.time.Clock
import java.time.Duration
import java.time.Instant

class StoredResponse(
    val body: String,
)

/**
 * `Idempotency-Key`로 같은 변경 요청의 재시도를 한 번만 실행한다. 인스턴스 메모리의 짧은 캐시라서
 * 같은 인스턴스로 재시도가 가면 처음 응답을 그대로 돌려주고, 다른 인스턴스에서는 새 요청으로 처리된다.
 * 응답에 토큰이 들어 있으므로 디스크나 DB에 두지 않고 [ttl] 후 버린다.
 */
class IdempotencyCache(
    private val clock: Clock,
    private val ttl: Duration = Duration.ofMinutes(10),
    private val maxEntries: Int = 1000,
) {
    private class Entry(
        val response: StoredResponse,
        val expiresAt: Instant,
    )

    private val entries = LinkedHashMap<String, Entry>()

    @Synchronized
    fun find(key: String): StoredResponse? {
        val entry = entries[key] ?: return null
        if (!clock.instant().isBefore(entry.expiresAt)) {
            entries.remove(key)
            return null
        }
        return entry.response
    }

    @Synchronized
    fun store(
        key: String,
        response: StoredResponse,
    ) {
        val now = clock.instant()
        entries.entries.removeIf { !now.isBefore(it.value.expiresAt) }
        while (entries.size >= maxEntries) entries.remove(entries.keys.first())
        entries[key] = Entry(response, now.plus(ttl))
    }
}
