package app.banbanyeok.server.app.counter

import app.banbanyeok.server.app.application.UsageStage
import java.time.LocalDate
import javax.sql.DataSource

class JdbcDailyCounter(
    private val source: DataSource,
) {
    fun write(
        date: LocalDate,
        stage: UsageStage,
    ) {
        source.connection.use { connection ->
            connection.prepareStatement(UPSERT).use {
                it.setObject(1, date)
                it.setString(2, stage.name)
                it.executeUpdate()
            }
        }
    }

    private companion object {
        const val UPSERT = """
            INSERT INTO daily_stage_counts (kst_date, stage, total) VALUES (?, ?, 1)
            ON CONFLICT (kst_date, stage) DO UPDATE SET total = daily_stage_counts.total + 1
        """
    }
}
