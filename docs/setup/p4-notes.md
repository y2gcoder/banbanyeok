# P4 작업 노트: 웹 앱 (`web/`)

작성 2026-11-14. 범위: 화면 4개(입력·결과·공유·받은 링크), 서버 API 호출(웹은 추천을 계산하지 않음), `/s` 링크 코덱,
가짜 서버, 정적 검사·테스트·e2e, CI web 잡, OpenNext Cloudflare 빌드 준비(배포 없음).

## 1. 구조

```
web/
  src/app/            라우트: / (입력), /result (결과), /s (받은 링크), not-found
  src/components/     화면 조각. ui/는 shadcn/ui base-nova(Base UI) 생성본을 쓰는 부분만 남기고 토큰에 맞춤
  src/lib/            화면을 모르는 로직
    api/              서버 호출의 유일한 출입구(openapi-fetch). schema.gen.ts는 계약에서 생성
    link/codec.ts     /s 링크 코덱(data-format §7)
    display/          DisplayMinutes·조사·기본 이름·극단 상황 안내(p6-notes 4절과 같은 규칙)
    map/kakao.ts      카카오맵 웹 길찾기 링크(shared/links와 같은 형식)
    stations/         역 인덱스(index.gen.json)와 검색, 노선 배지 색
    result/           서버 결과 → 화면 값(반올림·파생 값·지도 링크), 공유 문구·경로
    form/             입력 검증(zod), "나" 칸 기억(localStorage)
  mock/               openapi 기반 가짜 서버(개발·e2e 전용, 번들에 들어가지 않음)
  scripts/            dev.ts(next dev 실행기), build-station-index.ts(역 인덱스 생성)
  e2e/                Playwright 모바일 시나리오
```

계층 규칙(dependency-cruiser): `app/ → components/ → lib/`, 역방향 금지, 순환 금지, 고아 모듈 금지.
`openapi-fetch`와 생성된 계약 타입은 `src/lib/api/`에서만 import한다. 전역 `fetch`도 ESLint
`no-restricted-globals`로 `src/lib/api/` 밖에서 막는다(테스트 파일 제외).

## 2. 결정과 근거

