package app.banbanyeok.server.room

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import liquibase.exception.LiquibaseException

private const val GUARD = "20261128-participants-hidden-retired"

private fun scalar(
    url: String,
    sql: String,
): String =
    TestDatabase.connect(url).use { connection ->
        connection.createStatement().use { statement ->
            statement.executeQuery(sql).use { rows ->
                rows.next()
                rows.getString(1)
            }
        }
    }

private fun execute(
    url: String,
    sql: String,
) = TestDatabase.connect(url).use { connection -> connection.createStatement().use { it.executeUpdate(sql) } }

/**
 * ADR-0012 3단계의 배포 관문: 숨긴 참가자 행이 남은 DB(예: 숨김을 받던 때의 백업을 되살린 DB)에서는 같은 migrate가 실패하고 아무것도 바꾸지
 * 않는다. 그 방이 정리된 뒤에는 통과한다. 제약을 `NOT VALID`로 바꾸면 이 테스트가 실패한다.
 */
class HiddenRetiredMigrationTest :
    DescribeSpec({
        it(
            "fails the migrate on a database that still holds a hidden participant, changes nothing, and passes once it is gone",
        ) {
            val url = TestDatabase.createDatabase("hidden_retired")
            TestDatabase.migrate(url, TestDatabase.changesetsBefore(GUARD))
            execute(
                url,
                "INSERT INTO rooms (id, host_hash, host_pid, mode, data_version, created_at, last_activity_at, " +
                    "expires_at) VALUES ('abc0000001', '\\x00'::bytea, 'host01', 'fair', 'test', now(), now(), " +
                    "now() + interval '1 day')",
            )
            execute(
                url,
                "INSERT INTO participants (room_id, pid, token_hash, nickname, origin_code, hidden, joined_at, " +
                    "updated_at) VALUES ('abc0000001', 'host01', '\\x01'::bytea, '숨긴민수', '03v', true, now(), now())",
            )
            val before = scalar(url, "SELECT count(*) FROM databasechangelog")

            val failure = shouldThrow<LiquibaseException> { TestDatabase.migrate(url) }
            val message = generateSequence<Throwable>(failure) { it.cause }.joinToString(" | ") { it.message.orEmpty() }
            message shouldContain "participants_hidden_retired"
            message shouldNotContain "숨긴민수"
            message shouldNotContain "abc0000001"

            scalar(url, "SELECT count(*) FROM databasechangelog") shouldBe before
            scalar(url, "SELECT count(*) FROM participants WHERE hidden") shouldBe "1"
            scalar(url, "SELECT count(*) FROM pg_constraint WHERE conname = 'participants_hidden_retired'") shouldBe "0"
            scalar(url, "SELECT count(*) FROM databasechangeloglock WHERE locked") shouldBe "0"

            execute(url, "DELETE FROM rooms WHERE id = 'abc0000001'")
            TestDatabase.migrate(url)
            scalar(url, "SELECT convalidated FROM pg_constraint WHERE conname = 'participants_hidden_retired'") shouldBe
                "t"
            TestDatabase.migrate(url)
        }
    })
