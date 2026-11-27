@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.banbanyeok.server.room

import app.banbanyeok.server.room.exposed.ExposedAnonUserRepository
import app.banbanyeok.server.room.exposed.ExposedRoomRepository
import io.kotest.core.config.AbstractProjectConfig
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.coroutines.test.UnconfinedTestDispatcher

class ProjectConfig : AbstractProjectConfig() {
    override suspend fun afterProject() = TestDatabase.stop()
}

// 메모리 fake와 같은 계약을 실제 Postgres(Exposed)로 돌린다. 지금 스키마와, participants.hidden을 지운 ADR-0012 4단계 모양 둘 다다:
// 이 판의 저장소 SQL이 그 열을 참조하면(selectAll 포함) 4단계 모양에서 실패한다.
class ExposedRoomRepositoryTest :
    DescribeSpec({
        include(
            "Exposed on Postgres",
            roomRepositoryContract {
                RepositoryPair(
                    ExposedRoomRepository(TestDatabase.database, UnconfinedTestDispatcher()),
                    ExposedAnonUserRepository(TestDatabase.database, UnconfinedTestDispatcher()),
                )
            },
        )
        include(
            "Exposed on Postgres without participants.hidden (ADR-0012 step 4 shape)",
            roomRepositoryContract {
                RepositoryPair(
                    ExposedRoomRepository(TestDatabase.step4Database, UnconfinedTestDispatcher()),
                    ExposedAnonUserRepository(TestDatabase.step4Database, UnconfinedTestDispatcher()),
                )
            },
        )
    })
