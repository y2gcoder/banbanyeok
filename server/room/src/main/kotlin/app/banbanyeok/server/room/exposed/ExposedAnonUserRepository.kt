package app.banbanyeok.server.room.exposed

import app.banbanyeok.server.room.AnonUser
import app.banbanyeok.server.room.AnonUserRepository
import app.banbanyeok.server.room.TokenHash
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.core.less
import org.jetbrains.exposed.v1.core.notInSubQuery
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.jetbrains.exposed.v1.jdbc.update
import java.time.Instant

public class ExposedAnonUserRepository(
    private val database: Database,
    private val ioDispatcher: CoroutineDispatcher,
) : AnonUserRepository {
    override suspend fun create(user: AnonUser) =
        inTransaction {
            AnonUsersTable.insert {
                it[id] = user.id
                it[deviceHash] = user.deviceHash.bytes
                it[createdAt] = user.createdAt
                it[lastSeenAt] = user.lastSeenAt
            }
            Unit
        }

    override suspend fun findByDeviceHash(hash: TokenHash): AnonUser? =
        inTransaction {
            AnonUsersTable
                .selectAll()
                .where { AnonUsersTable.deviceHash eq hash.bytes }
                .singleOrNull()
                ?.let {
                    AnonUser(
                        it[AnonUsersTable.id],
                        TokenHash(it[AnonUsersTable.deviceHash]),
                        it[AnonUsersTable.createdAt],
                        it[AnonUsersTable.lastSeenAt],
                    )
                }
        }

    override suspend fun touch(
        id: String,
        at: Instant,
    ) = inTransaction {
        AnonUsersTable.update({ AnonUsersTable.id eq id }) { it[lastSeenAt] = at }
        Unit
    }

    override suspend fun deleteInactive(lastSeenBefore: Instant): Int =
        inTransaction {
            val referencedByRooms = RoomsTable.select(RoomsTable.hostAnonId).where { RoomsTable.hostAnonId.isNotNull() }
            val referencedByParticipants =
                ParticipantsTable.select(ParticipantsTable.anonId).where {
                    ParticipantsTable.anonId.isNotNull()
                }
            AnonUsersTable.deleteWhere {
                (lastSeenAt less lastSeenBefore) and (id notInSubQuery referencedByRooms) and
                    (id notInSubQuery referencedByParticipants)
            }
        }

    private suspend fun <T> inTransaction(block: () -> T): T =
        withContext(ioDispatcher) { transaction(database) { block() } }
}
