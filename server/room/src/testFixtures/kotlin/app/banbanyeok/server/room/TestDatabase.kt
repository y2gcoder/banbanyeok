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
import java.sql.Connection
import java.sql.DriverManager
import liquibase.database.DatabaseFactory as LiquibaseDatabaseFactory

/**
 * 통합 테스트 JVM 하나가 공유하는 실제 Postgres(Testcontainers, 개발용 compose와 같은 17.6).
 * 스키마는 운영과 같은 Liquibase SQL changelog(server/db/changelog)로 만든다. H2는 쓰지 않는다.
 */
object TestDatabase {
    const val DROP_HIDDEN_CHANGESET = "20261128-drop-participants-hidden"

    private val container = PostgreSQLContainer<Nothing>("postgres:17.6")

    val dataSource: HikariDataSource by lazy {
        container.start()
        migrate(container.jdbcUrl)
        pool(container.jdbcUrl)
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

    fun pool(url: String) =
        HikariDataSource(
            HikariConfig().apply {
                jdbcUrl = url
                username = container.username
                password = container.password
                maximumPoolSize = POOL_SIZE
            },
        )

    /** 같은 컨테이너에 빈 데이터베이스를 만들고 그 jdbc URL을 돌려준다. */
    fun createDatabase(name: String): String {
        dataSource
        connect(container.jdbcUrl).use { connection ->
            connection.createStatement().use { it.execute("CREATE DATABASE $name") }
        }
        return container.jdbcUrl.substringBeforeLast('/') + "/" + name +
            container.jdbcUrl.substringAfterLast('/').dropWhile { it != '?' }
    }

    fun connect(url: String): Connection = DriverManager.getConnection(url, container.username, container.password)

    /** 운영과 같은 changelog를 [url]에 적용한다. [count]가 있으면 앞에서부터 그만큼만 적용한다. */
    fun migrate(
        url: String,
        count: Int? = null,
    ) {
        val factory = LiquibaseDatabaseFactory.getInstance()
        connect(url).use { connection ->
            val database = factory.findCorrectDatabaseImplementation(JdbcConnection(connection))
            Liquibase(MASTER, DirectoryResourceAccessor(changelogDir()), database).use {
                if (count == null) it.update("") else it.update(count, "")
            }
        }
    }

    /** master.sql에서 [id] changeset보다 앞에 있는 changeset 수. */
    fun changesetsBefore(id: String): Int {
        val ids =
            File(changelogDir(), MASTER)
                .readLines()
                .filter { it.startsWith("--changeset ") }
                .map { it.substringAfter(':').substringBefore(' ') }
        return ids.indexOf(id).also { check(it >= 0) { "changeset이 없습니다: $id" } }
    }

    private fun changelogDir() =
        File(requireNotNull(System.getProperty("changelog.dir")) { "changelog.dir 시스템 속성이 없습니다" })

    private const val MASTER = "master.sql"
    private const val POOL_SIZE = 8
}
