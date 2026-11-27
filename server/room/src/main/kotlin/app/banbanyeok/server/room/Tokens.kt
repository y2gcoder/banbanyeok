package app.banbanyeok.server.room

import java.security.SecureRandom
import java.util.Base64
import java.util.HexFormat
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

    /** 방 해시 전용 하위 키 = HMAC(pepper, [ROOM_HASH_KEY_LABEL]). 토큰 해시와 같은 키를 쓰지 않도록 한 번 유도해 둔다. */
    private val roomKey = SecretKeySpec(mac(key, ROOM_HASH_KEY_LABEL), ALGORITHM)

    /** 채운 사다리 방 토큰 전용 하위 키 = HMAC(pepper, [CREATOR_KEY_LABEL]). 토큰 해시·방 해시 키와 분리한다. */
    private val creatorKey = SecretKeySpec(mac(key, CREATOR_KEY_LABEL), ALGORITHM)

    public fun issue(): IssuedToken = ids.token().let { IssuedToken(it, hash(it)) }

    /**
     * 채운 사다리 방(#227)의 방장 토큰과 방장 참여자 토큰. 만든 기기의 복구 키와 서버 비밀로 정해지는 값이라, 응답을 잃은 기기가 같은
     * 키로 다시 요청할 때마다(인스턴스·순서와 상관없이) 같은 토큰을 다시 돌려줄 수 있다. 서버는 이 원문을 저장하지 않고 늘 다시 계산한다.
     * [role]은 토큰 종류(방장·참여자), [subject]는 방 ID와 참여자 ID다. 무작위 토큰과 같은 형식(32바이트 base64url)이다.
     */
    public fun creatorToken(
        role: String,
        subject: String,
        recoveryKey: String,
    ): IssuedToken {
        val bytes = mac(creatorKey, "$role\u0000$subject\u0000$recoveryKey")
        val plain = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        return IssuedToken(plain, hash(plain))
    }

    public fun hash(token: String): TokenHash = TokenHash(mac(token))

    /**
     * 통계 이벤트의 `room_hash`(contracts/events.json): HMAC-SHA256(roomKey, 방 ID)의 앞 8바이트(16 hex). roomKey는 pepper에서
     * 라벨 "banbanyeok/room_hash/v1"로 유도한 하위 키라 토큰 해시 키와 분리된다(방 해시 값이 토큰 해시 키에 대한 HMAC 출력이 되지 않는다).
     * 방 ID는 10자 base32(50비트)라 키 없는 해시는 전수 대입으로 되돌릴 수 있으므로 서버 비밀로 키를 건다. 통계 도구(PostHog)는
     * 이 값으로 방 ID를 알아낼 수 없고, 운영자도 데이터베이스에서 방이 지워지면 맞춰 볼 방 ID가 없다.
     * pepper나 라벨을 바꾸면 같은 방의 해시도 바뀐다(통계에서 바꾸기 전후 방을 잇지 못할 뿐 기능에는 영향 없음).
     */
    public fun roomHash(roomId: String): String = HexFormat.of().formatHex(mac(roomKey, roomId), 0, ROOM_HASH_BYTES)

    private fun mac(input: String): ByteArray = mac(key, input)

    private fun mac(
        with: SecretKeySpec,
        input: String,
    ): ByteArray = Mac.getInstance(ALGORITHM).apply { init(with) }.doFinal(input.toByteArray(Charsets.UTF_8))

    private companion object {
        const val ALGORITHM = "HmacSHA256"
        const val ROOM_HASH_KEY_LABEL = "banbanyeok/room_hash/v1"
        const val CREATOR_KEY_LABEL = "banbanyeok/draw_room_creator/v1"
        const val ROOM_HASH_BYTES = 8
    }
}
