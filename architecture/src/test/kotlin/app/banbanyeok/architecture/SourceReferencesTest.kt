package app.banbanyeok.architecture

import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldNotContain
import io.kotest.matchers.shouldBe

/** 구조 규칙이 쓰는 참조 도우미 자체의 테스트. PR #99 검토가 찾은 우회 네 가지를 회귀 사례로 고정한다. */
class SourceReferencesTest :
    DescribeSpec({
        val app = "app.banbanyeok.server.app"
        val rec = "app.banbanyeok.server.recommendation"

        fun unit(
            body: String,
            path: String = "server/app/src/main/kotlin/app/banbanyeok/server/app/http/Sample.kt",
        ) = SourceUnit(path, "package $app.http\n\n$body")

        describe("references the import list alone would miss") {
            it("sees fully qualified Liquibase references without an import") {
                val source = unit("val migration: liquibase.Liquibase? = null")
                source.references shouldContain "liquibase.Liquibase"
            }

            it("sees a fully qualified type used in the body (StationDirectory.nameOf)") {
                val source = unit("val n = $app.application.StationDirectory.nameOf(\"x\")")
                source.references shouldContain "$app.application.StationDirectory"
            }
            it("sees a fully qualified call to the recommendation service (RecommendationService.evaluate)") {
                val source =
                    unit("suspend fun f(s: $rec.RecommendationService) = $rec.RecommendationService.evaluate(r)")
                source.references shouldContain "$rec.RecommendationService"
            }
            it("sees a fully qualified enum entry (RecommendationError.UNKNOWN_STATION)") {
                val source = unit("val code = $rec.RecommendationError.UNKNOWN_STATION")
                source.references shouldContain "$rec.RecommendationError"
            }
            it("sees a fully qualified construction of another package's type (http.ErrorDto)") {
                val source = unit("val dto = $app.http.ErrorDto(\"c\", \"m\")", "x/application/Sample.kt")
                source.references shouldContain "$app.http.ErrorDto"
                source.calls shouldContain "$app.http.ErrorDto"
            }
            it("resolves an import alias to the original declaration") {
                val source =
                    unit(
                        """
                        import $rec.time.HolidayCalendar as Calendar
                        import $rec.time.TimeSlotResolver as Resolver

                        val resolver = Resolver(Calendar.bundled())
                        """.trimIndent(),
                    )
                source.references shouldContain "$rec.time.TimeSlotResolver"
                source.calls shouldContain "$rec.time.TimeSlotResolver"
                source.calls shouldContain "$rec.time.HolidayCalendar.bundled"
            }
            it("resolves a wildcard import to the names used in the body") {
                val source = unit("import $app.application.*\n\nval d: StationDirectory? = null")
                source.references shouldContain "$app.application.*"
                source.allReferences shouldContain "$app.application.StationDirectory"
                source.references shouldNotContain "$app.application.StationDirectory"
            }
            it("resolves the target of a cast through an alias") {
                val source = unit("import $app.application.BackgroundSlots as Slots\n\nval s = port as? Slots")
                source.castTargets shouldContain "$app.application.BackgroundSlots"
            }
        }

        describe("what is not code") {
            it("ignores comments, KDoc and strings") {
                val source =
                    unit(
                        """
                        /** TimeSlotResolver(calendar)를 만든다. $rec.RecommendationService.evaluate 를 부르지 않는다. */
                        // $app.application.StationDirectory
                        /* nested /* $rec.RecommendationError */ still comment $rec.RecommendationError */
                        val text = "$rec.RecommendationError and Foo(1) \" $app.http.ErrorDto"
                        val raw = ${"\"\"\""}$app.application.StationDirectory(${"\"\"\""}
                        val quote = '"'
                        """.trimIndent(),
                    )
                source.references.filter { it.startsWith("app.banbanyeok.") } shouldBe emptyList()
                source.calls shouldNotContain "TimeSlotResolver"
                source.calls shouldNotContain "Foo"
            }
        }

        describe("string templates") {
            // 회귀(PR #99 재검토): 문자열을 통째로 지우면 `${…}` 안의 실제 파일 접근이 R5 검사를 통과했다.
            it("sees code inside a template, but not the literal text around it") {
                val real =
                    unit("internal fun cacheInfo(path: String) = \"size in bytes: \${java.io.File(path).length()}\"")
                real.references shouldContain "java.io.File"
                real.calls shouldContain "java.io.File"
                val constant = unit("internal val note = \"java.io.File\"")
                constant.references.filter { it.startsWith("java.") } shouldBe emptyList()
                constant.calls shouldNotContain "java.io.File"
            }
            it("sees a template in a raw string, a nested string and a simple name template") {
                val raw = unit("val a = \"\"\"x \${java.nio.file.Files.size(p)} java.io.File\"\"\"")
                raw.references shouldContain "java.nio.file.Files"
                raw.references shouldNotContain "java.io.File"
                val nested = unit("val b = \"a \${f(\"} java.io.File\")} \${java.net.URL(u)}\"")
                nested.references shouldContain "java.net.URL"
                nested.references shouldNotContain "java.io.File"
                val simple = unit("import java.io.File as Disk\n\nval c = \"\$Disk.length\"")
                simple.references shouldContain "java.io.File"
            }
            it("keeps the code after a template as code") {
                val source = unit("val d = \"\${1 + 1}\" + $app.http.ErrorDto(\"c\", \"m\").code")
                source.calls shouldContain "$app.http.ErrorDto"
            }
        }

        describe("names that look like references but are not") {
            it("prefers an explicit import, an alias and a local declaration over a wildcard import") {
                val source =
                    unit(
                        """
                        import $app.application.*
                        import other.pkg.StationDirectory
                        import other.pkg.Thing as Resolver

                        class LocalName

                        val a = StationDirectory()
                        val b = Resolver()
                        val c = LocalName()
                        val d: CanonicalStations? = null
                        """.trimIndent(),
                    )
                source.allReferences shouldNotContain "$app.application.StationDirectory"
                source.allReferences shouldNotContain "$app.application.Resolver"
                source.allReferences shouldNotContain "$app.application.LocalName"
                source.allReferences shouldContain "$app.application.CanonicalStations"
                source.calls shouldContain "other.pkg.StationDirectory"
                source.calls shouldNotContain "$app.application.StationDirectory"
            }
            it("does not count a function or class declaration as a call") {
                val source =
                    unit(
                        """
                        import $rec.time.HolidayCalendar

                        fun HolidayCalendar.bundled() = nameOf(day)
                        fun <T> HolidayCalendar.other(x: T) = x
                        class Holder(val a: Int)
                        val real = HolidayCalendar.bundled()
                        """.trimIndent(),
                    )
                source.calls shouldContain "$rec.time.HolidayCalendar.bundled"
                source.calls shouldNotContain "$rec.time.HolidayCalendar.other"
                source.calls shouldNotContain "Holder"
                val onlyDeclared =
                    unit("import $rec.time.HolidayCalendar\n\nfun HolidayCalendar.bundled() = nameOf(day)")
                onlyDeclared.calls shouldNotContain "$rec.time.HolidayCalendar.bundled"
            }
        }

        describe("the path an exception file is matched by") {
            it("is the whole repository-relative path, so a deeper file of the same name is not the exception") {
                val errors = "server/app/src/main/kotlin/app/banbanyeok/server/app/http/Errors.kt"
                unit("", errors).relativePath shouldBe errors
                unit("", "server/app/src/main/kotlin/app/banbanyeok/server/app/application/deep/http/Errors.kt")
                    .relativePath shouldBe
                    "server/app/src/main/kotlin/app/banbanyeok/server/app/application/deep/http/Errors.kt"
            }
        }
    })
