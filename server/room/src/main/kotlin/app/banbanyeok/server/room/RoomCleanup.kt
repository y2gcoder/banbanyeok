package app.banbanyeok.server.room

import java.time.Clock
import java.time.Duration

/**
 * 만료된 방과 오래 쓰지 않은 익명 사용자를 실제로 지운다. 만료 판정은 읽을 때 이미 하고 있으므로 이것은 저장 공간과
 * 개인정보 보존 기간을 지키기 위한 운영 명령이다. 서버는 scale-to-zero라 백그라운드 스케줄러를 믿을 수 없어
 * 서버 시작과 분리된 명령(`cleanup`)으로 실행한다.
 */
public class RoomCleanup(
    private val rooms: RoomRepository,
    private val anonUsers: AnonUserRepository,
    private val clock: Clock,
) {
    public suspend fun run(): CleanupReport {
        val now = clock.instant()
        return CleanupReport(rooms.deleteExpired(now), anonUsers.deleteInactive(now.minus(ANON_RETENTION)))
    }

    private companion object {
        val ANON_RETENTION: Duration = Duration.ofDays(90)
    }
}
