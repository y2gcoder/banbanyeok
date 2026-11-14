package app.banbanyeok.server.app

import com.atlassian.oai.validator.OpenApiInteractionValidator
import com.atlassian.oai.validator.model.Request
import com.atlassian.oai.validator.model.SimpleResponse
import io.kotest.matchers.shouldBe
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpMethod
import java.nio.file.Path

/**
 * 응답이 contracts/openapi.yaml과 맞는지 검증한다(OpenAPI 3.1 지원 라이브러리 `openapi-request-validator`).
 * 문서에 없는 상태 코드, 다른 Content-Type, 스키마에 맞지 않는 본문이 모두 실패다.
 */
object OpenApiContract {
    private val validator: OpenApiInteractionValidator by lazy {
        val spec = Path.of(requireNotNull(System.getProperty("contracts.dir")), "openapi.yaml")
        OpenApiInteractionValidator.createForSpecificationUrl(spec.toUri().toString()).build()
    }

    /** 문서에 정의된 응답이면 통과. 실패 메시지에 검증 오류 전체를 싣는다. */
    suspend fun assertValid(
        method: HttpMethod,
        path: String,
        response: HttpResponse,
    ) = assertValid(method, path, response.status.value, response.headers["Content-Type"], response.bodyAsText())

    fun assertValid(
        method: HttpMethod,
        path: String,
        status: Int,
        contentType: String?,
        body: String,
    ) {
        val builder = SimpleResponse.Builder.status(status)
        // 문서의 content 타입 비교는 파라미터(charset)를 제외한다.
        contentType?.let { builder.withContentType(it.substringBefore(';').trim()) }
        if (body.isNotEmpty()) builder.withBody(body)
        val report = validator.validateResponse(path, Request.Method.valueOf(method.value), builder.build())
        val errors =
            report.messages.filter { it.level.name == "ERROR" }.joinToString(
                "\n",
            ) { "${it.key}: ${it.message}" }
        errors shouldBe ""
    }
}
