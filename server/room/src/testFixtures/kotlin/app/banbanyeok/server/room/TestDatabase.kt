package app.banbanyeok.server.room

import app.banbanyeok.server.room.exposed.DatabaseFactory
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import liquibase.Liquibase
import liquibase.database.jvm.JdbcConnection
import liquibase.resource.DirectoryResourceAccessor
import org.jetbrains.exposed.v1.jdbc.Database
import org.testcontainers.containers.PostgreSQLContainer
import java.io.File
import java.sql.DriverManager
import liquibase.database.DatabaseFactory as LiquibaseDatabaseFactory

/**
 * 통합 테스트 JVM 하나가 공유하는 실제 Postgres(Testcontainers, 개발용 compose와 같은 17.6).
 * 스키마는 운영과 같은 Liquibase SQL changelog(server/db/changelog)로 만든다. H2는 쓰지 않는다.
 */
object TestDatabase {
    private val container = PostgreSQLContainer<Nothing>("postgres:17.6")

    val dataSource: HikariDataSource by lazy {
        container.start()
        migrate()
        HikariDataSource(
            HikariConfig().apply {
                jdbcUrl = container.jdbcUrl
                username = container.username
                password = container.password
                maximumPoolSize = POOL_SIZE
            },
        )
    }

    val database: Database by lazy { DatabaseFactory.connect(dataSource) }

    fun jdbcUrl(): String = container.also { dataSource }.jdbcUrl

    val username: String get() = container.username
    val password: String get() = container.password

    fun stop() {
        if (container.isRunning) {
            runCatching { dataSource.close() }
            container.stop()
        }
    }

    private fun migrate() {
        val changelog = File(requireNotNull(System.getProperty("changelog.dir")) { "changelog.dir 시스템 속성이 없습니다" })
        val factory = LiquibaseDatabaseFactory.getInstance()
        DriverManager.getConnection(container.jdbcUrl, container.username, container.password).use { connection ->
            val database = factory.findCorrectDatabaseImplementation(JdbcConnection(connection))
            Liquibase("master.sql", DirectoryResourceAccessor(changelog), database).use { it.update("") }
        }
    }

    private const val POOL_SIZE = 8
}
