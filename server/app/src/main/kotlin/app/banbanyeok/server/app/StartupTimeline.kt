package app.banbanyeok.server.app

import org.slf4j.LoggerFactory

/**
 * 콜드스타트 단계별 경과 시간(ms)을 로그로 남긴다. 값은 시간 숫자와 단계 이름뿐이고 설정·비밀은 싣지 않는다.
 * `sinceJvmMs`는 JVM 시작부터, `phaseMs`는 직전 표시부터의 시간이다. 첫 표시에 JVM 시작 시각(epoch ms)을 함께 남겨
 * Cloud Run의 "Starting new instance" 로그 시각과 맞춰 컨테이너 시작→JVM 시간을 구할 수 있게 한다.
 */
class StartupTimeline(
    private val nowMillis: () -> Long = System::currentTimeMillis,
    private val jvmStartMillis: Long = processStartMillis(),
) {
    private val log = LoggerFactory.getLogger("startup")
    private var last = jvmStartMillis

    @Synchronized
    fun mark(phase: String) {
        val now = nowMillis()
        val first = if (last == jvmStartMillis) " jvmStartEpochMs=$jvmStartMillis" else ""
        log.info("startup phase={} sinceJvmMs={} phaseMs={}{}", phase, now - jvmStartMillis, now - last, first)
        last = now
    }
}

/** JVM(프로세스) 시작 시각(epoch ms). JMX(ManagementFactory)는 클래스 로딩이 무거워 쓰지 않는다. 알 수 없으면 지금. */
private fun processStartMillis(): Long =
    ProcessHandle
        .current()
        .info()
        .startInstant()
        .map { it.toEpochMilli() }
        .orElseGet { System.currentTimeMillis() }
