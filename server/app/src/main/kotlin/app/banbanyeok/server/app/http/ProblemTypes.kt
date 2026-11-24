package app.banbanyeok.server.app.http

/**
 * 오류 `code` → `title`(RFC 9457 Problem Details). 원본 표는 contracts/problems.json이고, 웹의 /problems 페이지가 같은 표를 보여 준다.
 * 표의 `source: proxy` 코드(웹 프록시가 만드는 `UPSTREAM_*`)는 서버가 내지 않으므로 여기에 없다. 나머지가 같은지는 ProblemTypesTest가 본다.
 * 표에 없는 code는 [FALLBACK_TITLE]을 쓴다(새 code를 넣고 표를 빠뜨리면 그 테스트가 실패한다).
 */
internal object ProblemTypes {
    const val BASE_URI = "https://banbanyeok.app/problems/"
    const val FALLBACK_TITLE = "요청을 처리하지 못함"

    val titles: Map<String, String> =
        mapOf(
            "INVALID_REQUEST" to "요청 형식이 올바르지 않음",
            "INVALID_STATION" to "계산할 수 없는 출발역",
            "INVALID_PEOPLE_COUNT" to "참가자 수가 올바르지 않음",
            "INVALID_MODE" to "모드가 올바르지 않음",
            "FAVOR_TARGET_REQUIRED" to "우대 대상이 필요함",
            "FAVOR_TARGET_UNKNOWN" to "우대 대상이 참가자에 없음",
            "FAVOR_TARGET_HIDDEN" to "숨긴 사람 쪽 결과는 본인만 봄",
            "INVALID_NICKNAME" to "별칭이 올바르지 않음",
            "INVALID_MEETING_DATE" to "약속일이 올바르지 않음",
            "INVALID_MEETING_TIME" to "약속 시각이 올바르지 않음",
            "INVALID_MEETING_BAND" to "약속 시간대가 올바르지 않음",
            "INVALID_TIME_SLOT" to "시간 구분이 올바르지 않음",
            "INVALID_EXPECTED_COUNT" to "예상 인원이 올바르지 않음",
            "INVALID_OUTCOME" to "답이 올바르지 않음",
            "INVALID_IDEMPOTENCY_KEY" to "Idempotency-Key가 올바르지 않음",
            "UNAUTHORIZED" to "인증이 필요함",
            "FORBIDDEN" to "할 수 없는 작업",
            "CORS_REJECTED" to "허용되지 않는 출처",
            "ROOM_NOT_FOUND" to "방을 찾을 수 없음",
            "PARTICIPANT_NOT_FOUND" to "참가자를 찾을 수 없음",
            "NOT_FOUND" to "찾을 수 없음",
            "METHOD_NOT_ALLOWED" to "허용되지 않는 메서드",
            "NOT_ACCEPTABLE" to "요청한 응답 형식이 없음",
            "ROOM_FULL" to "방이 가득 참",
            "ROOM_LOCKED" to "방이 잠김",
            "NOT_ENOUGH_PARTICIPANTS" to "참가자가 부족함",
            "STATION_UNAVAILABLE" to "출발역을 지금 쓸 수 없음",
            "ROOM_CHANGED" to "그사이 방이 바뀜",
            "PAYLOAD_TOO_LARGE" to "요청이 너무 큼",
            "UNSUPPORTED_MEDIA_TYPE" to "지원하지 않는 요청 형식",
            "RATE_LIMITED" to "요청이 너무 많음",
            "INTERNAL_ERROR" to "서버 오류",
        )

    /** `type` URI: code를 kebab-case로 바꿔 붙인다(`ROOM_FULL` → `.../room-full`). */
    fun typeUri(code: String): String = BASE_URI + code.lowercase().replace('_', '-')

    fun title(code: String): String = titles[code] ?: FALLBACK_TITLE
}
