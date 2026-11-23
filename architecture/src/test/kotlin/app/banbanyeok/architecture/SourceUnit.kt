package app.banbanyeok.architecture

import com.lemonappdev.konsist.api.declaration.KoFileDeclaration
import java.nio.file.Path

/**
 * 구조 규칙이 소스 한 파일에서 "무엇을 참조하는가"를 읽는 공용 도우미. import 선언만 보면 완전 수식 이름(`a.b.C.d()`)과 별칭
 * import(`import a.b.C as D`)로 우회되고, 글자 검색은 주석·문자열에서 오탐하므로 모든 참조 규칙이 이것을 쓴다.
 *
 * - 주석과 문자열(일반·raw·문자)의 글자 부분은 보지 않는다. 템플릿의 `${…}`와 `$이름`은 코드이므로 본다(`"${java.io.File(p).length()}"`).
 * - [references]: import(별칭이어도 원래 선언), 코드 본문의 완전 수식 이름, 와일드카드 import로 들어온 이름(`pkg.*` + 본문의 대문자 식별자).
 * - [calls]: 호출 식의 수신 체인을 원래 선언 이름으로 풀어 쓴 것(`Calendar.bundled()` → `…HolidayCalendar.bundled`).
 * - [relativePath]: 저장소 기준 상대 경로(`/` 구분). 허용 파일은 끝부분이 아니라 이 전체 경로로 비교한다.
 *
 * - 이름 풀기의 우선순위: 별칭·명시적 import·이 파일에 선언한 타입 이름이 와일드카드 후보보다 앞선다. 함수·클래스 선언(`fun A.b()`)은 호출이 아니다.
 *
 * 알려진 한계: 같은 패키지 안의 이름은 import가 없어 풀 수 없다(규칙은 다른 패키지·모듈 사이의 참조를 본다). 다른 파일에 선언한
 * typealias(허용된 패키지에 `typealias Catalog = …StationDirectory`를 두고 `Catalog`만 import)는 풀지 못한다. 리플렉션도 못 본다.
 */
