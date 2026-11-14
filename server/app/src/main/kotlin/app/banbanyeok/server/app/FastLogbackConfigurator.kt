package app.banbanyeok.server.app

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.LoggerContext
import ch.qos.logback.classic.encoder.PatternLayoutEncoder
import ch.qos.logback.classic.spi.Configurator
import ch.qos.logback.core.ConsoleAppender
import ch.qos.logback.core.spi.ContextAwareBase

/**
 * 로깅 설정을 XML 파싱 없이 코드로 한다. 콜드스타트 실측에서 logback.xml을 읽는 초기화(JAXP·Joran)가 약 0.85초였다.
 * 내용은 이전 logback.xml과 같다: 콘솔 한 줄 형식, 루트 INFO, netty는 WARN. 요청 로그는 메서드·가려진 경로·상태 코드만 남기고
 * 토큰·쿼리·출발역은 기록하지 않는다(RequestLogging). logback이 ServiceLoader로 찾는다(META-INF/services).
 */
class FastLogbackConfigurator :
    ContextAwareBase(),
    Configurator {
    override fun configure(loggerContext: LoggerContext): Configurator.ExecutionStatus {
        val encoder =
            PatternLayoutEncoder().apply {
                context = loggerContext
                pattern = "%d{HH:mm:ss.SSS} %-5level %logger{20} - %msg%n"
                start()
            }
        val console =
            ConsoleAppender<ch.qos.logback.classic.spi.ILoggingEvent>().apply {
                context = loggerContext
                name = "STDOUT"
                this.encoder = encoder
                start()
            }
        loggerContext.getLogger(Logger.ROOT_LOGGER_NAME).apply {
            level = Level.INFO
            addAppender(console)
        }
        loggerContext.getLogger("io.netty").level = Level.WARN
        return Configurator.ExecutionStatus.DO_NOT_INVOKE_NEXT_IF_ANY
    }
}
