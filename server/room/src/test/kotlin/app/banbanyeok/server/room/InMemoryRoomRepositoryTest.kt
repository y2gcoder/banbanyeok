package app.banbanyeok.server.room

import io.kotest.core.spec.style.DescribeSpec

class InMemoryRoomRepositoryTest :
    DescribeSpec({
        include(
            "in-memory fake",
            roomRepositoryContract {
                val rooms = InMemoryRoomRepository()
                RepositoryPair(rooms, InMemoryAnonUserRepository(rooms))
            },
        )
    })
