# P8b 웹 배포 작업 노트 (Cloudflare Workers + OpenNext)

검증일: 2026-11-14. 범위: 배포 워크플로, `/api/*` 프록시, 보안 헤더, 정식 도메인(banbanyeok.app), 크기·CPU 실측, 실제 주소 검증.
서버(Cloud Run, P8a)는 이 작업의 범위가 아니다.

## 한눈에

- 배포는 `.github/workflows/deploy-web.yml`(수동 + main push 때 `deploy.yml`이 서버와 순서를 맞춰 호출, 실패하면 직전 Worker 버전으로 자동 되돌림: [d104-notes.md](d104-notes.md)). **https://banbanyeok.app 에 배포·검증 완료**(www와 workers.dev는 301로 정식 주소로 이동).
- `/api/*`는 Next를 거치지 않고 Worker 진입점(`web/worker.ts`)이 서버로 바로 프록시한다. 신뢰 헤더 규칙·오류 응답은 `web/src/lib/proxy/`.
- **무료 플랜에는 맞지 않는다**: 동적 OG(`/s/og`)는 CPU 한도(10ms)를 넘어 `exceededCpu`(503)로 실패하고, 서버 렌더 페이지(`/s`, `/result`)도 중앙값이 10ms를 넘는다. 권고: Workers 유료(월 $5). 아래 "결정 필요".
- 검색 노출은 **꺼 둔 채** 배포했다(`SITE_INDEX` 출시 스위치). 개인정보처리방침이 아직 초안이라서다.

## 1. 배포 파이프라인

```
pnpm install --frozen-lockfile
 → 배포 설정 결정(변수 검증: SITE_DOMAIN, SERVER_ORIGIN, SITE_INDEX)
 → pnpm cf:build                 NEXT_PUBLIC_POSTHOG_KEY/HOST, NEXT_PUBLIC_APP_VERSION(커밋 SHA 7자), SITE_URL, SITE_NOINDEX, API_ORIGIN
 → opennextjs-cloudflare populateCache remote   (정적 증분 캐시를 정적 자산에 채움)
 → wrangler deploy --secrets-file … --var API_ORIGIN:… --var CANONICAL_HOST:… --domain <도메인> --domain www.<도메인>
 → scripts/smoke-deploy.sh       배포된 주소를 직접 확인
```

- **동시 배포 방지**: `concurrency: deploy-web`(진행 중인 배포는 취소하지 않고 대기열로).
- **비밀**: `PROXY_SHARED_SECRET`은 `--secrets-file`로 배포와 함께 원자적으로 주입한다. 파일에는 `${PROXY_SHARED_SECRET}` 참조만 쓰고 wrangler가 환경 변수에서 읽는다(디스크에 값이 남지 않음). `CLOUDFLARE_API_TOKEN`은 배포 단계에만 노출한다.
- **변수 검증**: `SITE_DOMAIN`(호스트만)·`SERVER_ORIGIN`(https 출처만) 형식이 틀리면 배포 전에 실패한다. 값은 스크립트 본문에 끼워 넣지 않고 환경 변수로만 읽는다(주입 방지).
- **SERVER_ORIGIN 없이도 배포된다**: `API_ORIGIN`이 비면 프록시가 503(`UPSTREAM_NOT_CONFIGURED`)을 낸다. 정적 페이지·SEO·OG(조합)는 서버 없이 동작한다.
- **도메인**: `SITE_DOMAIN`이 있으면 Workers Custom Domain(apex + www)으로 붙이고 `SITE_URL=https://<도메인>`, `CANONICAL_HOST=<도메인>`을 넣는다. 없으면 workers.dev만(SITE_URL 없음 → noindex). Cloudflare가 DNS 레코드·인증서를 만든다(첫 배포에서 스모크 테스트가 1회 재시도 후 통과, 약 10초).
- **리디렉트**: Worker가 `CANONICAL_HOST`와 다른 호스트(www, workers.dev) 또는 http로 온 요청을 정식 https 주소로 보낸다. GET·HEAD는 301, 그 밖의 메서드는 308(메서드 유지).
- **스모크 테스트**(`web/scripts/smoke-deploy.sh`, 로컬에서도 `BASE_URL=… bash scripts/smoke-deploy.sh`): `/`·`/privacy`·`/meet`·sitemap·조합 페이지·정적 OG(image/png)·robots(색인 허용/차단 일치)·noindex 메타·보안 헤더·`/api/healthz`, 서버가 연결돼 있으면 추천 API·동적 OG(`/s/og`)·`/s` 미리보기 메타, 그리고 http/www/workers.dev 리디렉트.
- **수동 CPU 실측**: Actions의 Run workflow에서 `measure`를 켜면 배포 뒤 `wrangler tail`로 경로별 CPU를 재고 계정 분석(GraphQL)과 함께 요약에 남긴다(`web/scripts/measure-cpu.ts`).
- 새 서드파티 액션은 없다(기존 ci.yml과 같은 SHA 고정). main에 들어오기 전에 PR의 CI(`ci-ok`)를 통과하므로 배포 워크플로는 다시 테스트를 돌리지 않는다.

