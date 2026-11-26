package app.banbanyeok.server.room.exposed

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import org.jetbrains.exposed.v1.jdbc.Database
import javax.sql.DataSource
import kotlin.concurrent.thread

public data class DatabaseSettings(
    val url: String,
    val user: String,
    val password: String,
    val maxPoolSize: Int = DEFAULT_POOL_SIZE,
) {
    // 비밀번호가 로그에 찍히지 않게 toString을 막는다.
    override fun toString(): String = "DatabaseSettings(url=$url, user=$user, password=***, maxPoolSize=$maxPoolSize)"

    private companion object {
        const val DEFAULT_POOL_SIZE = 4
    }
}

public class ConnectedDatabase(
    private val pool: HikariDataSource,
    public val database: Database,
) : AutoCloseable {
    public val dataSource: DataSource get() = pool

    override fun close() = pool.close()

    /**
     * 첫 연결(TLS·인증 왕복)을 별도 스레드에서 미리 맺어 둔다. 콜드스타트 때 산출물 읽기와 겹쳐 돌아서, 첫 방 요청이 이 비용
     * (Supabase 풀러 기준 약 0.5초)을 치르지 않는다. 최선 노력이라 실패해도 무시하고(첫 요청이 다시 시도한다) [onSuccess]는
     * 연결이 실제로 맺어져 유효할 때만 부른다.
     */
    public fun warmUp(onSuccess: () -> Unit = {}) {
        thread(name = "db-warmup", isDaemon = true) {
            runCatching { dataSource.connection.use { it.isValid(WARMUP_VALID_SECONDS) } }
                .onSuccess { valid -> if (valid) onSuccess() }
        }
    }

    private companion object {
        const val WARMUP_VALID_SECONDS = 5
    }
}

public object DatabaseFactory {
    /**
     * 서버 시작은 DB 연결을 기다리지 않는다(콜드스타트를 줄이고, DB 쪽이 깨어나는 동안에도 /healthz는 응답한다).
     * 연결은 첫 요청에서 만든다. 마이그레이션은 서버 시작이 아닌 별도 작업(Liquibase)이 한다.
     */
    public fun connect(settings: DatabaseSettings): ConnectedDatabase {
        val config =
            HikariConfig().apply {
                jdbcUrl = settings.url
                username = settings.user
                password = settings.password
                maximumPoolSize = settings.maxPoolSize
                minimumIdle = 0
                initializationFailTimeout = -1
                connectionTimeout = CONNECTION_TIMEOUT_MS
                idleTimeout = IDLE_TIMEOUT_MS
                maxLifetime = MAX_LIFETIME_MS
                poolName = "banbanyeok"
            }
        val dataSource = HikariDataSource(config)
        return ConnectedDatabase(dataSource, connect(dataSource))
    }

    public fun connect(dataSource: DataSource): Database = Database.connect(dataSource)

    private const val CONNECTION_TIMEOUT_MS = 10_000L
    private const val IDLE_TIMEOUT_MS = 60_000L
    private const val MAX_LIFETIME_MS = 600_000L
}
