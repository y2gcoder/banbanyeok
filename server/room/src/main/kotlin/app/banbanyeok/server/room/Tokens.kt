package app.banbanyeok.server.room

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

public class SecureRandomIdGenerator(
    private val random: SecureRandom = SecureRandom(),
) : IdGenerator {
    override fun roomId(): String = base32(ROOM_ID_LENGTH)

    override fun participantId(): String = base32(PARTICIPANT_ID_LENGTH)

    override fun anonUserId(): String = "u_" + base32(ANON_ID_LENGTH)

    override fun token(): String {
        val bytes = ByteArray(TOKEN_BYTES).also(random::nextBytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun base32(length: Int): String = String(CharArray(length) { ALPHABET[random.nextInt(ALPHABET.length)] })

    private companion object {
        const val ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"
        const val ROOM_ID_LENGTH = 10
        const val PARTICIPANT_ID_LENGTH = 6
        const val ANON_ID_LENGTH = 26
        const val TOKEN_BYTES = 32
    }
}

public class IssuedToken(
    public val plain: String,
    public val hash: TokenHash,
)

/**
 * 토큰을 HMAC-SHA256(pepper, token)으로 해시한다. 토큰이 256비트 무작위라 느린 해시는 필요 없고,
 * pepper는 DB만 유출됐을 때 해시를 오프라인에서 추측하지 못하게 한다. pepper는 설정으로 주입한다.
 */
public class TokenService(
    pepper: ByteArray,
    private val ids: IdGenerator,
) {
    private val key = SecretKeySpec(pepper.copyOf(), ALGORITHM)

    init {
        require(pepper.isNotEmpty()) { "pepper가 비어 있습니다" }
    }

    public fun issue(): IssuedToken = ids.token().let { IssuedToken(it, hash(it)) }

    public fun hash(token: String): TokenHash =
        TokenHash(Mac.getInstance(ALGORITHM).apply { init(key) }.doFinal(token.toByteArray(Charsets.UTF_8)))

    private companion object {
        const val ALGORITHM = "HmacSHA256"
    }
}
