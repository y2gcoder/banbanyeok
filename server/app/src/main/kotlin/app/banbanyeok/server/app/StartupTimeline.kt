package app.banbanyeok.server.app

import org.slf4j.LoggerFactory

/**
 * 콜드스타트 단계별 경과 시간(ms)을 로그로 남긴다. 값은 시간 숫자와 단계 이름뿐이고 설정·비밀은 싣지 않는다.
 * `sinceMainMs`는 [StartupTimeline] 생성(main 진입)부터, `phaseMs`는 직전 표시부터의 시간이다. 첫 표시에 main 진입 시각
 * (epoch ms)을 함께 남겨, Cloud Run의 "Starting new instance" 로그 시각과 비교하면 컨테이너 시작→main 시간을 구할 수 있다.
 * (JVM 시작 시각은 JMX가 클래스 로딩을 늘리고 샌드박스의 프로세스 시작 시각이 부정확해 쓰지 않는다.)
 */
class StartupTimeline(
    private val startMillis: Long = System.currentTimeMillis(),
    private val nowMillis: () -> Long = System::currentTimeMillis,
) {
    // 로거를 처음 만드는 비용(로깅 설정 읽기)이 첫 단계(`main`)의 phaseMs에 들어가도록 시작 시각을 먼저 받는다.
    private val log = LoggerFactory.getLogger("startup")
    private var last = startMillis

    @Synchronized
    fun mark(phase: String) {
        val now = nowMillis()
        val first = if (last == startMillis) " mainEpochMs=$startMillis" else ""
        log.info("startup phase={} sinceMainMs={} phaseMs={}{}", phase, now - startMillis, now - last, first)
        last = now
    }
}
