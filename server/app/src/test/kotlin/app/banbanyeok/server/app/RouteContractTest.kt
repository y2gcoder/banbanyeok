package app.banbanyeok.server.app

import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe
import io.ktor.server.routing.HttpMethodRouteSelector
import io.ktor.server.routing.PathSegmentConstantRouteSelector
import io.ktor.server.routing.PathSegmentParameterRouteSelector
import io.ktor.server.routing.RootRouteSelector
import io.ktor.server.routing.RoutingNode
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import io.swagger.v3.parser.OpenAPIV3Parser
import java.nio.file.Path

/** 응답 표본만 검증해서는 문서에 없는 엔드포인트나 사라진 구현을 발견하지 못한다. */
class RouteContractTest :
    DescribeSpec({
        it("registers exactly the OpenAPI operations, including the gated anonymous endpoint") {
            val spec = Path.of(requireNotNull(System.getProperty("contracts.dir")), "openapi.yaml")
            val contract = requireNotNull(OpenAPIV3Parser().read(spec.toString()))
            val prefix =
                contract.servers
                    .single()
                    .url
                    .trimEnd('/')
            val documented =
                contract.paths
                    .flatMap { (path, item) ->
                        item.readOperationsMap().keys.map { "${it.name} $prefix$path" }
                    }.toSet()
            testApplication {
                val registered = mutableSetOf<String>()
                application {
                    apiModule(testConfig(mapOf("ANON_ENABLED" to "true")), MockedServices().api())
                    registered += routing {}.operations()
                }
                startApplication()
                // /healthz는 Cloud Run 점검용으로 /v1/healthz와 같은 핸들러를 노출하는 유일한 별칭이다.
                ("GET /healthz" in registered) shouldBe true
                ("GET /v1/healthz" in registered) shouldBe true
                (registered - "GET /healthz" - documented) shouldBe emptySet()
                (documented - registered) shouldBe emptySet()
            }
        }
    })

/** 모르는 selector를 조용히 무시하면 새 라우트 종류가 계약 검사에서 빠지므로 실패시킨다. */
private fun RoutingNode.operations(segments: List<String> = emptyList()): Set<String> {
    val next =
        when (val part = selector) {
            is RootRouteSelector -> segments
            is PathSegmentConstantRouteSelector -> segments + part.value
            is PathSegmentParameterRouteSelector -> segments + "{${part.name}}"
            is HttpMethodRouteSelector -> segments
            else -> error("Unsupported route selector: $selector")
        }
    return buildSet {
        (selector as? HttpMethodRouteSelector)?.let { add("${it.method.value} /${next.joinToString("/")}") }
        children.forEach { addAll(it.operations(next)) }
    }
}
