package app.banbanyeok.server.recommendation

import app.banbanyeok.links.NicknameRules

/**
 * 추천 이유 문장에 쓰는 사람 이름. 같은 문장을 여러 사람이 서로 다른 시점에서 읽으므로(링크를 받은 사람, 방 참여자) "나/너" 같은
 * 시점 표현은 쓰지 않는다. 별칭이 있으면 그대로, 없으면 입력(참여) 순서대로 A, B, C, D다. 같은 별칭이 둘 이상이면 "민수(A)"처럼
 * 글자를 붙여 구별한다. "보는 사람 표시(나)"는 클라이언트의 몫이다.
 */
internal object SentenceNames {
    private const val LETTERS = "ABCD"

    /** 별칭 규칙: 공백만 있으면 없는 것으로 보고, 코드포인트 20자 이하이며 짝 없는 서로게이트·제어 문자가 없어야 한다. */
    fun isValid(nickname: String): Boolean {
        val trimmed = nickname.trim()
        return trimmed.isEmpty() ||
            (
                NicknameRules.isWellFormed(trimmed) &&
                    NicknameRules.codePointCount(trimmed) <= NicknameRules.MAX_CODE_POINTS &&
                    trimmed.none { Character.isISOControl(it) }
            )
    }

    fun of(people: List<RecommendParticipant>): List<String> {
        val nicknames = people.map { it.nickname?.trim()?.takeIf { name -> name.isNotEmpty() } }
        return nicknames.mapIndexed { index, nickname ->
            val letter = LETTERS[index].toString()
            when {
                nickname == null -> letter
                nicknames.count { it == nickname } > 1 -> "$nickname($letter)"
                else -> nickname
            }
        }
    }
}
