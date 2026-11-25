package app.banbanyeok.server.app.http

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Clock
import java.time.Duration
import java.time.Instant

/**
 * 같은 키의 변경 요청은 인스턴스 안에서 직렬화하고, 저장된 응답은 호출자가 현재 상태를 확인한 뒤 재사용한다.
 * 다른 인스턴스에서는 새 요청으로 처리된다.
 * 응답에 토큰이 들어 있으므로 디스크나 DB에 두지 않고 [ttl] 후 버린다.
 */
class IdempotencyCache(
    private val clock: Clock,
    private val ttl: Duration = Duration.ofMinutes(10),
    private val maxEntries: Int = 1000,
) {
    private class Entry(
        val body: String,
        val expiresAt: Instant,
    )

    private class InFlight {
        val mutex = Mutex()
        var requests = 0
    }

    private val entries = LinkedHashMap<String, Entry>()
    private val inFlight = mutableMapOf<String, InFlight>()

    /** [replay]가 null을 돌려주면 캐시를 버리고 새로 실행한다. 오류가 나면 같은 키로 새 변경을 실행하지 않는다. */
    suspend fun resolve(
        key: String,
        replay: suspend (String) -> String?,
        create: suspend () -> String,
    ): String {
        val flight = acquire(key)
        try {
            return flight.mutex.withLock {
                val cached = find(key)
                if (cached != null) {
                    replay(cached)?.let { return@withLock it }
                    remove(key)
                }
                create().also { store(key, it) }
            }
        } finally {
            release(key, flight)
        }
    }

    @Synchronized
    private fun acquire(key: String): InFlight = inFlight.getOrPut(key, ::InFlight).also { it.requests++ }

    @Synchronized
    private fun release(
        key: String,
        flight: InFlight,
    ) {
        if (--flight.requests == 0) inFlight.remove(key)
    }

    @Synchronized
    private fun find(key: String): String? {
        val entry = entries[key] ?: return null
        if (!clock.instant().isBefore(entry.expiresAt)) {
            entries.remove(key)
            return null
        }
        return entry.body
    }

    @Synchronized
    private fun remove(key: String) {
        entries.remove(key)
    }

    @Synchronized
    private fun store(
        key: String,
        body: String,
    ) {
        val now = clock.instant()
        entries.entries.removeIf { !now.isBefore(it.value.expiresAt) }
        while (entries.size >= maxEntries) entries.remove(entries.keys.first())
        entries[key] = Entry(body, now.plus(ttl))
    }
}
