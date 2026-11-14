package app.banbanyeok.server.room.exposed

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import org.jetbrains.exposed.v1.jdbc.Database
import javax.sql.DataSource

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
    public val dataSource: HikariDataSource,
    public val database: Database,
) : AutoCloseable {
    override fun close() = dataSource.close()
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
