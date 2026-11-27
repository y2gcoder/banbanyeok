package app.banbanyeok.server.room

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import liquibase.exception.LiquibaseException
import org.postgresql.util.PSQLException
import java.io.File

private const val GUARD = "20261128-participants-hidden-retired"
private const val OLD_GUARD = "participants_hidden_retired"

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

/** 복원한 DB를 운영에 붙이기 전에 돌리는 카탈로그 확인(scripts/db-guard-check.sql, docs/setup/p8a-notes.md 3.6절). */
private val guardCheck =
    File(requireNotNull(System.getProperty("changelog.dir")), "../../../scripts/db-guard-check.sql").readText()

private fun guardFailure(url: String): String? = runCatching { execute(url, guardCheck) }.exceptionOrNull()?.message

private fun migrateFailure(url: String): String {
    val failure = shouldThrow<LiquibaseException> { TestDatabase.migrate(url) }
    return generateSequence<Throwable>(failure) { it.cause }.joinToString(" | ") { it.message.orEmpty() }
}

private fun seedRoom(
    url: String,
    hidden: Boolean,
) {
    execute(
        url,
        "INSERT INTO rooms (id, host_hash, host_pid, mode, data_version, created_at, last_activity_at, " +
            "expires_at) VALUES ('abc0000001', '\\x00'::bytea, 'host01', 'fair', 'test', now(), now(), " +
            "now() - interval '1 day')",
    )
    execute(
        url,
        "INSERT INTO participants (room_id, pid, token_hash, nickname, origin_code, hidden, joined_at, " +
            "updated_at) VALUES ('abc0000001', 'host01', '\\x01'::bytea, '합성이름', '03v', $hidden, now(), now())",
    )
}

/** ADR-0012 3·4단계 전환과 복원 DB의 실제 열 확인. 운영과 같은 changeset을 적용한다. */
class HiddenColumnMigrationTest :
    DescribeSpec({
        it(
            "fails the migrate on a database that still holds a hidden participant, changes nothing, and passes once it is gone",
        ) {
            val url = TestDatabase.createDatabase("hidden_retired")
            TestDatabase.migrate(url, TestDatabase.changesetsBefore(GUARD))
            seedRoom(url, hidden = true)
            val before = scalar(url, "SELECT count(*) FROM databasechangelog")

            val message = migrateFailure(url)
            message shouldContain OLD_GUARD
            message shouldNotContain "합성이름"
            message shouldNotContain "abc0000001"

            scalar(url, "SELECT count(*) FROM databasechangelog") shouldBe before
            scalar(url, "SELECT count(*) FROM participants WHERE hidden") shouldBe "1"
            scalar(url, "SELECT count(*) FROM pg_constraint WHERE conname = 'participants_hidden_retired'") shouldBe "0"
            scalar(url, "SELECT count(*) FROM databasechangeloglock WHERE locked") shouldBe "0"

            execute(url, "DELETE FROM rooms WHERE expires_at < now()") shouldBe 1
            TestDatabase.migrate(url)
            guardFailure(url) shouldBe null
        }

        it("requires the actual verified step 3 constraint even if Liquibase has already recorded it") {
            val url = TestDatabase.createDatabase("guard_check")
            TestDatabase.migrate(url, TestDatabase.changesetsBefore(TestDatabase.DROP_HIDDEN_CHANGESET))
            seedRoom(url, hidden = false)
            val violation = shouldThrow<PSQLException> { execute(url, "UPDATE participants SET hidden = true") }
            violation.serverErrorMessage?.constraint shouldBe OLD_GUARD

            execute(url, "ALTER TABLE participants DROP CONSTRAINT $OLD_GUARD")
            execute(url, "UPDATE participants SET hidden = true")
            val corruptions =
                listOf(
                    null,
                    "CHECK (hidden IS NOT TRUE) NOT VALID",
                    "CHECK (true)",
                    "UNIQUE (room_id, pid)",
                )
            for (definition in corruptions) {
                if (definition != null) execute(url, "ALTER TABLE participants ADD CONSTRAINT $OLD_GUARD $definition")
                migrateFailure(url) shouldContain "requires the verified participants_hidden_retired CHECK"
                scalar(url, "SELECT count(*) FROM participants WHERE hidden") shouldBe "1"
                scalar(url, "SELECT id FROM databasechangelog ORDER BY orderexecuted DESC LIMIT 1") shouldBe GUARD
                if (definition != null) execute(url, "ALTER TABLE participants DROP CONSTRAINT $OLD_GUARD")
            }
        }

        it("keeps normal rows, rejects the legacy column reference, and reapplies without changes") {
            val url = TestDatabase.createDatabase("normal_restore")
            TestDatabase.migrate(url, TestDatabase.changesetsBefore(GUARD))
            seedRoom(url, hidden = false)
            guardFailure(url).orEmpty() shouldContain "public.participants.hidden still exists"

            val drop = TestDatabase.DROP_HIDDEN_CHANGESET
            repeat(2) {
                TestDatabase.migrate(url)
                guardFailure(url) shouldBe null
                scalar(url, "SELECT origin_code FROM participants") shouldBe "03v"
                scalar(url, "SELECT count(*) FROM databasechangelog WHERE id = '$drop'") shouldBe "1"
            }
            shouldThrow<PSQLException> { scalar(url, "SELECT hidden FROM participants") }.sqlState shouldBe "42703"
        }

        it("requires the physical table and column absence regardless of the migration history") {
            val url = TestDatabase.createDatabase("schema_check")
            guardFailure(url).orEmpty() shouldContain "public.participants table is missing"
            TestDatabase.migrate(url)
            guardFailure(url) shouldBe null
            execute(url, "ALTER TABLE participants ADD COLUMN hidden boolean DEFAULT false")
            TestDatabase.migrate(url)
            guardFailure(url).orEmpty() shouldContain "public.participants.hidden still exists"
        }
    })