### 버전 근거
새 의존성이 없다(`wrangler` 4.158.0, `@opennextjs/cloudflare` 1.20.16은 P4에서 7일 규칙으로 고정됨). 사용한 wrangler 기능은 설치된 4.158.0의 `wrangler deploy --help`에서 확인했다: `--secrets-file`, `--var`, `--domain`, `--message`, `--tag`.

## 2. 프록시 (`web/worker.ts`, `web/src/lib/proxy/`)

| 항목 | 동작 |
|---|---|
| 경로 | `/api/v1/*` → `<API_ORIGIN>/v1/*`, `/api/healthz` → `<API_ORIGIN>/v1/healthz`. `..` 같은 경로 우회는 프록시하지 않는다 |
| 신뢰 헤더 | 요청에서 `x-banbanyeok-*`를 **모두 지우고** `X-Banbanyeok-Proxy-Secret`(Worker secret)과 `X-Banbanyeok-Client-IP`(`CF-Connecting-IP`)를 다시 쓴다. 비밀이나 IP가 없으면 둘 다 보내지 않는다 |
| 지우는 헤더 | `cookie`, `host`, `x-forwarded-*`, `x-real-ip`, `forwarded`, `true-client-ip`, `cf-*`, 홉 간 헤더. `authorization`(방 토큰)·`idempotency-key`·`content-type`은 그대로 |
| 응답 | 서버 응답을 그대로 돌려주되 `set-cookie`와 신뢰 헤더는 걸러 낸다. 리다이렉트는 따라가지 않는다(`manual`) |
| 오류 | 서버 주소 없음 503 `UPSTREAM_NOT_CONFIGURED`, 연결 실패 502 `UPSTREAM_UNAVAILABLE`, **15초** 시간 초과 504 `UPSTREAM_TIMEOUT` — 모두 계약의 오류 형식 `{code, message}`, `cache-control: no-store` |
| 서버 컴포넌트 호출 | `/s`·`/result`·`/s/og`가 서버를 직접 부를 때도 같은 헤더를 붙인다(비밀 + 방문자 IP를 `next/headers`의 `cf-connecting-ip`에서). 안 붙이면 모든 SSR 호출이 Cloudflare 출구 IP 하나로 보여 서버의 IP별 레이트 리밋이 방문자들을 한꺼번에 막는다 |

- **실제 확인**(로컬 `wrangler dev` + 헤더를 되돌려 주는 스텁): 브라우저가 보낸 위조 `X-Banbanyeok-Client-IP`·`Proxy-Secret`·`Cookie`는 서버에 닿지 않고 `CF-Connecting-IP` 값과 Worker secret으로 대체된다. SSR(`/s`)의 서버 호출도 같은 IP·비밀을 실어 간다. (비밀은 길이만 확인.)
- **실제 배포 확인**: `https://banbanyeok.app/api/v1/…`로 방 만들기(201) → 참여(출발역 숨김, 201) → 결과(200, 후보 3개)가 서버(P8a)까지 정상. 서버가 신뢰 헤더를 쓰는지는 P8a 소관이며 이 흐름이 막히지 않는 것까지 확인했다.
- **/healthz 예약**: Cloud Run 앞단이 루트 `/healthz`를 앱에 닿기 전에 404로 막는다(P8a 실측). 프록시·`next.config.ts` rewrite·가짜 서버는 `/v1/healthz`를 쓴다(계약상 같은 응답). 입력 화면의 미리 깨우기(`/api/healthz`)는 배포 주소에서 200 `ok`.
- **서버 오류 때 사용자가 보는 것**: 결과 화면이 "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요." + [다시 시도]·[출발역 바꾸기]를 보인다(502/503/504 모두, e2e `upstream-error.spec.ts`). 4xx는 서버의 `message`를 그대로 보인다(기존 동작).
- **콜드스타트**: 입력 화면이 열릴 때 `/api/healthz`로 깨운다. 프록시 경유 `/api/healthz`는 워밍 후 0.8초 안팎(개발 머신에서, 서울까지 왕복 포함).

