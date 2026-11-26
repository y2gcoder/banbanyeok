package app.banbanyeok.server.app.application

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import org.slf4j.Logger
import org.slf4j.LoggerFactory
import java.sql.SQLException
import javax.sql.DataSource

enum class UsageStage {
    RECOMMEND,
    CREATE_ROOM,
    JOIN_ROOM,
    DECIDE_STATION,
}

fun interface DailyCounter {
    suspend fun increment(stage: UsageStage)
}

class JdbcDailyCounter(
    private val source: DataSource,
    private val dispatcher: CoroutineDispatcher,
) : DailyCounter {
    override suspend fun increment(stage: UsageStage) {
        withContext(dispatcher) {
            try {
                source.connection.use { connection ->
                    connection.prepareStatement(UPSERT).use {
                        it.setString(1, stage.name)
                        it.executeUpdate()
                    }
                }
            } catch (_: SQLException) {
                // JDBC 예외에는 접속 정보 등이 있을 수 있다.
                logger.warn("하루 요청 건수 저장 실패")
            }
        }
    }

    private companion object {
        val logger: Logger = LoggerFactory.getLogger(JdbcDailyCounter::class.java)
        const val UPSERT = """
            INSERT INTO daily_stage_counts (kst_date, stage, total)
            VALUES ((statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date, ?, 1)
            ON CONFLICT (kst_date, stage) DO UPDATE SET total = daily_stage_counts.total + 1
        """
    }
}
