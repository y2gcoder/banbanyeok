package app.banbanyeok.applogic

/**
 * 사람의 표시 이름. 별칭이 있으면 그대로, 없으면(null·공백) 입력 순서대로 "나/친구1/친구2/친구3"이다
 * (contracts/data-format.md §7: 별칭이 없는 링크의 화면 표시).
 */
public object DisplayNames {
    public val DEFAULTS: List<String> = listOf("나", "친구1", "친구2", "친구3")

    public fun resolve(people: List<PersonRef>): List<String> =
        people.mapIndexed { index, person ->
            person.name?.takeIf { it.isNotBlank() }
                ?: DEFAULTS.getOrElse(index) { "친구$index" }
        }
}