## 3. 크기·CPU 실측

### 번들 크기 (`wrangler deploy` 출력, 2026-11-14)

| 항목 | 값 | 무료 한도 |
|---|---|---|
| Worker 크기 | **11,715 KiB / gzip 2,539 KiB** | gzip 3 MiB(3,072 KiB) → **여유 약 533 KiB(17%)** |
| 정적 자산 | 959개 | 파일 수 20,000, 파일당 25 MiB |

P5 대비(11,107 / 2,374 KiB) +166 KiB(gzip)는 프록시 진입점·보안 헤더·`next/headers` 추가분이다. 조합 SEO 페이지가 늘면 조합당 raw 약 4.6 KiB가 더해진다(gzip 약 1 KiB 안팎으로 추정). 300쌍을 더하면 한도에 닿는다.

### 요청당 CPU (실제 배포 주소, GitHub Actions 러너에서 경로당 20회, `wrangler tail`의 `cpuTime`)

2026-11-14, 마지막 측정(서버 연결됨). tail은 일부 이벤트를 싣지 않아(정적 자산 응답 포함) "tail 이벤트" 수가 요청 수보다 적다. 단위 ms.

| 경로 | 클라이언트 상태 | tail 이벤트 | CPU 첫 이벤트 | CPU 중앙값 | CPU p90 | CPU 최대 | 벽시계 중앙값 |
|---|---|---|---|---|---|---|---|
| `/` | 200×20 | 17 | 253 | 11 | 253 | 282 | 18 |
| `/privacy` | 200×20 | 7 | 27 | 21 | 27 | 27 | 32 |
| `/meet` | 200×20 | 8 | 37 | 30 | 46 | 46 | 43 |
| `/meet/<조합>` (정적 SEO) | 200×20 | 7 | 39 | 10 | 39 | 39 | 18 |
| `/robots.txt` | 200×20 | 9 | 0 | 8 | 91 | 91 | 22 |
| `/sitemap.xml` | 200×20 | 6 | 10 | 10 | 16 | 16 | 25 |
| `/s?…` (SSR + 서버 호출) | 200×20 | 14 | 427 | 43 | 258 | 427 | 354 |
| **`/s/og?…` (동적 OG)** | **503×2, 405×17, 200×1** | 7 | 10 | 10 | 685 | 685 | 12 |
| `/api/healthz` (프록시) | 200×20 | 13 | 7 | 2 | 3 | 7 | 208 |

계정 분석(`workersInvocationsAdaptive`, 같은 기간 207건): CPU **p50 12.8 ms, p90 91.6 ms, p99 297 ms**, `exceededResources` 2건(10 ms에서 중단).

읽는 법과 한계:
- **한도(10ms)는 실제로 적용된다.** `/s/og`는 `outcome=exceededCpu`(cpu 10 ms에서 중단)로 클라이언트에 503이 나갔고, 뒤따른 반복 요청 17건은 **405**를 받았다(같은 기간 개발 머신에서 URL을 바꿔 천천히 25번 요청했을 때는 모두 200, 벽시계 0.6~2.3초). CPU 한도를 넘긴 격리 환경이 망가진 상태로 남는 것으로 보이며 원인은 확정하지 못했다. 어느 쪽이든 공유 링크 미리보기(카카오톡 크롤러 등)가 간헐적으로 깨질 수 있다는 뜻이다.
- 격리 환경의 **첫 요청은 CPU 250~690ms**(서버 번들 로드)다. 무료 한도로는 통과할 수 없는 값인데 요청이 성공한 경우가 많았다. Cloudflare는 한도를 요청마다 엄격히 자르지 않고 격리 환경의 누적 사용량으로 판단하는 것으로 보인다. 그래서 무료 플랜에서는 **간헐적 실패**가 나는 형태가 된다.
- **서버 렌더 경로**(`/s`, `/result`)는 서버 호출이 I/O라 벽시계는 길어도 CPU는 중앙값 약 43ms로 10ms를 넘는다. 따라서 동적 OG만 고쳐서는 무료 플랜이 해결되지 않는다.
- 프록시(`/api/*`)는 Next를 거치지 않아 CPU 중앙값 1~2ms다(10ms의 20%). 요청 수 한도(10만/일)에만 영향을 준다.
- 정적 SEO 페이지·조합 OG(캐시 읽기)는 중앙값 10ms 안팎으로 경계선이다.
- 벽시계의 `/s` 354ms·`/api/healthz` 208ms는 Cloudflare → Cloud Run(서울) 왕복을 포함한다.

