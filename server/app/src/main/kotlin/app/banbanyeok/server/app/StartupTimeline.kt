package app.banbanyeok.server.app

import org.slf4j.LoggerFactory

/**
 * 콜드스타트 단계별 경과 시간(ms)을 기록한다. 값은 시간 숫자와 단계 이름뿐이고 설정·비밀은 싣지 않는다.
 * `sinceMainMs`는 [StartupTimeline] 생성(main 진입)부터, `phaseMs`는 직전 표시부터의 시간이다. 첫 줄에 main 진입 시각(epoch ms)을
 * 함께 남겨, Cloud Run의 "Starting new instance" 로그 시각과 비교하면 컨테이너 시작→main 시간을 구할 수 있다.
 *
 * [mark]는 메모리에만 적어 둔다(로깅 초기화를 기다리지 않는다: 로깅 초기화에 약 0.4초가 걸려서, 시작 작업 스레드가 첫 표시에서
 * 그것을 기다리면 두 일이 겹치지 않는다). [flush] 이후의 표시는 바로 로그로 남는다.
 */
class StartupTimeline(
    private val startMillis: Long = System.currentTimeMillis(),
    private val nowMillis: () -> Long = System::currentTimeMillis,
) {
    private class Entry(
        val phase: String,
        val sinceMainMs: Long,
        val phaseMs: Long,
    )

    private val log by lazy { LoggerFactory.getLogger("startup") }
    private val pending = ArrayDeque<Entry>()
    private var last = startMillis
    private var flushed = false
    private var announced = false

    @Synchronized
    fun mark(phase: String) {
        val now = nowMillis()
        pending.addLast(Entry(phase, now - startMillis, now - last))
        last = now
        if (flushed) drain()
    }

    /** 지금까지의 표시를 로그로 내보내고 이후 표시는 바로 남긴다. 로깅이 준비된 뒤에 부른다. */
    @Synchronized
    fun flush() {
        flushed = true
        drain()
    }

    private fun drain() {
        while (pending.isNotEmpty()) {
            val e = pending.removeFirst()
            val first = if (announced) "" else " mainEpochMs=$startMillis"
            announced = true
            log.info("startup phase={} sinceMainMs={} phaseMs={}{}", e.phase, e.sinceMainMs, e.phaseMs, first)
        }
    }
}