| 항목 | 결정 | 근거 |
|---|---|---|
| TypeScript | **5.9.3** (6.0·7.0 아님) | typescript-eslint 8.72.1의 peer가 `typescript <6.1.0`, openapi-typescript 7.13.0의 peer가 `^5.x`(npm 메타데이터). 피어 경고 없이 맞는 최신 안정판 |
| 엄격 옵션 | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax` | 지시 사항 |
| Next.js | 16.4.5 | 16.4.6은 2026-11-09 게시라 7일 미만. @opennextjs/cloudflare 1.20.16의 peer가 `next >=16.4.5` |
| shadcn/ui | **base-nova 스타일(Base UI 기반)** 공식 지원 확인 | `https://ui.shadcn.com/r/styles/base-nova/{combobox,dialog,popover,tabs,button}.json` 모두 200(2026-11-14). `shadcn@4.23.0 add`로 받았다. 생성본이 `import { cn } from "cn"`(존재하지 않는 경로)을 써서 `@/lib/utils`로 고치고 자동 추가된 `cn` 패키지를 지웠다 |
| 컴포넌트 | Combobox(역 검색), Tabs(모드), Popover(사람별 길찾기), Dialog(공유 시트가 없을 때) | 4개 모두 사용 |
| 생성물 커밋 | `src/lib/api/schema.gen.ts`, `src/lib/stations/index.gen.json`을 **커밋**한다 | 타입 검사·빌드가 생성 단계 없이 돌고, 계약 변경이 PR diff에 보인다. CI `pnpm check:contracts`가 재생성 후 `git diff --exit-code` |
| 계약 동기화 | ① 생성 타입 diff ② 가짜 서버 응답·웹 요청 본문을 **ajv(JSON Schema 2020-12)로 openapi.yaml에 대조**(`src/lib/api/contract.test.ts`) ③ 링크 벡터는 `contracts/golden/link-vectors.json`을 복사 없이 직접 읽음 | |
| 역 인덱스 | `data/artifacts/dev/stations.json`(374KB) → **28.7KB(gzip 13KB)**. 활성 역 952개의 [코드, 이름, 노선, 별칭, 출발 가능, 좌표] | 출발 가능 = od.bin 출발역 축(240개). 좌표는 출발 가능 역·후보역만(카카오맵 링크용). 기관 노선명은 표시명으로 정규화("경부선"→"1호선", "분당선"·"수인선"→"수인분당선" 등) |
| 역 검색 | Base UI Combobox + es-hangul: 이름 접두(자모 분해로 조합 중 글자 "홍ㄷ" 포함), 초성("ㅎㄷㅇㄱ"), "역" 접미사, 별칭, 포함 검색, 영문 자판 입력("ghdeo"→홍대) | 계산 불가 역은 보이되 고를 수 없고 이유를 적는다 |
| 상태 | 서버 컴포넌트가 첫 결과를 `prefetchQuery` → `HydrationBoundary`, 이후 모드 전환은 TanStack Query. URL 상태(`m`, `me`)는 nuqs(shallow, replace). 전역 상태 없음 | Suspense로 스트리밍해 콜드스타트 중에도 화면 골격이 바로 보인다 |
| 라우트 | `/result?<코덱 쿼리>`(만든 사람), `/s?<같은 쿼리>`(받은 사람) | 같은 코덱을 쓰되 화면 4(“나는 누구?”, 보낸 사람 헤더, 하단 CTA)를 분리 |
| API 주소 | 브라우저는 같은 출처 `/api/v1/*`, `/api/healthz` → next.config rewrite → `API_ORIGIN`. 서버 컴포넌트는 `API_ORIGIN/v1`로 직접 | `API_ORIGIN`이 없으면 `SERVER_PORT`(scripts/dev-env.sh)로 로컬 주소. **rewrite 대상은 빌드 때 고정**되므로 배포 빌드에 API_ORIGIN을 넣어야 한다(P8) |
| 미리 깨우기 | 입력 화면 마운트 시 `/api/healthz` 한 번(keepalive, 실패 무시) | 테스트로 고정 |
| 표시 분 | `floor((초+30)/60)`, 파생 값(최장·차이·합계)은 반올림한 사람별 분에서 계산 | shared/app-logic DisplayRulesTest와 같은 값으로 테스트 |
| 지도 | 카카오맵 웹 길찾기(`/link/by/traffic/`)와 장소 보기(`/link/map/`). 앱 스킴 없음 | p6-notes 3절(웹 링크만 공식) |
| 공유 | `navigator.share`(시스템 공유 시트에서 카톡 선택)가 기본, 없으면 링크 복사 대화상자. 카카오 SDK 공유는 앱 키가 필요해 범위 밖 | |
| 폰트 | Pretendard **동적 서브셋 CSS**(unicode-range로 쓰인 글자 범위의 woff2만 내려받음) | 전체 폰트(16MB) 회피(spikes/REPORT.md 2절) |
| 통계 | `src/lib/analytics.ts`의 `track()` 자리만(아무것도 보내지 않음). 이벤트 이름·속성은 contracts/events.json을 따름 | P7 |
| pnpm | `pnpm-workspace.yaml`에 `minimumReleaseAge: 10080`(7일) — 전이 의존성까지 숙성 규칙 강제. 설치 스크립트 허용은 `esbuild`, `workerd`만 | |

### 가짜 서버 도구 선택

직접 만든 작은 서버(`web/mock/`, node:http, 의존성 없음)를 골랐다. 응답 모양은 생성된 계약 타입으로 컴파일 때, ajv로 테스트 때
openapi.yaml에 대조한다.

- **Prism**(openapi 예시·스키마로 응답 생성): 예시 하나이거나 무작위 값이라 역 이름·시간·순위가 서로 맞지 않는다. 결과·공유·받은 링크
  화면을 사람이 보고 e2e로 검증하려면 입력 역에 따라 그럴듯하고 결정적인 결과가 필요하다.
- **MSW**: 브라우저·Node 프로세스 안의 요청만 가로챈다. 이 앱은 서버 컴포넌트(Next 서버)와 브라우저 둘 다 호출하고 OpenNext/wrangler에서도
  같은 경로를 써야 해서, 별도 프로세스 HTTP 서버가 단순하다.
- 가짜 서버의 시간은 역 좌표 직선거리로 만든 값이며 **실제 순위 규칙의 대체물이 아니다**(문장도 p6 템플릿 일부만 흉내).
  `MOCK_DELAY_MS`, `MOCK_COLD_START_MS`로 지연·콜드스타트를 흉내 낼 수 있다.

### 디자인

승강장(타일 회색 `#eef1f0`, 안전선 노랑 `#f5c518`)과 노선도 어휘를 쓴다. 사람마다 색(파랑·주황·초록·보라)이 있고, 입력 화면은
사람들을 노선처럼 세로선으로 잇는다. 결과 카드에서 각자의 선이 만날 역으로 들어오며 선 길이 = 시간(같은 카드의 최장 기준), 1위는
환승역 고리 기호와 안전선 노랑 표식. 숫자는 Pretendard 굵게 + tabular-nums. 사람 색은 막대·점에만 쓰고 글자는 ink/muted만 쓴다
(대비). 노선 배지 글자색은 배경 휘도로 흰색/진한색을 고른다. 다크 모드는 없다(`color-scheme: light`).
접근성: 모든 입력에 레이블, 키보드로 탭·콤보박스·접힌 후보(`<details>`) 조작, 포커스 링, 움직임 줄이기(`motion-safe:`),
e2e에서 axe(WCAG 2.1 AA 태그) 위반 0건을 확인한다.