class SourceUnit(
    path: String,
    text: String,
) {
    val relativePath: String = relativeToRepository(path)

    /** 주석과 문자열을 공백으로 지운 소스(줄 번호는 그대로). */
    val code: String = stripCommentsAndStrings(text)

    private val imports: List<Import> = IMPORT.findAll(code).map { it.toImport() }.toList()

    private val body: String = code.lines().joinToString("\n") { if (DECLARATION_LINE.containsMatchIn(it)) "" else it }

    private val aliases: Map<String, String> = imports.mapNotNull { i -> i.alias?.let { it to i.name } }.toMap()
    private val simpleNames: Map<String, String> =
        imports.filter { !it.wildcard && it.alias == null }.associate { it.name.substringAfterLast('.') to it.name }
    private val wildcardPackages: List<String> = imports.filter { it.wildcard }.map { it.name }

    /** 이 파일이 선언한 타입 이름. 와일드카드로 들어온 같은 이름보다 앞선다. */
    private val localNames: Set<String> = LOCAL_TYPE.findAll(body).map { it.groupValues[1] }.toSet()

    /**
     * 이 파일이 참조하는 선언의 완전 이름(import는 별칭이어도 원래 선언, 와일드카드는 `pkg.*`)과 코드 본문의 완전 수식 이름. 멤버까지 이어진
     * 체인은 처음 나오는 대문자 이름(클래스)까지만 남긴다.
     */
    val references: Set<String> by lazy {
        buildSet {
            imports.forEach { add(if (it.wildcard) "${it.name}.*" else it.name) }
            QUALIFIED.findAll(body).forEach { add(it.value.toClassLevel()) }
        }
    }

    /**
     * [references]에 더해, 와일드카드 import(`pkg.*`)로 들어왔을 수 있는 이름(`pkg.` + 본문의 대문자 식별자)까지. 금지 목록을 검사하는 규칙이
     * 쓴다. 허용 목록 규칙은 후보가 많아 오탐이 되므로 [references]를 쓴다(그쪽에서는 와일드카드 import 자체가 `pkg.*`로 걸린다).
     */
    val allReferences: Set<String> by lazy {
        references +
            if (wildcardPackages.isEmpty()) {
                emptySet()
            } else {
                CAPITALIZED
                    .findAll(body)
                    .map { it.value }
                    .filter { it !in aliases && it !in simpleNames && it !in localNames }
                    .flatMap { word -> wildcardPackages.map { "$it.$word" } }
                    .toSet()
            }
    }

    /** 호출 식(`a.b.C(…)`, `D.e(…)`)의 수신 체인. 첫 이름이 import한 것이면 원래 선언 이름으로 푼다. */
    val calls: Set<String> by lazy {
        buildSet {
            CALL.findAll(body).filterNot { declares(it) }.forEach { match ->
                val parts = match.groupValues[1].split('.').map { it.trim() }
                val rest = parts.drop(1).joinToString("") { ".$it" }
                resolve(parts.first()).forEach { add(it + rest) }
            }
        }
    }

    /** 다른 선언의 이름으로 [as]처럼 형 변환하는 대상(`x as Foo`, `x as? a.b.Foo`)을 원래 선언 이름으로 푼 것. */
    val castTargets: Set<String> by lazy {
        buildSet {
            CAST.findAll(body).forEach { match ->
                val parts = match.groupValues[1].split('.')
                resolve(parts.first()).forEach { add(it + parts.drop(1).joinToString("") { p -> ".$p" }) }
            }
        }
    }

    /** 이름 하나를 import로 풀어 원래 선언 이름 후보로. import로 풀 수 없으면 그대로. */
    private fun resolve(first: String): List<String> =
        aliases[first]?.let { listOf(it) }
            ?: simpleNames[first]?.let { listOf(it) }
            ?: if (first in localNames) {
                listOf(first)
            } else if (first.firstOrNull()?.isUpperCase() == true && wildcardPackages.isNotEmpty()) {
                wildcardPackages.map { "$it.$first" }
            } else {
                listOf(first)
            }

    /** 호출처럼 보이는 것이 사실은 선언인가(`fun HolidayCalendar.bundled()`, `class Foo(`). */
    private fun declares(match: MatchResult): Boolean =
        DECLARATION_KEYWORD.containsMatchIn(body.substring(0, match.range.first))

    private class Import(
        val name: String,
        val wildcard: Boolean,
        val alias: String?,
    )

    private fun MatchResult.toImport() =
        Import(
            groupValues[1],
            groupValues[2].isNotEmpty(),
            groupValues[3].ifEmpty {
                null
            },
        )

    companion object {
        private val IMPORT = Regex("""(?m)^\s*import\s+([\w.]+?)(\.\*)?(?:\s+as\s+(\w+))?\s*$""")
        private val DECLARATION_LINE = Regex("""^\s*(package|import)\s""")
        private val QUALIFIED =
            Regex("""(?<![\w.])(?:app|com|io|org|java|javax|kotlin|kotlinx|liquibase)(?:\s*\.\s*[A-Za-z_]\w*)+""")
        private val LOCAL_TYPE = Regex("""\b(?:class|interface|object|typealias)\s+([A-Z]\w*)""")
        private val DECLARATION_KEYWORD = Regex("""\b(?:fun|class|interface|object|typealias)\s*(?:<[^>]*>\s*)?\z""")
        private val CAPITALIZED = Regex("""(?<![\w.])[A-Z]\w*""")
        private val CALL = Regex("""(?<![\w.])([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*\(""")
        private val CAST = Regex("""\bas\??\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)""")

        private fun String.toClassLevel(): String {
            val parts = replace(Regex("""\s+"""), "").split('.')
            val firstClass = parts.indexOfFirst { it.first().isUpperCase() }
            return (if (firstClass < 0) parts else parts.take(firstClass + 1)).joinToString(".")
        }
    }
}

