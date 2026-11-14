package app.banbanyeok.server.room

import app.banbanyeok.server.room.exposed.ExposedAnonUserRepository
import app.banbanyeok.server.room.exposed.ExposedRoomRepository
import io.kotest.core.config.AbstractProjectConfig
import io.kotest.core.spec.style.DescribeSpec

class ProjectConfig : AbstractProjectConfig() {
    override suspend fun afterProject() = TestDatabase.stop()
}

// 메모리 fake와 같은 계약을 실제 Postgres(Exposed)로 돌린다.
class ExposedRoomRepositoryTest :
    DescribeSpec({
        include(
            "Exposed on Postgres",
            roomRepositoryContract {
                RepositoryPair(
                    ExposedRoomRepository(TestDatabase.database),
                    ExposedAnonUserRepository(TestDatabase.database),
                )
            },
        )
    })
