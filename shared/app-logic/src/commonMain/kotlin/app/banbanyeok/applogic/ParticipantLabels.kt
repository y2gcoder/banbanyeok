package app.banbanyeok.applogic

/** 표시 이름을 무엇으로 만들었는가. 응답의 `labelKind`(소문자)와 같다. */
public enum class LabelKind { NAME, ORIGIN, ORDINAL }

/** 참가자 한 명의 표시 이름. */
public data class ParticipantLabel(
    val text: String,
    val kind: LabelKind,
)

/**
 * 참가자 표시 이름 규칙(contracts/data-format.md §8, 벡터는 contracts/golden/display-labels.json). 서버가 이 규칙으로 만들어 응답에
 * 넣고 웹·앱은 그대로 쓴다. 추천 이유 문장([ReasonGenerator])과 극단 상황 문구([SituationAdvisor])도 같은 이름을 쓴다.
 *
 * 1. 사람이 이름(별칭)을 넣었으면 앞뒤 공백을 뺀 그 이름([LabelKind.NAME]).
 * 2. 없으면 "{출발역 이름}에서 오는 분"([LabelKind.ORIGIN]). 같은 출발역 이름이 이 규칙을 쓰는 사람 중에 여럿이면 입력 순서대로
 *    " 1", " 2"를 붙인다. 이름을 넣은 사람과 숨긴 사람은 세지 않는다(숨긴 사람의 출발역이 번호로 드러나지 않게).
 * 3. 출발역을 숨긴 참가자(또는 출발역 이름을 모르는 참가자)는 "참가자 {목록 안 순번}"([LabelKind.ORDINAL]). 순번은 1부터다.
 *
 * 익명 사용자 ID·참가자 ID 같은 내부 식별자는 쓰지 않는다(여러 방에 걸쳐 같은 사람을 이어 볼 수 있게 되므로).
 * "나/너" 같은 시점 표현도 쓰지 않는다. 보는 사람 표시("(나)")는 클라이언트가 붙인다.
 */
public object ParticipantLabels {
    /** [people]의 순서 = 입력(참여) 순서. [PersonRef.originName]이 null이면 숨긴 참가자로 본다. */
    public fun of(people: List<PersonRef>): List<ParticipantLabel> {
        val names = people.map { it.name?.trim()?.takeIf(String::isNotEmpty) }
        val origins =
            people.mapIndexed {
                i,
                person,
                ->
                person.originName?.takeIf { names[i] == null && it.isNotBlank() }
            }
        val seen = HashMap<String, Int>()
        return people.indices.map { i ->
            val name = names[i]
            val origin = origins[i]
            when {
                name != null -> ParticipantLabel(name, LabelKind.NAME)
                origin != null -> {
                    val base = "${origin}에서 오는 분"
                    val text =
                        if (origins.count { it == origin } > 1) {
                            val nth = seen.getOrElse(origin) { 0 } + 1
                            seen[origin] = nth
                            "$base $nth"
                        } else {
                            base
                        }
                    ParticipantLabel(text, LabelKind.ORIGIN)
                }
                else -> ParticipantLabel("참가자 ${i + 1}", LabelKind.ORDINAL)
            }
        }
    }
}