### /s/og 대안 판단
정해 둔 대안은 "정적 이미지 + 동적 텍스트"(역별 정적 카드 + `og:title`·`og:description`에 각자 시간)다. **지금은 바꾸지 않고 제안만 한다.** 근거: ① 바꿔도 `/s`, `/result`의 SSR 중앙값(43 ms)이 남아 무료 한도를 못 맞춘다, ② 유료 플랜이면 현재 구현(각자 시간이 그림에 들어가는 미리보기)을 그대로 쓸 수 있고 제품 가치를 지킨다, ③ 정적 카드는 1위 역(952곳)마다 이미지를 미리 만들어야 해 정적 자산이 약 +50 MB 늘고 사람별 시간이 그림에서 빠진다. 유료로 가지 않기로 하면 그때 ③을 구현한다.

### 무료 한도 대비 여유
- 요청 수: Worker가 처리하는 요청만 센다(정적 파일은 무제한). 한 사람이 입력 → 결과를 보면 홈 + healthz + 추천 API + `/result` + 공유 때 `/s/og` 등 약 4~6건이다. 무료 10만/일이면 **하루 약 1.7~2.5만 세션**까지다.
- CPU: 위처럼 **여유 없음(초과)**. 번들 크기: gzip 17% 여유.

## 4. SEO

- **sitemap·robots·canonical·OG는 모두 `SITE_URL`(=`https://banbanyeok.app`)을 쓴다.** 실제 배포에서 조합 페이지의 `og:image`가 정식 도메인이고, 정적 OG가 image/png로 응답한다(스모크 테스트).
- **검색 노출 권고(결정 필요 2)**: 정식 도메인이 붙어 있지만 개인정보처리방침이 초안이고 아직 사용자에게 알리기 전이라 **noindex로 배포했다.** `SITE_URL`은 실제 값이라 OG 미리보기·공유는 정상이다. 워크플로가 `SITE_NOINDEX`를 정한다: **저장소 변수 `SITE_INDEX=true` + `SERVER_ORIGIN`이 모두 있을 때만 색인을 허용**한다(그 전에는 모든 페이지 `noindex,nofollow`, robots는 전체 차단).
- workers.dev와 www는 정식 주소로 301이므로 중복 색인이 없다. `/s`(공유 링크)는 robots로 막지 않고 `noindex`만 둔다(카카오톡 크롤러가 읽어야 하므로, P5 결정 그대로).
- HTML 응답에 `cache-control: s-maxage=31536000`이 붙는다(OpenNext의 정적 페이지 기본값). Cloudflare는 Worker 응답을 기본으로 캐시하지 않지만, 나중에 캐시 규칙을 켜면 재배포 때 오래된 HTML이 남을 수 있으니 켜기 전에 확인한다.

## 5. 보안 헤더 (`web/src/lib/security/headers.ts`, `next.config.ts`)

운영 배포에서 확인한 값(모든 경로: 홈·`/privacy`·`/meet`·robots·sitemap):

| 헤더 | 값 |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://us.i.posthog.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` |
| `Strict-Transport-Security` | `max-age=31536000`(**색인을 허용한 정식 HTTPS 배포에서만**. 지금 noindex 배포에서는 붙지 않는다. `.app`은 브라우저에 HSTS가 내장돼 있어 https 전용이고, http 요청은 Worker가 301로 https로 올린다) |

