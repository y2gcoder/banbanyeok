# vinext 비교 실험 (#254 1부)

지금 웹은 Next.js App Router를 OpenNext로 빌드해 Cloudflare Workers(`banbanyeok-web`)에 배포한다. Cloudflare가 Next.js 앱의 기본 Workers 경로로 vinext를 권장하기 시작해서([Cloudflare Next.js 가이드](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)), 같은 앱을 vinext로 빌드했을 때 같은 동작을 하는지, 크기·빌드 시간·응답이 어떻게 달라지는지를 같은 기계와 같은 입력으로 비교했다. 적용을 정하는 작업이 아니다. 운영 배포 경로·도메인·바인딩은 그대로 두고, vinext 후보는 실험용 이름과 설정으로만 만들었다.

## 결론: 보류

같은 동작을 내려면 앱 코드 밖의 손질이 세 군데 필요하고, 그중 하나(정적 OG 그림을 요청마다 그리게 되는 것)는 운영 CPU 비용을 늘린다. 크기와 빌드 시간은 vinext가 확실히 낫다. 정한 도구가 아직 RC·베타이고(아래 "도구 성숙도"), 7일 규칙 때문에 바로 다음 판(1.4.7)의 수정도 아직 쓸 수 없다. 운영 CPU p90과 실제 배포 시간을 테스트 Worker에서 잰 뒤([인계](#코디네이터-인계-테스트-worker-측정)) 다시 정하는 것을 권한다.

| 기준 | OpenNext(현재) | vinext 후보 | 판단 |
|---|---|---|---|
| 압축 Worker 업로드(dry-run, gzip) | 3,290.04 KiB | 1,733.12 KiB(그대로) / 1,796.05 KiB(SEO 번들 해결안) | vinext가 45~47% 작음 |
| 깨끗한 빌드 시간(같은 기계) | 14.8 s + 캐시 채우기 1.0 s | 7.8 s(사전 렌더 포함) | vinext가 빠름(아래 "빌드 시간") |
| 응답 25개 경로 상태 | 기준 | 그대로는 2개 500(`/sitemap.xml`, 조합 그림). 해결안 적용 시 25개 모두 같음 | 해결 필요 |
| HTML head 메타(title·canonical·og·twitter·robots·h1) | 기준 | 해결안 적용 시 모든 HTML 경로에서 같음 | 같음 |
| 합성 API(추천 3모드·방 만들기/참여/결과/삭제·방 그림 캐시) | 기준 | 응답 본문 해시까지 같음 | 같음 |
| 정적 OG(사이트 그림·조합 그림 268장) | 정적 자산(Worker CPU 없음, 로컬 3~6 ms) | 요청마다 Worker가 그림(로컬 33~64 ms, 첫 요청 148 ms) | **비용 증가** |
| OG 그림 픽셀 | 기준 | 한글은 정상, 띄어쓰기·숫자 위치가 몇 px 다름 | 그림 버전 올려야 함 |
| 실제 서버 e2e(`e2e-real`, 40건) | 39 통과·1 건너뜀(두 번 모두) | 병렬 실행 2번에서 3·4건 실패(수화 전 클릭·입력). 그 4건을 워커 1개로 3회씩 돌리면 21/21 통과 | 테스트 대기 보강 필요 |
| 배포 스모크(`smoke-deploy.sh`) | 42 ok | 해결안 적용 시 37 ok, 1 FAIL(매니페스트 JSON 들여쓰기, 내용은 같음) | 스크립트 비교 방식 |
| 정식 도메인 리디렉트 | 301/308 | 페이지·API 같음. 없는 `/_next/static/*`는 Worker를 안 거쳐 404 | 거의 같음 |

## 기준

- 기준 SHA: `origin/main` `1751ee5c5da107dd1e97239ed77b1a2c349053af`(#252까지). 독립 검토 중인 #253(`y2gcoder/182-retire-hidden-cleanup`)은 얹지 않았다.
- 측정일: 2026-11-28(KST). 기계: Apple M4 Pro(12코어), RAM 24 GiB, macOS 27.2.1, Node 24.22.2, pnpm 12.16.1. 측정 중 다른 작업이 있어 load average가 3~16이었다(빌드 시간은 교대 측정으로 두 쪽이 같은 부하를 받게 했다).
- 빌드 값은 `deploy-web.yml`과 같은 이름이다: `SITE_URL=https://banbanyeok.app`, `SITE_NOINDEX=`(색인 허용), `API_ORIGIN`(로컬 Ktor), `NEXT_PUBLIC_APP_VERSION=1751ee5`. PostHog·카카오 키는 비웠다.
- 서버는 같은 로컬 Ktor 설치본(`:server:app:installDist`, 권역 5세대)과 빈 Postgres(compose 프로젝트 `bbyvinext`)다. 프록시 공유 비밀은 실행마다 새로 만든 합성 값이다. 방·참여·추천은 합성 입력(`X-Banbanyeok-Synthetic`)만 썼다.

### 고른 버전(게시 후 7일 규칙, 2026-11-21 이전 게시)

| 패키지 | 버전(게시일) | 메모 |
|---|---|---|
| `vinext` | 1.4.6 (11-16) | 1.4.7(11-26)은 12-03부터 쓸 수 있다 |
| `@vinext/cloudflare` | 1.4.0 (11-16) | 1.5.0(11-26)은 vinext ^1.4.7을 요구 |
| `vite` | 8.3.6 | init은 8.3.0을 고정하지만, 그러면 vitest가 쓰던 8.3.6이 8.3.0으로 내려가 기존 테스트 도구가 바뀐다. 8.3.6으로도 같은 결과(사전 렌더 744건, 같은 크기)임을 확인했다 |
| `@vitejs/plugin-rsc` | 0.5.39 (11-05) | |
| `react-server-dom-webpack` | 19.3.1 (10-14) | 앱의 react 19.3.1과 같게 |
| `@cloudflare/vite-plugin` | 2.0.0-rc.3 (11-20) | init이 `@beta`를 설치한다. 안정판 1.x는 Wrangler 설정 방식(`--legacy-wrangler-cloudflare-init`) |
| `cf`(Cloudflare CLI) | 1.0.0-rc.2 (11-19) | init이 `cf@latest`를 설치한다. 아직 RC다 |

`pnpm install`의 공급망 정책(`minimumReleaseAge`)을 통과했다. 전이 의존성 `miniflare`도 `5.20261119.0-beta`다.

## 실험 구성(기본 배포 경로와 분리)

`vinext init --platform=cloudflare --ignore-wrangler-config --name banbanyeok-web-vinext --cdn-cache=static-assets --data-cache=none --image-optimization=none --no-warm-cache`로 시작했다. 캐시는 vinext의 [OpenNext 이전 문서](https://vinext.dev/docs/getting-started/migrating-from-opennext#6-caching-and-isr) 표대로 OpenNext 정적 자산 증분 캐시(`open-next.config.ts`)에 대응하는 Static Assets 응답 캐시다. 앱은 `fetch` 캐시·`unstable_cache`를 쓰지 않아 데이터 캐시는 없다.

| 파일 | 하는 일 | 기본 경로 영향 |
|---|---|---|
| `web/vite.config.ts` | vinext + Cloudflare 플러그인, Static Assets 캐시, 실험용 alias 두 개 | 없음(`cf:build`·`next dev`는 읽지 않는다) |
| `web/cloudflare.config.ts` | 실험 Worker `banbanyeok-web-vinext`. `wrangler.jsonc`와 같은 flags·vars·secret, **domains·routes 없음** | 없음(wrangler는 읽지 않는다) |
| `web/vinext/worker.ts` | 운영 `worker.ts`와 같은 순서(정식 도메인 리디렉트 → `/api/*` 프록시 → 나머지는 vinext) | 없음 |
| `web/vinext/opennext-context.ts` | `getCloudflareContext()`를 `cloudflare:workers`의 `env`로 대신(alias). `og-font.ts`를 고치지 않으려고 | 없음 |
| `web/vinext/seo-load.ts` | 해결안 측정용(`VINEXT_SEO_BUNDLE=1`일 때만 alias). SEO 데이터를 번들에 넣는다 | 없음 |
| `web/next.config.ts` | `VINEXT=1`이면 `initOpenNextCloudflareForDev()`를 부르지 않는다 | 없음(OpenNext 경로는 `VINEXT`를 두지 않는다) |
| `web/tsconfig.json`, `web/eslint.config.mjs` | 실험 파일을 제외(타입은 별도 `web/vinext/tsconfig.json`) | `next build`의 타입 검사와 ESLint가 실험 파일을 읽어 깨지던 것을 막는다 |
| `web/package.json` | `*:vinext` 스크립트, 의존성 7개 | `cf:build`·배포 단계는 그대로 |

운영 Worker(`banbanyeok-web`), `wrangler.jsonc`, `deploy-web.yml`, `worker.ts`는 바꾸지 않았다. 바꾼 뒤 OpenNext 빌드(`pnpm cf:build`)·`pnpm typecheck`·스모크·`e2e-real`을 다시 돌려 통과를 확인했다.

## 결과

### 호환성 검사(`vinext check`)

88%(18 지원·1 부분·2 문제)였다. 문제 2건은 검사기가 `.open-next/` 빌드 결과물을 읽은 오탐이다. 부분 1건은 `reactStrictMode`가 App Router에 적용되지 않는 것(개발 모드의 이중 렌더 검사만 사라진다)이다. 원문: `results/vinext-check.log`.

검사가 잡지 못한 비호환은 실제로 띄워 찾았다(아래).

### 크기와 빌드 시간

교대 측정 5회씩(OpenNext → vinext 순서를 번갈아, 빌드 캐시·산출물을 지우고 처음부터, load average 7~16). 원자료: `results/build-alternate.tsv`, 앞선 3회씩 측정: `results/build-*.tsv`.

| | OpenNext | vinext(그대로) | vinext(SEO 번들 해결안) |
|---|---:|---:|---:|
| 빌드 중앙값(범위) | 14.8 s (14.7~15.2) | 7.8 s (7.8~8.2, 3회) | 7.8 s (7.7~7.8) |
| 배포 전 캐시 채우기(`populateCache local`) | 1.0 s | 없음 | 없음 |
| dry-run 업로드 | 16,181.74 KiB | 4,989.88 KiB | 5,915.56 KiB |
| 그중 gzip | 3,290.05 KiB | 1,733.17 KiB | 1,796.02 KiB |
| 정적 자산 | 1,584개, 175 MB | 1,645개, 75 MB | 같음 |

- 크기는 `wrangler deploy --dry-run`(OpenNext)과 `cf deploy --prebuilt --dry-run`(vinext)의 Total Upload다. 같은 크기가 매번 나온다(gzip만 ±0.05 KiB).
- OpenNext 빌드 시간의 한계는 `next build`다. 로그 기준으로 컴파일 2.2 s, **TypeScript 검사 3.5 s**, 정적 페이지 1,451개 생성 2.7 s이고 나머지가 OpenNext 번들링이다. vinext 빌드는 타입 검사를 하지 않는다(Vite 번들 약 1 s + 744경로 사전 렌더). 타입 검사 몫을 빼도 OpenNext가 약 11 s로 더 느리다. CI는 `pnpm typecheck`를 따로 돌리므로 vinext로 옮겨도 타입 검사가 빠지지는 않는다.
- 정적 자산이 175 MB → 75 MB로 준 것은 OpenNext가 사전 렌더 결과를 `cdn-cgi/` 아래(170 MB)에 따로 두기 때문이다(`du`로 확인). vinext는 같은 결과를 `_vinext/static-cache/`(약 1,500개)에 둔다.
- 실제 CI 러너 시간과 배포(업로드) 시간은 재지 않았다(인계).

### 응답 비교(같은 입력, 25개 경로 + 합성 API 흐름)

`compare.py`가 두 Worker에 같은 요청을 보내 상태, 캐시·보안 헤더, HTML head 메타와 h1, JSON 값, PNG 크기·픽셀을 비교한다. 결과: `results/compare-vinext-plain.md`(그대로), `results/compare-vinext-seo.md`(해결안).

- 같음: 모든 페이지의 상태(해결안), head 메타(title·canonical·og:*·twitter:*·robots·description), h1, `/api/*` 프록시(healthz·manifest·없는 방 404), 추천 3모드 응답 본문 해시, 방 만들기 201·참여 201·결과 200(후보 3)·삭제 204, 방 화면의 `og:image`(`/r/<id>/og?sv=…&dv=…&pv=4&iv=72cd48e6`), 방 그림 캐시(현재 버전 `public, max-age=86400, s-maxage=86400`, 버전 없음·옛 버전은 기본 그림 `public, max-age=60`), 옛 `/s` 링크의 메타와 `/s/og` 한글 PNG(1200×630), 페이지 보안 헤더(CSP·HSTS·COOP·Permissions-Policy·Referrer-Policy·nosniff).
- 다름(기능 영향 작음): `Vary`에 `next-url`·`x-vinext-interception-context` 등이 더 붙는다. 정적 페이지 `Cache-Control`에 `stale-while-revalidate`가 붙는다. `/favicon.ico`가 Worker를 거쳐 보안 헤더가 붙고 형식이 `image/x-icon`이다(OpenNext는 `image/vnd.microsoft.icon`). 아이콘 주소의 쿼리 해시 형식이 다르다(`?favicon.45b8….ico` → `?c94a4aa3…`). 매니페스트 JSON이 들여쓰기돼 나온다(값은 같음).

### 로컬 응답 시간(벽시계, workerd)

Workers CPU가 아니다. 로컬 `wrangler dev`(OpenNext)와 `vite preview`(vinext)의 벽시계이고 운영 수치와 섞지 않는다. 3라운드(라운드마다 두 Worker를 다시 띄우고 먼저 재는 쪽을 바꿈), cold는 다시 띄운 뒤 첫 요청(n=3), warm은 이어서 5회씩(n=15) 중앙값이다. 원자료: `results/timing.tsv`.

| 경로 | cold OpenNext | cold vinext | warm OpenNext | warm vinext |
|---|---:|---:|---:|---:|
| `/` | 46.0 | 7.5 | 4.2 | 3.6 |
| `/meet/<조합>` | 6.0 | 4.0 | 4.4 | 3.6 |
| 조합 그림 `/meet/<조합>/opengraph-image` | 6.1 | **147.8** | 3.7 | **63.7** |
| 사이트 그림 `/opengraph-image` | 4.3 | **34.0** | 3.2 | **33.3** |
| `/sitemap.xml` | 4.8 | 4.1 | 3.5 | 3.4 |
| `/privacy` | 86.1 | 45.0 | 19.7 | 19.9 |
| `/r/<가짜 ID>` | 25.1 | 10.3 | 7.2 | 5.0 |
| `/result?…` | 24.2 | 18.1 | 11.3 | 9.7 |
| `/s?…` | 13.4 | 10.2 | 10.6 | 9.9 |
| `/s/og?…` | 103.8 | 41.9 | 41.7 | 38.6 |
| `/api/healthz` | 3.1 | 3.0 | 2.6 | 2.7 |

vinext는 첫 요청이 빠르다(번들이 작다). 대신 정적 그림 두 종류가 OpenNext에서는 미리 만든 정적 자산이고 vinext에서는 요청마다 satori·resvg로 그린다. 동적 `/s/og`가 이미 무료 플랜 CPU 10 ms를 넘어 유료로 옮긴 이력([p8b-notes](../../docs/setup/p8b-notes.md))을 보면, 카카오·검색 크롤러가 조합 그림 268장을 부를 때마다 그만큼 CPU가 든다.

### 화면 수화 시점(`e2e-real` 실패의 원인)

`/result` 첫 1위 카드의 "자세히" 버튼이 화면에 보인 시각과 React가 붙은 시각(5회, ms): OpenNext 보임 382~387 / 수화 404~418, vinext 보임 63~65 / 수화 105~122. vinext가 둘 다 빠르지만 보인 뒤 수화까지의 틈이 약 50 ms로 OpenNext(약 25 ms)의 두 배다. 병렬 e2e 부하에서는 이 틈이 커져 테스트가 수화 전에 누르거나 입력한다(`real-server.spec.ts:14`, `modes.spec.ts:47` 2명, `host-entered-draw.spec.ts:97`, 기계 부하가 높았던 두 번째 실행에서는 `room-share.spec.ts:92`의 역 입력도). 같은 4건을 워커 1개로 3회씩 돌리면 21/21 통과한다(`results/e2e-real-vinext-serial.txt`). OpenNext는 두 실행 모두 39 통과였다. 기능 차이가 아니라 테스트의 대기 조건 문제다. 사용자가 이 틈에 누르면 한 번 무시된다(추정, 실기기 측정 안 함).

### 정식 도메인 리디렉트

두 Worker를 `CANONICAL_HOST=banbanyeok.app`으로 띄우고 Host 헤더로 www·workers.dev를 흉내 냈다(`redirect.sh`, `results/redirect.tsv`). 페이지 GET은 둘 다 301, API POST는 308, `Location`과 `Cache-Control: public, max-age=3600`이 같다. 없는 `/_next/static/*` 파일은 vinext에서 Worker를 거치지 않아(`runWorkerFirst`의 제외 패턴) 리디렉트 대신 404다.

## 비호환과 해결 비용

### 1. 메타데이터 라우트·force-static Route Handler를 빌드 때 만들지 않는다 (해결 필요, 중간)

- 재현: 이 브랜치에서 `cd web && SITE_URL=https://banbanyeok.app pnpm build:vinext && pnpm start:vinext` 뒤 `curl -i localhost:<포트>/sitemap.xml` → 500. 조합 그림 `/meet/<조합>/opengraph-image?v=…`도 500. 원인은 vinext 1.4.6 Static Assets 사전 렌더가 `sitemap.ts`(force-static)와 `opengraph-image/route.tsx`(force-static, `generateStaticParams`)를 건너뛰는 것이다(`dist/server/vinext-prerender.json`의 `skipped: api`, sitemap은 목록에 없음). 요청 때 Worker 안에서 `node:fs`로 `../data/artifacts/dev/seo-pairs.json`을 읽다 실패한다. Next·OpenNext는 이 둘을 빌드 때 만든다.
- 500 응답 본문에 오류 문구와 절대 경로가 담긴 스택이 나온다(로컬 `vite preview`에서 확인). 배포 Worker에서도 그런지는 확인하지 않았다.
- 해결안 A(이 실험에서 측정): SEO 데이터를 번들에 넣는다(`vinext/seo-load.ts`). 업로드 +925.78 KiB(gzip +62.93 KiB). 25개 경로 상태가 모두 같아진다. 하지만 조합 그림·사이트 그림을 요청마다 그린다(위 시간 표).
- 해결안 B: 그림·sitemap을 빌드 때 정적 파일로 만들어 Static Assets에 넣는 스크립트를 따로 둔다. CPU는 지금과 같아지지만 Next의 메타데이터 규약(`?v=` 그림 버전 포함)을 우리 스크립트가 다시 구현해 유지해야 한다.
- 해결안 C: Workers Response Store 또는 Workers Cache + `--warm-cache`. R2·Durable Object 같은 새 리소스와 첫 배포 절차가 생긴다. 메타데이터 라우트 예열은 1.4.7의 수정(#4788)이라 12-03 전에는 쓸 수 없다.

### 2. OG 그림 렌더러 판이 다르다 (작음)

Next 16.4.6에 든 `@vercel/og`는 1.0.1, vinext 1.4.6은 1.0.3(satori 0.33.5)을 쓴다. 한글 글꼴은 같게 나오지만 `/s/og`의 "수유에서 볼까?" 띄어쓰기가 넓어지고 오른쪽 분 숫자가 몇 px 옮겨진다(`results/og/`의 PNG, 다른 픽셀 4,192~34,035개). 카카오는 그림을 주소별로 캐시하므로 옮기면 그림 버전(`SHARED_OG_IMAGE_VERSION`, `ROOM_OG_IMAGE_VERSION`, 조합 `?v=`)을 올리고 그림을 다시 검토해야 한다.

### 3. 빌드 값인 정식 도메인이 사전 렌더를 깨뜨린다 (해결함, 작음)

vinext는 빌드 때 Worker를 루프백에서 띄워 페이지를 부르는데, `cloudflare.config.ts`의 `CANONICAL_HOST`는 빌드 값이라 그 요청이 정식 도메인으로 301 된다. 그대로 두면 `Prerendered 0 routes (739 errors)`인데도 빌드가 0으로 끝나고, 빌드 도구가 리디렉트를 따라 운영 주소를 읽는다. `vinext/worker.ts`에서 루프백 호스트만 리디렉트를 건너뛰게 고쳐 744건 사전 렌더로 돌아왔다. 채택하면 사전 렌더 수가 줄면 빌드를 실패시키는 검사가 필요하다.

### 4. 도구 쪽 손질 (작음)

- `vinext init`이 쓴 `compatibilityDate`(실행 전날, 2026-11-27)를 7일 규칙을 따른 workerd(2026-11-26까지 지원)가 거절한다. `wrangler.jsonc`와 같은 `2026-11-01`로 맞췄다.
- vinext의 캐시 어댑터 타입이 이 저장소의 `exactOptionalPropertyTypes`와 맞지 않는다(`vite.config.ts` TS2375). 실험 tsconfig에서만 끄고, 앱 tsconfig에서는 실험 파일을 뺐다.
- vinext는 `next.config`를 자기 프로세스에서 읽으므로 `initOpenNextCloudflareForDev()`를 막아야 한다.
- vinext 빌드가 Next의 생성 타입 `.next/types/routes.d.ts`를 자기 것으로 덮어쓴다. OpenNext 빌드 뒤 vinext 빌드를 하고 `pnpm typecheck`를 돌리면 `.next/types/validator.ts`가 깨진다(CI는 `.next` 없이 검사하므로 영향 없음). 두 도구를 한 폴더에서 같이 쓰는 동안은 `.next`를 지우고 검사해야 한다.
- 실험 설정 파일이 앱 tsconfig 밖이라 ESLint 타입 인식 린트에서 뺐다(`eslint.config.mjs` ignores).
- `e2e-real`이 수화 전에 누르거나 입력하는 4건은 수화 표시를 기다리게 고쳐야 한다.
- `smoke-deploy.sh`의 매니페스트 검사는 문자열 비교라 들여쓴 JSON을 실패로 본다. JSON으로 비교하게 바꿔야 한다.

### 도구 성숙도

vinext는 Cloudflare 가이드에서도 베타로 표시된다. 권장 경로(typed config)는 `cf` 1.0.0-rc, `@cloudflare/vite-plugin` 2.0.0-rc, `miniflare` 베타에 기댄다. vinext 1.4.7 한 판의 수정이 약 60건이다. 7일 규칙을 지키면 늘 1~2판 뒤를 쓰게 되고, 이번처럼 필요한 수정(#4788)을 기다리게 된다.

## 코디네이터 인계: 테스트 Worker 측정

로컬 수치로는 Workers CPU p90, 실제 배포 시간, 정식 Worker 캐시 동작을 알 수 없다. 아래는 운영 리소스와 섞이지 않게 별도 테스트 Worker 두 개(OpenNext 대조, vinext 후보)를 만들어 재는 절차다. 작업자는 실행하지 않았다.

전제:

- 테스트 서버 출처 `TEST_API_ORIGIN`(운영 Cloud Run이 아닌 것). 테스트 서버의 `CORS_ALLOWED_ORIGINS`에 두 테스트 Worker의 workers.dev 출처를 넣는다.
- 테스트 전용 공유 비밀 `TEST_PROXY_SECRET`(32자 이상, 운영 `PROXY_SHARED_SECRET`이 아닌 값). 테스트 서버도 같은 값.
- `CLOUDFLARE_ACCOUNT_ID`, Workers 편집 권한 토큰 `CLOUDFLARE_API_TOKEN`. 두 Worker 모두 domains·routes가 없어 Zone 권한은 쓰지 않는다.
- 운영 시크릿·라우트 배제: Worker 이름이 다르고(`*-test`), `CANONICAL_HOST`를 비우고, 도메인 인자를 주지 않는다. 색인되지 않게 `SITE_NOINDEX=1`.

```sh
cd web && pnpm install --frozen-lockfile
export SITE_URL=https://banbanyeok.app SITE_NOINDEX=1 API_ORIGIN="$TEST_API_ORIGIN" CANONICAL_HOST= \
  NEXT_PUBLIC_APP_VERSION="$(git rev-parse --short=7 HEAD)" NEXT_TELEMETRY_DISABLED=1
secrets="$(mktemp)"; printf 'PROXY_SHARED_SECRET=%s%s\n' '$' '{TEST_PROXY_SECRET}' > "$secrets"   # 값은 환경 변수에서 읽는다

# 1) OpenNext 대조 Worker(운영과 같은 빌드, 이름만 다름)
time pnpm cf:build
time pnpm exec opennextjs-cloudflare populateCache remote
time pnpm exec wrangler deploy --name banbanyeok-web-opennext-test --var "API_ORIGIN:$TEST_API_ORIGIN" --secrets-file "$secrets"

# 2) vinext 후보 Worker(해결안 A)
time env VINEXT_SEO_BUNDLE=1 VINEXT_WORKER_NAME=banbanyeok-web-vinext-test pnpm build:vinext
time pnpm exec cf deploy --prebuilt --mode production --secrets-file "$secrets"
rm -f "$secrets"
```

측정:

```sh
# 같은 입력의 기능 비교(합성 데이터만 쓴다)
BASE_URL=https://banbanyeok-web-vinext-test.<계정>.workers.dev SERVER_CONNECTED=1 SITE_INDEXABLE=0 bash scripts/smoke-deploy.sh
python3 -B ../spikes/vinext/compare.py --a opennext=https://banbanyeok-web-opennext-test.<계정>.workers.dev \
  --b vinext=https://banbanyeok-web-vinext-test.<계정>.workers.dev --out /tmp/compare-remote.md
# 경로별 Workers CPU·벽시계(wrangler tail + 계정 분석). 두 Worker 각각, 같은 시간대에 번갈아
BASE_URL=https://banbanyeok-web-opennext-test.<계정>.workers.dev WORKER_NAME=banbanyeok-web-opennext-test REPEATS=20 node scripts/measure-cpu.ts
BASE_URL=https://banbanyeok-web-vinext-test.<계정>.workers.dev WORKER_NAME=banbanyeok-web-vinext-test REPEATS=20 node scripts/measure-cpu.ts
```

- 볼 값: 경로별 CPU p50·p90(특히 `/`, `/meet/<조합>`, 조합 그림, 사이트 그림, `/s/og`, `/result`), `exceededCpu` 수, 배포 명령 시간(`time`), 두 번째 요청부터의 `cf-cache-status`·`age`(정식 Worker 캐시 동작), 없는 `/_next/static/*`의 응답 헤더, 500 응답 본문에 스택이 나오는지.
- 비용: 유료 플랜 포함 요청 범위 안(측정 수천 건)이라 추가 요금은 없을 것으로 본다(추정). Static Assets 캐시는 KV·R2·Durable Object를 만들지 않는다.
- 정리: `pnpm exec wrangler delete --name banbanyeok-web-opennext-test`와 `--name banbanyeok-web-vinext-test`(secret도 함께 지워진다). 대시보드에서 두 이름이 없고 KV·R2·D1이 새로 생기지 않았는지 본다. 테스트 서버와 테스트 비밀은 따로 지운다.

## 재현

```sh
bash spikes/vinext/measure-build.sh opennext 3              # 빌드 시간·dry-run 크기
bash spikes/vinext/measure-build.sh vinext 3
VINEXT_SEO_BUNDLE=1 LABEL=vinext-seo bash spikes/vinext/measure-build.sh vinext 3
bash spikes/vinext/alternate.sh 5                             # 교대 측정
bash spikes/vinext/stack.sh up                                # 로컬 DB·Ktor·두 Worker
python3 -B spikes/vinext/compare.py --a opennext=http://localhost:18787 --b vinext=http://localhost:18788 --out /tmp/compare.md
(cd web && BASE_URL=http://localhost:18788 SERVER_CONNECTED=1 SITE_INDEXABLE=1 SITE_URL=https://banbanyeok.app bash scripts/smoke-deploy.sh)
(cd web && COMPOSE_PROJECT_NAME=bbyvinext DB_PORT=55433 REAL_WEB_URL=http://localhost:18788 pnpm e2e:real)
bash spikes/vinext/timing.sh 3
CANONICAL_HOST=banbanyeok.app bash spikes/vinext/stack.sh restart && bash spikes/vinext/redirect.sh   # vinext는 CANONICAL_HOST를 주고 다시 빌드해야 한다
bash spikes/vinext/stack.sh down
```

`stack.sh`는 상태를 저장소 밖(`~/.cache/banbanyeok-vinext-spike`)에 두고, 띄운 PID와 그 자손, compose 프로젝트만 정리한다. `web/.dev.vars`는 실행 중에만 만들고 `down`이 지운다.

## 실행한 범위와 하지 않은 것

- 한 것: 로컬 빌드·dry-run·로컬 workerd 두 개·로컬 Ktor·빈 DB·합성 데이터. 외부 Worker·서버 배포, 클라우드 쓰기, 운영 트래픽 테스트는 하지 않았다.
- 의도하지 않은 운영 요청 1건: 3절의 원인을 고치기 전 빌드 한 번에서 vinext 사전 렌더가 리디렉트를 따라가 `https://banbanyeok.app`에 GET 요청 몇 건(메타데이터 라우트 목록과 정적 파라미터 경로 3개, 4건 안팎으로 추정)을 보냈다. 읽기뿐이고 쓰기·인증 요청은 없다.
- 하지 않은 것: Workers CPU, 실제 배포 시간, 정식 Worker 캐시(인계 절차로 넘김). typedRoutes·oasdiff(#254 2부)는 다른 작업자 몫이다. 화면·쿼리·UX·API 계약은 바꾸지 않았다.
