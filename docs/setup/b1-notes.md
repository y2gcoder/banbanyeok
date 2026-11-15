# B1: 결과 화면에서 "빨리 만나기"·"누구 쪽으로"가 안 나오던 버그

## 원인
운영에서 브라우저가 `/api/v1/*`로 보내는 POST·PATCH·DELETE는 모두 서버(Ktor CORS)에서 **403**(빈 HTML 본문)이었다.
- 브라우저는 같은 출처 요청이어도 POST에는 `Origin`을 붙인다. Worker 프록시(`src/lib/proxy`)가 그 헤더를 서버로 그대로 넘겼다.
- 운영 서버의 `CORS_ALLOWED_ORIGINS`는 설정되지 않아 "허용 출처 없음" 기본값(`https://web.banbanyeok.invalid`)이다(p8a-notes: P8b가 도메인을 정하면 설정하기로 했으나 아직 안 됨). Ktor CORS는 허용 목록 밖의 Origin을 403으로 거절한다.
- `/result`의 첫 결과(공평하게)는 서버 컴포넌트가 서버를 직접 불러 받아 `Origin`이 없어 통과했다. 탭을 바꿀 때만 브라우저가 POST하므로 그때만 실패했다. 요청 모양(모드 값, favorIndex)·응답 스키마·URL 상태는 정상이었다.
- 같은 이유로 **방 만들기·참여·수정·삭제·만났나 답(POST/PATCH/DELETE)도 운영에서 403**이었다(GET은 Origin이 없어 통과).
- 오류 화면에 문구가 없던 이유: 403 본문이 계약의 `{code, message}`가 아니라 빈 HTML이라 `message`가 빈 문자열이었다.

## 수정
- 프록시가 `Origin`을 서버로 넘기지 않는다(서버 간 호출이라 CORS가 필요 없다). 서버 변수 설정에 기대지 않는다.
- `failure()`가 계약 밖 본문(빈 문자열·HTML)을 `UNKNOWN`으로 다루고, 결과·방 오류 화면은 서버 message·code·HTTP 상태를 보이지 않고 상태별 짧은 문구(`src/lib/api/errors.ts`)를 보인다.

## 왜 가짜 서버 e2e·e2e-real이 놓쳤나
- 가짜 서버(mock)는 CORS를 흉내 내지 않는다.
- 로컬·CI의 실제 서버는 `scripts/dev.sh`가 허용 목록에 웹 주소를 넣고, 웹은 Worker가 아닌 Next rewrite로 서버를 부른다(운영과 다른 경로).
- 이 차이는 프록시 단위 테스트(`proxy.test.ts`)가 지킨다. 운영과 같은 조건 재현: 서버를 `CORS_ALLOWED_ORIGINS=https://web.banbanyeok.invalid`로 띄우고 `pnpm cf:build` 후 `wrangler dev --var API_ORIGIN:<서버>`로 Worker를 띄워 `REAL_WEB_URL`로 `e2e-real`을 돌린다. 수정 전 Next rewrite 경로는 모드 조합·방 만들기가 403으로 실패하고, Worker 경로는 모두 통과한다.

## 확인한 것
- `/s`(받은 링크)는 `/result`와 같은 화면이라 같은 문제였고 같이 고쳐졌다. `/r/[id]` 방 결과도 같은 클라이언트 호출이라 같다.
- "누구 쪽으로"는 대상 없이 요청하지 않는다: 탭을 누르면 가장 오래 걸리는 사람이 대상으로 선택되고 고르는 줄이 나온다(요청에 `favorIndex`가 실린다).
- 한 사람의 출발역이 후보(시간 0)인 응답도 화면이 처리한다(`e2e-real/modes.spec.ts`).