## 3. 버전 (모두 게시 후 7일 이상, 2026-11-14 기준)

게시일은 npm 레지스트리 `time` 필드(`npm view <pkg>@<ver> time`)로 확인했다. 실행 도구(node 24.22.2, pnpm 12.16.1)는 mise.toml을 따른다.

| 패키지 | 버전 | 게시일 |
|---|---|---|
| `@axe-core/playwright` | 4.14.0 | 2026-10-15 |
| `@base-ui/react` | 1.9.0 | 2026-10-09 |
| `@biomejs/biome` | 2.6.6 | 2026-11-06 |
| `@opennextjs/cloudflare` | 1.20.16 | 2026-11-03 |
| `@playwright/test` | 1.65.0 | 2026-11-05 |
| `@tailwindcss/postcss` | 4.3.5 | 2026-11-06 |
| `@tanstack/react-query` | 5.107.1 | 2026-11-06 |
| `@testing-library/dom` | 10.4.2 | 2026-09-13 |
| `@testing-library/jest-dom` | 7.0.1 | 2026-08-09 |
| `@testing-library/react` | 16.3.3 | 2026-08-27 |
| `@testing-library/user-event` | 14.6.8 | 2026-10-13 |
| `@types/node` | 24.19.2 | 2026-10-09 |
| `@types/react` | 19.3.0 | 2026-09-09 |
| `@types/react-dom` | 19.3.0 | 2026-09-09 |
| `@vitejs/plugin-react` | 6.2.1 | 2026-11-02 |
| `ajv` | 8.20.0 | 2026-04-24 |
| `ajv-formats` | 3.0.1 | 2024-03-30 |
| `class-variance-authority` | 0.7.1 | 2024-11-26 |
| `clsx` | 2.1.1 | 2024-04-23 |
| `dependency-cruiser` | 18.7.2 | 2026-11-02 |
| `es-hangul` | 2.4.0 | 2026-07-09 |
| `eslint` | 10.14.0 | 2026-10-30 |
| `jsdom` | 31.0.0 | 2026-11-05 |
| `knip` | 6.44.1 | 2026-10-31 |
| `lucide-react` | 1.70.0 | 2026-11-06 |
| `next` | 16.4.5 | 2026-11-03 |
| `nuqs` | 2.10.2 | 2026-10-08 |
| `openapi-fetch` | 0.17.0 | 2026-02-11 |
| `openapi-typescript` | 7.13.0 | 2026-02-11 |
| `pretendard` | 1.3.9 | 2023-11-05 |
| `react` | 19.3.1 | 2026-10-14 |
| `react-dom` | 19.3.1 | 2026-10-14 |
| `tailwind-merge` | 3.7.0 | 2026-09-12 |
| `tailwindcss` | 4.3.5 | 2026-11-06 |
| `tw-animate-css` | 1.4.0 | 2025-09-24 |
| `typescript` | 5.9.3 | 2025-09-30 |
| `typescript-eslint` | 8.72.1 | 2026-10-26 |
| `vitest` | 5.1.0 | 2026-11-02 |
| `wrangler` | 4.158.0 | 2026-11-05 |
| `yaml` | 2.9.1 | 2026-09-11 |
| `zod` | 4.6.7 | 2026-10-12 |

GitHub Action: `actions/upload-artifact` v7.0.2(2026-10-07 게시, 커밋 `cf430e0…`). 나머지 액션은 기존 ci.yml과 같은 SHA.

## 4. 실행

```sh
mise run dev:web:mock        # 가짜 서버 + next dev. 서버 없이 모든 화면 동작
mise run dev:web             # 로컬 Ktor(SERVER_PORT) 또는 API_ORIGIN으로 rewrite
cd web
pnpm typecheck && pnpm lint  # tsc, Biome, ESLint(타입 규칙), Knip, dependency-cruiser
pnpm test                    # Vitest
pnpm check:contracts         # 생성물 재생성 후 diff
pnpm e2e                     # Playwright(Pixel 7). 가짜 서버 + next build/start를 직접 띄움
UPDATE_SCREENSHOTS=1 pnpm e2e  # docs/setup/p4-screens/ 갱신
pnpm cf:build                # OpenNext Cloudflare 빌드(.open-next/). 배포는 하지 않는다
```

`next dev`는 `web/AGENTS.md`(Next 16의 에이전트 안내)를 만든다. 지우면 다시 생기므로 커밋해 둔다.

## 5. 검증 결과 (2026-11-14, 로컬)

