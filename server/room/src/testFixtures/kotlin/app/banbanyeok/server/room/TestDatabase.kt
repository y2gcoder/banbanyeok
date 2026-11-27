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
        migrate(container.jdbcUrl)
        pool(container.jdbcUrl)
    }

    val database: Database by lazy { DatabaseFactory.connect(dataSource) }

    /**
     * ADR-0012 4단계 모양의 DB(같은 컨테이너의 다른 데이터베이스). 운영과 같은 changelog로 만든 뒤 [STEP4_SQL]로 공유 번호 트리거에서
     * `hidden` 비교를 빼고 `participants.hidden`을 지운다. 3단계 서버가 이 열을 SQL에서 참조하면(이름으로든 `selectAll()`로든) 여기서
     * "column does not exist"로 실패한다. 4단계 changeset 자체는 아니다(그 PR이 따로 만든다).
     */
    val step4DataSource: HikariDataSource by lazy {
        dataSource
        DriverManager.getConnection(container.jdbcUrl, container.username, container.password).use { connection ->
            connection.createStatement().use { it.execute("CREATE DATABASE $STEP4_DB") }
        }
        val url =
            container.jdbcUrl.substringBeforeLast('/') + "/" + STEP4_DB +
                container.jdbcUrl.substringAfterLast('/').dropWhile { it != '?' }
        migrate(url)
        DriverManager.getConnection(url, container.username, container.password).use { connection ->
            connection.createStatement().use { it.execute(STEP4_SQL) }
        }
        pool(url)
    }

    val step4Database: Database by lazy { DatabaseFactory.connect(step4DataSource) }

    fun jdbcUrl(): String = container.also { dataSource }.jdbcUrl

    val username: String get() = container.username
    val password: String get() = container.password

    fun stop() {
        if (container.isRunning) {
            runCatching { dataSource.close() }
            runCatching { step4DataSource.close() }
            container.stop()
        }
    }

    private fun pool(url: String) =
        HikariDataSource(
            HikariConfig().apply {
                jdbcUrl = url
                username = container.username
                password = container.password
                maximumPoolSize = POOL_SIZE
            },
        )

    private fun migrate(url: String) {
        val changelog = File(requireNotNull(System.getProperty("changelog.dir")) { "changelog.dir 시스템 속성이 없습니다" })
        val factory = LiquibaseDatabaseFactory.getInstance()
        DriverManager.getConnection(url, container.username, container.password).use { connection ->
            val database = factory.findCorrectDatabaseImplementation(JdbcConnection(connection))
            Liquibase("master.sql", DirectoryResourceAccessor(changelog), database).use { it.update("") }
        }
    }

    private const val POOL_SIZE = 8
    private const val STEP4_DB = "step4"

    /** master.sql의 participants_share_version에서 hidden 비교만 뺀 함수, hidden 없는 트리거, 열 삭제. */
    private val STEP4_SQL =
        """
        CREATE OR REPLACE FUNCTION participants_share_version() RETURNS trigger AS ${'$'}${'$'}
        DECLARE
            rid      text;
            releases boolean;
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                IF (NEW.nickname, NEW.origin_code) IS NOT DISTINCT FROM (OLD.nickname, OLD.origin_code) THEN
                    RETURN NULL;
                END IF;
                rid := NEW.room_id;
                releases := NEW.origin_code IS DISTINCT FROM OLD.origin_code;
            ELSIF TG_OP = 'INSERT' THEN
                rid := NEW.room_id;
                releases := true;
            ELSE
                rid := OLD.room_id;
                releases := true;
            END IF;
            UPDATE rooms SET
                share_version          = share_version + 1,
                decision_basis_version = decision_basis_version + CASE WHEN releases THEN 1 ELSE 0 END,
                decided_station        = CASE WHEN releases THEN NULL ELSE decided_station END,
                decided_by_pid         = CASE WHEN releases THEN NULL ELSE decided_by_pid END,
                decided_at             = CASE WHEN releases THEN NULL ELSE decided_at END
            WHERE id = rid;
            RETURN NULL;
        END;
        ${'$'}${'$'} LANGUAGE plpgsql;
        DROP TRIGGER participants_share_version ON participants;
        CREATE TRIGGER participants_share_version AFTER INSERT OR DELETE OR UPDATE OF nickname, origin_code ON participants
            FOR EACH ROW EXECUTE FUNCTION participants_share_version();
        ALTER TABLE participants DROP COLUMN hidden;
        """.trimIndent()
}
