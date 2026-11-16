# W4 노트 — 익명 ID 정리, 방 해시, `/v1/anon` 닫기, 오류 추적·웹 바이탈

작업일 2026-11-16. 배경: 코디네이터 감사(운영자 승인). 웹은 익명 사용자(`anon_users`, 기기 토큰, `POST /v1/anon`)를 쓰지 않는데(R1 결정, r1-notes 2절)
처리방침은 수집한다고 적었고, 반대로 통계 '방' 행의 방 해시·참여까지 걸린 시간은 적어 두고 보내지 않았다.

## 1. 처리방침 정합

- 익명 사용자 ID·기기 토큰 해시: "앱(Android·iOS)에서 방 기능을 쓰는 경우(현재 웹은 해당 없음)"로 고쳤다(2항 방 항목·통계 공통·토큰 설명, 4항 보유 기간, 7항 Supabase). 11항은 원래 "웹은 기기 토큰을 쓰지 않는다"였다.
- 통계 '방' 행: 이제 실제로 보낸다(아래 2절). 문구를 "서버만 아는 비밀 키로 바꾼 값"으로 정확히 했다.
- 오류·속도: 2항 동의 항목·통계 표("오류·속도" 행), 1항 목적, 7항 위탁·국외 이전 항목에 추가했다(아래 4절).
- 통계 삭제 요청: "요청하면 지체 없이 삭제"를 "지체 없이 삭제를 요청·진행하되 통계 도구의 일괄 삭제 일정에 따라 몇 주 걸릴 수 있음"으로(2항 철회, 4항 통계 보유, 8항 권리 표 3곳 같은 문장). 절차는 [posthog-deletion-runbook.md](posthog-deletion-runbook.md). **수익화 전 변호사 검토 항목.**
- 동의 문구: 항목 ①을 "기능·오류·속도 기록"으로 바꿔 `CONSENT_VERSION` 3 → 4(대조표 p7-notes). v3에 동의한 기기도 다시 묻는다.

## 2. 방 해시(`room_hash`)와 `seconds_since_room_created`

- 계약(events.json)이 이미 "서버가 계산해 응답에 실어 주는 값을 그대로 쓴다"였으므로 서버가 계산한다: 하위 키 `roomKey = HMAC-SHA256(TOKEN_PEPPER, "banbanyeok/room_hash/v1")`를 한 번 유도하고 `HMAC-SHA256(roomKey, 방 ID)`의 앞 8바이트(16 hex). `TokenService.roomHash`.
  - 방 ID는 10자 base32(50비트)라 키 없는 SHA-256은 전수 대입으로 되돌릴 수 있다. 키를 서버 비밀로 두어 클라이언트에 솔트를 두는 한계를 피했다. 통계 도구(PostHog)·값을 본 사람은 방 ID를 알 수 없다.
  - 운영자는 pepper와 방 ID가 있으면 맞춰 볼 수 있으므로 여전히 개인정보로 다룬다(가명정보 아님, docs/legal/privacy-policy-review.md의 `room_hash` 행과 같음). 방이 지워지면 맞춰 볼 방 ID가 없다.
  - 하위 키로 토큰 해시 키와 나눴다(리뷰 반영: 처음엔 같은 pepper에 접두사만 붙였다. 운영에 쌓인 해시가 없을 때 바꿔 비용이 없다). pepper나 라벨을 바꾸면 해시도 바뀐다(바꾸기 전후 방을 통계에서 잇지 못할 뿐).
- 계약: `Room.roomHash`, `Room.createdAt`, `RoomCreated.roomHash`(선택 필드, 옛 서버는 없음). 웹은 16자리 hex가 아니거나 방 ID를 담은 값이면 보내지 않는다(`lib/analytics/room.ts`).
- 붙이는 이벤트: `room_created`, `participant_joined`(+`seconds_since_room_created`), `outcome_answered`, 방 링크의 `share_clicked`, 방 결과의 `result_viewed`. `link_opened(room)`은 웹이 보내지 않는다(계약상 서버 몫).
- `seconds_since_room_created`는 방 응답의 `createdAt`과 기기 시계로 센다(느리면 0). 서버가 통계를 보내기 시작하면 서버 값으로 바꾼다.

## 3. `/v1/anon` 닫기

