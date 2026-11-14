package app.banbanyeok.pipeline

import io.kotest.core.config.AbstractProjectConfig
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import org.testcontainers.containers.PostgreSQLContainer
import java.sql.DriverManager

// One container per integration-test JVM, shared by every spec; no reusable cross-run state.
object TestPostgres {
    val container: PostgreSQLContainer<Nothing> = PostgreSQLContainer<Nothing>("postgres:17.6")
}

class ProjectConfig : AbstractProjectConfig() {
    override suspend fun beforeProject() {
        TestPostgres.container.start()
        println("Shared Postgres 17 fixture started for integration test project")
    }

    override suspend fun afterProject() {
        TestPostgres.container.stop()
        println("Shared Postgres fixture stopped")
    }
}

class PostgresTest :
    DescribeSpec({
        describe("shared Postgres fixture") {
            it("runs a real SQL query") {
                val db = TestPostgres.container
                println("Real Postgres fixture: ${db.dockerImageName}; running=${db.isRunning}")
                DriverManager.getConnection(db.jdbcUrl, db.username, db.password).use { connection ->
                    connection.createStatement().use { statement ->
                        statement.executeQuery("SELECT 1").use { result ->
                            result.next() shouldBe true
                            result.getInt(1) shouldBe 1
                        }
                    }
                }
            }
        }
    })
