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
