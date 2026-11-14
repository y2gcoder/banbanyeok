package app.banbanyeok.server.room

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * 방 만료 규칙(tech-stack 5.6, 종합 4절): 마지막 활동 후 7일(슬라이딩), 생성 후 최대 30일.
 * 약속일이 있으면 약속일 다음 날 0시(한국 시간)에 만료한다(최대 30일). 읽을 때 만료를 판정하고 정리 명령이 실제로 지운다.
 */
public object ExpiryPolicy {
    public val SLIDING: Duration = Duration.ofDays(7)
    public val MAXIMUM: Duration = Duration.ofDays(30)
    public val ZONE: ZoneId = ZoneId.of("Asia/Seoul")

    public fun expiresAt(
        createdAt: Instant,
        lastActivityAt: Instant,
        meetingDate: LocalDate?,
    ): Instant {
        val base = meetingDate?.plusDays(1)?.atStartOfDay(ZONE)?.toInstant() ?: lastActivityAt.plus(SLIDING)
        return minOf(base, createdAt.plus(MAXIMUM))
    }

    public fun isExpired(
        room: Room,
        now: Instant,
    ): Boolean = !now.isBefore(room.expiresAt)

    /** 오늘(한국 시간)보다 이전인 약속일은 받지 않는다. */
    public fun isValidMeetingDate(
        date: LocalDate,
        now: Instant,
    ): Boolean = !date.isBefore(now.atZone(ZONE).toLocalDate())
}
