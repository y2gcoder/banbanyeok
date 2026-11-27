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
        val url = createDatabase(STEP4_DB)
        migrate(url)
        connect(url).use { connection -> connection.createStatement().use { it.execute(STEP4_SQL) } }
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