- `'unsafe-inline'`은 Next의 하이드레이션 인라인 스크립트 때문이다. nonce 방식은 모든 페이지를 요청마다 렌더해야 해서(CPU·정적 SEO 페이지와 충돌) 쓰지 않았다. `unsafe-eval`·외부 스크립트 출처는 없다.
- **PostHog와의 충돌**: PostHog는 `posthog-js/no-external` 번들을 동의 뒤 동적 import하는 같은 출처 스크립트이고 수집은 `connect-src`의 `us.i.posthog.com` 한 곳이다. 통계 키가 없는 빌드에서는 그 호스트가 `connect-src`에서도 빠진다.
- **카카오톡 공유(#51 B단계)**: 빌드에 `KAKAO_JS_KEY`(→ `NEXT_PUBLIC_KAKAO_JS_KEY`)가 있을 때만 네 곳을 더 연다. `script-src`에 고정 버전 SDK 파일 하나(`https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js`, 스크립트에 SRI 해시도 건다), `connect-src`에 `https://kapi.kakao.com`(공유 칸이 보일 때 앱이 내용 없는 메시지로, 누른 뒤 모바일에서는 SDK가 실제 메시지로 템플릿을 확인받는 요청), `form-action`에 `https://sharer.kakao.com`(PC 공유 창으로 보내는 폼)과 `https://accounts.kakao.com`(카카오에 로그인하지 않은 PC에서 그 폼이 302로 넘어가는 로그인 화면. 폼 전송은 이동 경로 전체가 `form-action`을 따른다), `frame-src 'self' kakaolink:`(일부 안드로이드 브라우저에서 카카오톡을 여는 숨은 프레임). 키가 없으면 위 표와 같다. SDK는 공유 버튼이 있는 공유 칸이 화면에 들어올 때 받는다(iPhone 첫 누름에 카카오톡을 바로 열려고).
- **개발 서버(`next dev`)에는 CSP를 붙이지 않는다**(HMR이 eval·websocket 사용). 운영 빌드에서만 강제하고 e2e가 운영 빌드로 확인한다.
- e2e: `e2e/security.spec.ts`(모든 응답 종류의 헤더, 핵심 흐름에서 CSP 위반 0건), `e2e-analytics/enabled.spec.ts`(동의 뒤 전송 시 CSP 위반 0건 + 기존 시나리오 전부).

## 6. 통계(PostHog) 실제 배포 확인

`LIVE_POSTHOG=1 REAL_WEB_URL=https://banbanyeok.app pnpm exec playwright test --config playwright.real.config.ts live-analytics`(`web/e2e-real/live-analytics.spec.ts`, 환경 변수가 없으면 건너뜀):

- 동의 전(배너만 보이고 5초 대기): PostHog로 가는 요청 **0건**, `ph_*`·`bby.analytics.seen` 저장 없음.
- 두 항목 동의 뒤: 요청은 `POST https://us.i.posthog.com/e/` 하나, 응답 200, 이벤트 이름 `analytics_consent_changed`.
- PostHog 프로젝트에서 직접 조회: 최근 2시간 이벤트가 `analytics_consent_changed` 1건(속성·사람 정보는 조회하지 않음).
- 자동화 브라우저는 PostHog가 봇으로 보고 버리므로 이 테스트 안에서만 봇 신호를 껐다(앱 코드는 그대로).

## 7. 검증 결과

```text
$ cd web && pnpm typecheck && pnpm lint && pnpm test      # 통과(Vitest 37 파일 314+ 테스트)
$ pnpm e2e                                                # Playwright: 기본(키 없는 빌드) + 통계 켠 빌드 모두 통과(보안 헤더·upstream 오류 시나리오 포함)
$ REAL_WEB_URL=https://banbanyeok.app pnpm e2e:real       # 3 passed (실제 서버 + 실제 배포 주소: 입력 → 결과 → 링크 복사 → 받은 링크 → 폐기 코드 링크 → 별칭)
$ deploy-web 워크플로(브랜치 push)                        # 배포·스모크 테스트 통과(서버 연결 상태: healthz·추천 API·동적 OG·/s 메타·리디렉트 3종)
```
- 실제 주소에서 방 만들기·참여(숨김)·결과를 `/api/v1/*`로 확인했다(웹에는 방 화면이 아직 없다. 화면은 후속 작업).
- 공유 링크 미리보기: `/s?…`의 `og:image`가 `/s/og?…`를 가리키고 `/s/og`는 `image/png`(약 34 KB)를 준다. 다만 CPU 한도 때문에 간헐 실패(3절).

## 8. 결정 필요

1. **Workers 유료 플랜(월 $5) 전환 — 권고.** 근거는 3절: 무료 한도(요청당 CPU 10ms)에서 동적 OG가 `exceededCpu`로 실패하고, 서버 렌더 경로의 CPU 중앙값이 10ms를 넘으며, 격리 환경 첫 요청이 250~690ms다. 유료 전환 시 CPU 한도가 커지고(기본 30초), Worker 크기 한도도 gzip 10 MiB로 늘어(현재 2.5 MiB) 조합 SEO 페이지를 늘릴 여유도 생긴다. 안 하기로 하면 대안은 ① `/s/og`를 역별 정적 카드 + 동적 텍스트로 바꾸기(그래도 SSR 경로는 남음), ② 공유 미리보기를 정적 기본 이미지로 후퇴. 공유 미리보기가 핵심 바이럴 경로라 ①②는 제품 가치 손실이 있다.
2. **검색 노출 시점.** 지금은 noindex다. 개인정보처리방침 초안 경고를 걷고 공개할 때 저장소 변수 `SITE_INDEX=true`를 넣고 배포를 다시 돌리면 sitemap·robots가 열리고 HSTS가 붙는다.
3. **PostHog "Discard client IP data" 켜기**(P7 결정 필요 1, 사용자 몫): 토글을 켰는지 이 작업에서 확인하지 못했다. 이미 실제 이벤트 1건이 들어갔으니 켜기 전 이벤트에 IP가 남았는지 확인하고 필요하면 삭제한다.
4. **서버가 신뢰 헤더를 쓰는지(P8a 확인 필요).** 웹은 비밀 + 방문자 IP를 모든 서버 호출에 싣는다. 서버의 IP별 레이트 리밋이 이 헤더를 쓰는지(그리고 SSR 호출 포함) P8a가 확인해야 한다.
5. **조합 SEO 페이지 상한.** Worker gzip 한도(무료 3 MiB) 때문에 현재 413쪽에서 약 300쪽 더 늘리면 무료 한도에 닿는다(유료는 여유).
6. **배포 데이터 출처.** 웹 빌드는 `data/artifacts/dev/`의 커밋된 산출물(역 인덱스·SEO 조합)을 읽는다. 데이터 발행(GCS) 파이프라인이 새 버전을 내면 웹을 다시 빌드·배포해야 SEO 페이지가 따라온다(`data/artifacts/**` 변경 시 자동 배포는 이 경로가 저장소에 커밋될 때만 동작).

## 배포 순서: 서버 데이터 대기 (2026-11-16)

PR #32 병합 때 deploy-web 스모크가 `FAIL /api/v1/recommend status=400`, `FAIL /s 미리보기 메타`로 실패했다(run 43727084256). 같은 커밋의 deploy-server가 새 데이터(dataVersion)를 발행하기 전에, 웹이 새 역 색인의 새 출발역 코드로 서버를 불렀기 때문이다. 서버 배포가 끝난 뒤 다시 실행하자 통과했다.

- deploy-web은 이제 스모크 전에 `scripts/wait-data-version.sh`를 돌린다. 이 스크립트는 `https://<도메인>/api/v1/manifest`(Worker 프록시 → 서버)의 `dataVersion`이 웹 빌드의 `index.gen.json` 값 **이상**이 될 때까지 기다린다. 30초 간격으로 최대 25분이며, 시간이 다 되면 마지막 이유(상태 코드, 옛 버전, 형식 오류)를 출력하고 실패한다. 그래서 잡 제한 시간을 25분에서 45분으로 늘렸다.
- **서버가 더 새 버전이면 통과**로 본다. 레지스트리는 append-only다(코드는 지워지거나 재사용되지 않고, 폐기 코드는 replacedBy로 풀린다). 그래서 옛 색인의 코드는 새 서버에서도 같은 역을 가리키고, 더 새 데이터의 웹 배포가 뒤따른다. 실패가 나는 쪽은 웹이 더 새로울 때뿐이다. `YYYYMMDD.N`은 날짜와 N을 숫자로 비교한다(문자열로 비교하면 `.10` < `.9`가 된다).
- 스모크 스크립트 경고도 정리했다.
  - `command substitution: ignored null byte`: 이미지·글꼴 같은 바이너리 응답은 셸 변수에 담지 않고 헤더·상태만 검사한다.
  - `grep: write error: Broken pipe`: `| head -1`을 `sed -n 1p`로 바꿨다(앞 명령의 출력을 끝까지 읽는다).
  - 추천 API가 실패하면 응답 앞부분(오류 코드)을 함께 출력한다.
