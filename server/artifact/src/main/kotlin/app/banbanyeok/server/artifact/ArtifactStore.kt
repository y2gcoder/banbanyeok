package app.banbanyeok.server.artifact

/**
 * 저장소 안의 키. 슬래시로 구분한 세그먼트이며 세그먼트는 영문자·숫자로 시작하고 `A-Za-z0-9._-`만 쓴다.
 * 예: `manifest.json`, `versions/20261112.1/od.19cc73e7f8df1451.bin`. 어떤 저장소 구현에서도 같은 뜻이 되도록 중립적이다.
 */
@JvmInline
public value class ArtifactKey(
    public val value: String,
) {
    init {
        require(PATTERN.matches(value)) { "올바른 산출물 키가 아닙니다: '$value'" }
    }

    override fun toString(): String = value

    public companion object {
        private val PATTERN = Regex("^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$")

        public fun isValid(text: String): Boolean = PATTERN.matches(text)
    }
}

/**
 * 객체의 내용이 바뀔 때마다 달라지는 불투명한 버전 값. 구현마다 만드는 방법이 다르다(파일: 내용 해시, GCS: generation).
 * 값의 형식을 해석하지 말고 [ArtifactStore.get]이 준 값을 [ArtifactStore.put]의 `ifMatch`에 그대로 돌려준다.
 */
@JvmInline
public value class ArtifactVersion(
    public val token: String,
) {
    public companion object {
        /** 객체가 아직 없어야 한다는 조건. `put(ifMatch = ABSENT)`는 "새로 만들기"다. */
        public val ABSENT: ArtifactVersion = ArtifactVersion("")
    }
}

public class StoredArtifact(
    public val key: ArtifactKey,
    public val content: ByteArray,
    public val version: ArtifactVersion,
)

/** `ifMatch` 조건이 맞지 않아 쓰지 않았다. 다른 쪽이 먼저 바꿨다는 뜻이다. */
public class PreconditionFailedException(
    key: ArtifactKey,
) : RuntimeException("조건이 맞지 않아 쓰지 않았습니다: $key")

/**
 * 산출물 저장소 포트. 일부러 작게 둔다: 읽기, 조건부 쓰기, 접두사 목록.
 * GCS 전용 기능(수명주기, 서명 URL, 메타데이터 등)은 이 포트 밖으로 새지 않게 한다.
 */
public interface ArtifactStore {
    /** 없으면 null. */
    public suspend fun get(key: ArtifactKey): StoredArtifact?

    /**
     * 쓰고 새 버전을 돌려준다. [ifMatch]가 null이면 무조건 덮어쓴다. 값이 있으면 현재 버전이 같을 때만 쓰고,
     * [ArtifactVersion.ABSENT]이면 객체가 없을 때만 쓴다. 조건이 맞지 않으면 [PreconditionFailedException].
     */
    public suspend fun put(
        key: ArtifactKey,
        content: ByteArray,
        ifMatch: ArtifactVersion? = null,
    ): ArtifactVersion

    /** [prefix]로 시작하는 키를 사전순으로. */
    public suspend fun list(prefix: String = ""): List<ArtifactKey>
}
