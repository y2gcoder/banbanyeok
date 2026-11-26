package app.banbanyeok.server.app.counter

import app.banbanyeok.server.app.application.UsageStage
import org.slf4j.Logger
import org.slf4j.LoggerFactory
import java.sql.SQLException
import java.time.LocalDate
import javax.sql.DataSource

class JdbcDailyCounter(
    private val source: DataSource,
) {
    fun write(
        date: LocalDate,
        stage: UsageStage,
    ) {
        try {
            source.connection.use { connection ->
                connection.prepareStatement(UPSERT).use {
                    it.setObject(1, date)
                    it.setString(2, stage.name)
                    it.executeUpdate()
                }
            }
        } catch (_: SQLException) {
            // JDBC 예외에는 접속 정보 등이 있을 수 있다.
            logger.warn("하루 요청 건수 저장 실패")
        }
    }

    private companion object {
        val logger: Logger = LoggerFactory.getLogger(JdbcDailyCounter::class.java)
        const val UPSERT = """
            INSERT INTO daily_stage_counts (kst_date, stage, total) VALUES (?, ?, 1)
            ON CONFLICT (kst_date, stage) DO UPDATE SET total = daily_stage_counts.total + 1
        """
    }
}
