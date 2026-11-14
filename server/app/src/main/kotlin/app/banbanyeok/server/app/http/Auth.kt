package app.banbanyeok.server.app.http

import io.ktor.http.HttpHeaders
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.header

private const val MAX_TOKEN_LENGTH = 256

/**
 * `Authorization: Bearer <token>`에서 토큰을 꺼낸다. 헤더가 없거나 형식이 다르면 null(익명).
 * 토큰이 어떤 종류인지(deviceToken, hostToken, participantToken)는 엔드포인트가 정한다. 토큰은 로그에 남기지 않는다.
 */
fun ApplicationCall.bearerToken(): String? {
    val header = request.header(HttpHeaders.Authorization) ?: return null
    val (scheme, value) = header.split(' ', limit = 2).let { it.first() to it.getOrNull(1) }
    if (!scheme.equals("Bearer", ignoreCase = true)) return null
    return value?.trim()?.takeIf { it.isNotEmpty() && it.length <= MAX_TOKEN_LENGTH }
}