/** [name] 자신이거나 그 아래(`name.멤버`, `name.*`)인가. */
fun String.isOrUnder(name: String): Boolean = this == name || startsWith("$name.")

fun KoFileDeclaration.source() = SourceUnit(path, text)

private fun relativeToRepository(path: String): String {
    val root = Path.of("").toAbsolutePath().normalize()
    return root.relativize(Path.of(path).toAbsolutePath().normalize()).toString().replace('\\', '/')
}

/**
 * 주석(`//`, 중첩되는 `/* */`)과 문자 리터럴, 문자열(`"…"`, `"""…"""`)의 글자 부분을 공백으로 바꾼다. 줄바꿈은 남긴다.
 * 문자열 템플릿의 `${…}`(안의 중첩 문자열 포함)와 `$이름`은 코드라서 남긴다.
 */
internal fun stripCommentsAndStrings(src: String): String = SourceStripper(src).strip()

private class SourceStripper(
    private val src: String,
) {
    private val out = StringBuilder(src.length)
    private var i = 0

    fun strip(): String {
        scan(inTemplate = false)
        return out.toString()
    }

    /** 코드를 읽는다. 템플릿 안([inTemplate])이면 짝이 맞는 `}`에서 멈춘다. */
    private fun scan(inTemplate: Boolean) {
        var depth = 0
        while (i < src.length) {
            val c = src[i]
            when {
                src.startsWith("//", i) -> {
                    lineComment()
                }

                src.startsWith("/*", i) -> {
                    blockComment()
                }

                src.startsWith("\"\"\"", i) -> {
                    string(raw = true)
                }

                c == '"' -> {
                    string(raw = false)
                }

                c == '\'' -> {
                    charLiteral()
                }

                inTemplate && c == '}' && depth == 0 -> {
                    blank()
                    return
                }

                else -> {
                    if (c == '{') depth++
                    if (c == '}') depth--
                    out.append(c)
                    i++
                }
            }
        }
    }

    private fun blank() {
        out.append(if (src[i] == '\n') '\n' else ' ')
        i++
    }

    private fun blank(count: Int) = repeat(minOf(count, src.length - i)) { blank() }

    private fun lineComment() {
        while (i < src.length && src[i] != '\n') blank()
    }

    private fun blockComment() {
        var depth = 0
        do {
            when {
                src.startsWith("/*", i) -> {
                    depth++
                    blank(2)
                }

                src.startsWith("*/", i) -> {
                    depth--
                    blank(2)
                }

                else -> {
                    blank()
                }
            }
        } while (depth > 0 && i < src.length)
    }

    private fun charLiteral() {
        blank()
        while (i < src.length && src[i] != '\'') blank(if (src[i] == '\\') 2 else 1)
        blank(1)
    }

    /** 문자열의 글자를 지우되 `${…}`와 `$이름`은 코드로 남긴다. */
    private fun string(raw: Boolean) {
        val quote = if (raw) "\"\"\"" else "\""
        blank(quote.length)
        while (i < src.length && !src.startsWith(quote, i)) {
            when {
                !raw && src[i] == '\\' -> blank(2)
                src.startsWith("\${", i) -> braceTemplate()
                startsNameTemplate() -> nameTemplate()
                else -> blank()
            }
        }
        blank(quote.length)
    }

    private fun braceTemplate() {
        blank(2)
        scan(inTemplate = true)
    }

    private fun startsNameTemplate() =
        src[i] == '$' && i + 1 < src.length && (src[i + 1].isLetter() || src[i + 1] == '_')

    private fun nameTemplate() {
        blank()
        while (i < src.length && (src[i].isLetterOrDigit() || src[i] == '_')) out.append(src[i++])
    }
}
