package app.banbanyeok.server.room

import java.time.Clock

public data class IssuedAnonUser(
    val anonUserId: String,
    val deviceToken: String,
)

/** 익명 사용자 발급. 기기 토큰은 해시만 저장한다. 로그인은 후속 단계(L1)에서 이 사용자에 계정을 연결한다. */
public class AnonUserService(
    private val anonUsers: AnonUserRepository,
    private val tokens: TokenService,
    private val ids: IdGenerator,
    private val clock: Clock,
) {
    public suspend fun issue(): IssuedAnonUser {
        val token = tokens.issue()
        val id = ids.anonUserId()
        val now = clock.instant()
        anonUsers.create(AnonUser(id, token.hash, now, now))
        return IssuedAnonUser(id, token.plain)
    }
}
