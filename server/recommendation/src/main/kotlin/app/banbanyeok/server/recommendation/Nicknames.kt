package app.banbanyeok.server.recommendation

import app.banbanyeok.links.NicknameRules

/** 요청 별칭의 검증. 표시 이름은 shared/app-logic `ParticipantLabels`가 만든다(contracts/data-format.md §8). */
internal object Nicknames {
    /** 공백만 있으면 없는 것으로 보고, 코드포인트 20자 이하이며 짝 없는 서로게이트·제어 문자가 없어야 한다. */
    fun isValid(nickname: String): Boolean {
        val trimmed = nickname.trim()
        return trimmed.isEmpty() ||
            (
                NicknameRules.isWellFormed(trimmed) &&
                    NicknameRules.codePointCount(trimmed) <= NicknameRules.MAX_CODE_POINTS &&
                    trimmed.none { Character.isISOControl(it) }
            )
    }
}
