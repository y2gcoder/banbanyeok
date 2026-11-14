package app.banbanyeok.applogic

import app.banbanyeok.links.NicknameRules
import app.banbanyeok.schema.StationCode

/** [ReasonInput]과 사람 목록의 입력 검증. 첫 번째 오류 하나만 돌려주고, 문제가 없으면 null이다. */
public object ReasonInputValidator {
    public const val MIN_PEOPLE: Int = 2
    public const val MAX_PEOPLE: Int = 4

    /** 사람 목록 검증: 인원 2~4명, ID 비어 있지 않음·중복 없음, 별칭 길이(코드포인트 20자), 출발역 코드 형식. */
    public fun validatePeople(people: List<PersonRef>): InputErrorCode? {
        if (people.size !in MIN_PEOPLE..MAX_PEOPLE) return InputErrorCode.PEOPLE_COUNT
        return validateIds(people) ?: validateNames(people) ?: validateOrigins(people)
    }

    private fun validateIds(people: List<PersonRef>): InputErrorCode? {
        val seen = HashSet<String>()
        for (person in people) {
            if (person.id.isBlank()) return InputErrorCode.BLANK_PERSON_ID
            if (!seen.add(person.id)) return InputErrorCode.DUPLICATE_PERSON
        }
        return null
    }

    private fun validateNames(people: List<PersonRef>): InputErrorCode? {
        for (person in people) {
            val name = person.name ?: continue
            if (!NicknameRules.isWellFormed(name)) return InputErrorCode.NICKNAME_MALFORMED
            if (NicknameRules.codePointCount(name) > NicknameRules.MAX_CODE_POINTS) {
                return InputErrorCode.NICKNAME_TOO_LONG
            }
        }
        return null
    }

    private fun validateOrigins(people: List<PersonRef>): InputErrorCode? =
        if (people.any { it.originCode?.let { code -> StationCode.parseOrNull(code) == null } == true }) {
            InputErrorCode.BAD_STATION_CODE
        } else {
            null
        }

    public fun validate(input: ReasonInput): InputErrorCode? {
        validatePeople(input.people.map { it.person })?.let { return it }
        return when {
            StationCode.parseOrNull(input.stationCode) == null -> {
                InputErrorCode.BAD_STATION_CODE
            }

            input.stationName.isBlank() -> {
                InputErrorCode.EMPTY_STATION_NAME
            }

            input.people.any { it.seconds < 0 || it.transfers < 0 } || input.toleranceSeconds < 0 -> {
                InputErrorCode.NEGATIVE_VALUE
            }

            input.rank !in 1..ReasonInput.MAX_RANK -> {
                InputErrorCode.RANK_OUT_OF_RANGE
            }

            input.reasonCode.mode != input.mode || input.reasonCode.isAlternative != (input.rank > 1) -> {
                InputErrorCode.REASON_CODE_MISMATCH
            }

            else -> {
                validateAggregates(input)
                    ?: input.comparison?.let { validateComparison(input, it) } ?: validateFavor(input)
            }
        }
    }

    private fun validateAggregates(input: ReasonInput): InputErrorCode? {
        val seconds = input.people.map { it.seconds }
        if (input.maxSeconds != seconds.max() || input.spreadSeconds != seconds.max() - seconds.min() ||
            input.totalSeconds != seconds.sum()
        ) {
            return InputErrorCode.AGGREGATE_MISMATCH
        }
        return null
    }

    private fun validateComparison(
        input: ReasonInput,
        comparison: Comparison,
    ): InputErrorCode? {
        val expectedRank = if (input.rank == 1) 2 else 1
        return when {
            comparison.rank != expectedRank || comparison.rank > ReasonInput.MAX_RANK -> {
                InputErrorCode.COMPARISON_MISMATCH
            }

            comparison.timesSeconds.size != input.people.size || comparison.timesSeconds.any { it < 0 } -> {
                InputErrorCode.COMPARISON_MISMATCH
            }

            comparison.stationName.isBlank() -> {
                InputErrorCode.EMPTY_STATION_NAME
            }

            StationCode.parseOrNull(comparison.stationCode) == null -> {
                InputErrorCode.BAD_STATION_CODE
            }

            else -> {
                null
            }
        }
    }

    private fun validateFavor(input: ReasonInput): InputErrorCode? {
        val favor = input.favor
        if ((input.mode == ReasonMode.FAVOR) != (favor != null)) return InputErrorCode.FAVOR_CONTEXT_MISSING
        if (favor == null) return null
        val count = input.people.size
        val badDimensions =
            favor.index !in 0 until count ||
                favor.baselineTimesSeconds.size != count || favor.capSeconds.size != count
        val badValues = favor.baselineTimesSeconds.any { it < 0 } || favor.capSeconds.any { it != null && it < 0 }
        if (badDimensions || badValues) {
            return InputErrorCode.FAVOR_CONTEXT_INVALID
        }
        return null
    }
}