```text
$ pnpm typecheck                                  # tsc --noEmit, 출력 없음
$ pnpm lint
Checked 76 files … No fixes applied.               # Biome
✔ no dependency violations found (89 modules, 186 dependencies cruised)   # ESLint·Knip은 출력 없음(통과)
$ pnpm test
Test Files  10 passed (10)   Tests  119 passed (119)
  - 링크 벡터 encode 9 / decode 36 전부 + 오류 코드 9종 존재 확인
$ pnpm check:contracts                             # 재생성 후 diff 없음
$ pnpm e2e
4 passed  (입력→결과→모드 전환→링크 복사→받은 링크·나는 누구?·내 길찾기, 공유 대체 대화상자, 깨진 링크, 같은 동네 안내; axe 위반 0)
$ pnpm cf:build
OpenNext build complete.
$ npx wrangler deploy --dry-run --outdir <임시>
Total Upload: 5383.54 KiB / gzip: 1172.49 KiB      # 무료 한도 64 MiB(압축 전) 이내
$ npx wrangler dev                                 # 로컬 workerd: / 200, /s(깨진 링크 안내) 200, CSS 200
$ mise run dev:web:mock / mise run dev:web         # 둘 다 기동, mock은 /api/v1/recommend 응답 확인
```

모바일 스크린샷(Pixel 7, 가짜 서버): [입력](p4-screens/1-home.png) · [결과](p4-screens/2-result.png) ·
[배려 모드](p4-screens/2b-result-favor.png) · [공유 대체 대화상자](p4-screens/3-share-fallback.png) · [받은 링크](p4-screens/4-received.png)

## 6. 결정 필요 / 계약 문제

1. **추천 이유 문장의 이름이 화면 이름과 어긋난다(계약).** `POST /recommend`는 별칭을 받지 않으므로 서버는 `reason`을 기본 이름("나/친구1")으로
   만든다. 링크에 별칭(`n`)이 있으면 막대에는 "민수/지연", 문장에는 "가장 오래 걸리는 나도 22분"이 함께 보인다(스크린샷 4-received).
   클라이언트는 문장을 다시 만들지 않기로 했으므로 웹에서 고칠 수 없다. 선택지: (a) `/recommend` 요청에 선택 필드 `nicknames`를 추가해 서버가 그
   이름으로 문장을 만든다(별칭은 이미 URL에 있으므로 새 노출은 아님, 저장하지 않음), (b) 문장에 이름 대신 자리표시(예: `{p1}`)를 넣고 클라이언트가
   치환하도록 규칙을 바꾼다. 권고는 (a).
2. **`/healthz`가 openapi.yaml에 없다.** 웹은 `/api/healthz` → 서버 `/healthz`로 rewrite해 미리 깨운다. 계약에 넣을지(servers 밖 경로) 정해 달라.
3. **출발 불가 역의 오류 코드가 계약에 없다.** 가짜 서버는 od.bin 출발역 축에 없는 역에 `400 UNSUPPORTED_ORIGIN`("아직 수도권 지하철역만 계산할 수
   있어요")을 준다. 웹은 4xx면 서버의 `message`를 그대로 보여 준다. P3가 실제 코드를 정하면 맞춘다(웹은 코드에 의존하지 않음).
4. **같은 이름의 역이 둘로 나뉜 데이터.** dev 산출물에서 홍대입구(2호선·공항철도)와 홍대입구(경의중앙선), 공덕(5·6·공항)과 공덕(경의중앙선),
   왕십리(2·5)와 왕십리(1·수인분당) 등이 다른 코드다. 두 번째 쪽은 od.bin 출발역 축에 없어 검색에 "이 노선의 역은 아직 계산하지 못해요"로 보인다.
   한 물리 역으로 묶을지(data-format §2 "환승역을 묶은 물리 역") P2 확인이 필요하다.
5. **받은 링크 화면의 기준 탭 위치.** 와이어프레임은 받은 링크에서 "기준 바꿔 보기"를 카드 아래에 두지만, 탭이 결과 패널을 제어하는 구조라 두 화면
   모두 위에 두고 받은 링크에서는 탭 목록 이름을 "기준 바꿔 보기"로 했다.
6. **카톡 공유는 시스템 공유 시트로 대신한다.** 카카오 SDK(앱 키 필요)로 바꿀지는 P5/P7과 함께 정한다. 데스크톱 등 공유 시트가 없으면 링크 복사
   대화상자를 연다.
7. **배포 빌드의 API_ORIGIN.** `wrangler.jsonc`의 `vars.API_ORIGIN`은 자리값(localhost)이다. rewrite는 빌드 때 고정되므로 P8이 배포 빌드
   환경 변수와 vars를 실제 Cloud Run 주소로 맞춰야 한다. `global_fetch_strictly_public` 플래그 때문에 배포 Worker는 사설 IP로 호출하지 않는다.