- 서버 설정 `ANON_ENABLED`(기본 `false`, `true`/`false`만). 끄면 라우트를 등록하지 않아 404 `NOT_FOUND`(없는 경로와 같다). 서버 코드·`anon_users` 테이블·정리 작업은 그대로.
- 웹 프록시(`/api/v1/*`)는 경로를 가리지 않고 넘기므로 서버의 404가 그대로 간다(proxy.test.ts에 확인 추가). 배포 설정은 바꿀 것이 없다(변수가 없으면 꺼짐).
- 기기 토큰을 Bearer로 주며 방을 만드는 경로(`hostAnonId`)는 남아 있지만, 발급이 닫혀 있어 웹 방은 항상 NULL이다. 앱 출시 때 켜고 방침 2·4·11항을 갱신한다.

## 4. PostHog 오류 추적·웹 바이탈 (운영자 승인 2026-11-16)

- `posthog-js` 1.447.3(lockfile, 새 의존성 없음)의 옵션: `capture_exceptions: {capture_unhandled_errors, capture_unhandled_rejections: true, capture_console_errors: false}`,
  `capture_performance: {web_vitals: true, web_vitals_attribution: false, network_timing: false}`, `logs.captureConsoleLogs: false`. 근거: `@posthog/types` 1.421.1 `posthog-config.d.ts`(`ExceptionAutoCaptureConfig`, `PerformanceCaptureConfig`).
- `no-external` 빌드는 확장을 CDN에서 받지 않으므로 `posthog-js/dist/exception-autocapture`·`posthog-js/dist/web-vitals`를 SDK와 함께 동적 import한다(init 전에 `__PosthogExtensions__` 등록). 원인 요소(attribution)를 끈 기본 web-vitals 판이다.
- 동의 전에는 그대로 아무것도 없다: SDK를 불러오지 않으니 오류 처리기도 붙지 않는다. 동의한 기기는 페이지를 열 때(`Providers` → `startAnalytics`) SDK를 불러와 이벤트가 없는 페이지의 오류도 잡는다.
- before_send(`redact.ts`, 객체 키 포함, 방 API 경로 `/rooms/[room]`도 가림): `$` 이벤트는 계약 `sdkEvents`의 `$exception`·`$web_vitals`만 남기고 버린다. 이 둘은 모든 문자열(메시지, 스택의 파일 경로·함수, 중첩된 `$web_vitals_*_event`의 주소)에서 쿼리·해시 삭제, `/r/[room]`·`/meet/[pair]`, Bearer 토큰, 43자 토큰 모양, 이 기기가 아는 방 ID·토큰(보는 방 + `bby.room.*`)을 가린다. 공통 속성(platform·app_version)을 붙인다.
- 한계: 오류 메시지에 주소 밖의 역 이름·별명이 평문으로 들어가면 가리지 못한다(우리 코드는 그런 메시지를 만들지 않는다). 3자 역 코드는 너무 짧아 주소 규칙으로만 가린다.
- 무료 한도: 오류 추적 월 100,000건, 이벤트(웹 바이탈 포함) 월 1,000,000건(매월 초기화). 출처 https://posthog.com/pricing , https://posthog.com/error-tracking/pricing (2026-11-16 확인). 한도를 넘었을 때 무료 플랜의 처리(수집 중단 여부)는 이 두 쪽에서 확인하지 못했으므로, 운영자가 결제 설정에서 사용량 알림을 켜 둔다.
- 웹 바이탈은 동의한 바로 그 페이지에서는 켜지 않는다(리뷰 반영). SDK는 페이지가 열린 뒤 찍힌 LCP·FCP를 버퍼에서 꺼내 보내므로 그 페이지에서 켜면 동의 전 수치가 나간다. 그 페이지(클라이언트 이동 포함)는 건너뛰고 다음 페이지 로드부터 잰다. 오류 추적은 동의 직후부터 켠다(동의 전 오류는 처리기가 없어 남지 않는다).
- 콘솔 로그·네트워크 타이밍·세션 녹화·autocapture·pageview는 계속 끔. **켜려면 처리방침 통계 항목과 동의 문구를 먼저 갱신해야 한다**(콘솔 로그·네트워크 타이밍에 주소·방 ID가 들어갈 수 있다).

## 남은 일

- 앱 출시 때: `ANON_ENABLED=true`, 방침 익명 사용자 항목 갱신, 앱의 `anon_user_id` 공통 속성.
- 서버가 통계를 보내기 시작하면 `room_created`·`participant_joined`의 웹 전송을 끄고 서버의 정확한 경과 초를 쓴다.
- PostHog 프로젝트에서 Error tracking 화면이 켜져 있는지(이벤트는 들어가도 화면은 프로젝트 설정) 운영자가 확인.
