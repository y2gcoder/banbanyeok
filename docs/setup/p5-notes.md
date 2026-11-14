# P5 작업 노트: SEO 페이지와 미리보기(OG) 이미지

작성 2026-11-14. 범위: 인기 역 조합 SEO 페이지(SSG)와 허브, 메타데이터·JSON-LD, sitemap.xml·robots.txt, OG 이미지(조합은 빌드 때 정적, 공유 링크는 요청 때 동적),
한국어 글꼴 서브셋. 웹 라우트는 `web/src/app/`에 있다(작업 지시의 `web/app/`은 P4 구조상 `web/src/app/`).

## 1. 구조

```
web/
  fixtures/seo-pairs.json            단위 테스트용 작은 표본(실제 산출물이 아니다. 앱은 읽지 않는다)
  public/fonts/{og-sans-bold.otf, OFL.txt}   OG 글꼴 서브셋과 라이선스 (pnpm gen:og-font)
  scripts/build-og-font.ts           서브셋 스크립트(+ subset-font.d.ts 타입 선언)
  src/app/
    sitemap.ts, robots.ts, opengraph-image.tsx      사이트 기본 메타·기본 미리보기
    (seo)/layout.tsx, meet/page.tsx, meet/[pair]/{page,opengraph-image}.tsx   허브, 조합 페이지
    s/og/route.tsx, s/page.tsx       공유 링크 동적 OG 이미지, 링크별 generateMetadata
  src/components/{seo,og}/           조합 카드·데이터 기준 안내·JSON-LD / satori 카드 3종
  src/lib/seo/
    pairs.ts          seo-pairs.json 형식(zod, 엄격)·검증
    pair-pages.ts     페이지 모델, 주소(slug), 의미 있는 쌍 선별, 허브 묶음, 관련 조합
    load.ts           빌드 때 파일 읽기(+ manifest.files.seoPages 대조)
    metadata.ts, json-ld.ts, site.ts(SITE_URL), site-map.ts
    og-text.ts(고정 문구·크기·색), og-coverage.ts(글꼴에 있는 글자·대체), og-font.ts(글꼴 로드), shared-preview.ts(/s 미리보기)
  src/lib/form/prefill.ts            `/?o=<코드>.<코드>` 입력 화면 미리 채우기
```

기존 P4 코드는 필요한 최소만 고쳤다: `app/layout.tsx`(메타를 `siteMetadata()`로), `app/s/page.tsx`(링크별 `generateMetadata`),
`components/home/home-form.tsx`(미리 채우기)·`station-field.tsx`(밖에서 채운 역도 입력 칸에 보이게, 7절),
`open-next.config.ts`(정적 자산 증분 캐시, 4절), `playwright.config.ts`(빌드에 `SITE_URL`), `package.json`(스크립트·의존성).

## 2. 결정과 근거

### 데이터
- `data/artifacts/dev/seo-pairs.json`(P2c, 허브 30곳 편집 선정 `data/config/seo-hubs.csv`, 435쌍×상위 3)을 **빌드 때** 읽는다. `SEO_PAIRS_FILE`로 경로를 바꿀 수 있고,
  파일이 없으면 **빌드를 멈춘다**(개발용 표본으로 조용히 넘어가면 가짜 추천이 공개될 수 있다). 같은 폴더 `manifest.json`의 `files.seoPages`(바이트·sha256)와 `dataVersion`을 대조한다.
- 웹은 순위를 계산하지 않는다. 파일 순서가 곧 순위이고, 최장·차이·합계가 `times`와 어긋나면(`maxSeconds` 등) 검증이 실패한다. 이유 문장은 **그대로 보여 주기만** 하고
  코드·테스트에 문장 내용을 박지 않았다(W2가 표기를 바꿔 다시 만든다).
- 형식은 계약처럼 엄격하다: 알 수 없는 키, a≥b, 같은 쌍 중복, 한 쌍 안의 같은 역, 4개 이상의 결과는 오류.

### 의미 있는 쌍만 (얇은 페이지 방지)
실제 435쌍 중 **413쌍이 페이지**가 되고 22쌍은 거른다(`MEANINGFUL`, `skipReason`; 사유는 `loadSeoSite().skipped`).

| 기준 | 근거 |
|---|---|
| 후보가 2개 미만이면 거름 | 고를 거리가 없으면 페이지가 얇다 |
| 1위 최장 ≤ 5분(300초)이면 거름 | "이미 같은 동네"(SituationAdvisor 기준). 435쌍 중 22쌍이 여기 해당(예: 종각·종로3가 같은 인접 쌍) |
| 1위 최장 > 90분이면 거름 | "한쪽 동네에서 만나세요"가 답이라 조합 페이지로 의미가 약하다. 현재 데이터에는 0쌍(최대 30분) |
| 두 역 이름이 같으면 거름 | 이름만 같은 별개 역(신촌 2호선·경의중앙 등)을 한 화면에 "신촌·신촌"으로 쓰지 않는다 |

조합 수는 파이프라인이 상한을 정한다(허브 30곳 → 최대 435쌍). 3단계(조합 전체, 수십만 개)는 하지 않는다(tech-stack 6.3).

### URL: `/meet/<코드>-<코드>` (한글 이름·둘 다 아님)
| 후보 | 판단 |
|---|---|
| `/meet/강남-홍대입구` (이름) | 읽기 좋고 키워드가 들어가지만 **실측에서 실패**: OpenNext/Cloudflare(wrangler dev)에서 `generateStaticParams`로 만든 **비ASCII 경로 SSG 페이지가 404**였다(같은 구성의 `/zz/abc`·`/zz/a-b`는 200, `/zz/한글`만 404. 정적 증분 캐시 조회 전에 라우터가 거절). 개명하면 주소가 바뀌는 단점도 있다 |
| `/meet/1qs-dxy` (코드) | **채택.** ASCII라 안전하고, 코드는 개명에도 안 바뀐다(data-format §2). 사람이 읽을 수 없지만 제목·H1·설명이 한글 이름을 담는다 |
| 둘 다(이름 주소 + 코드 리다이렉트) | 위 실패로 이름 주소를 못 쓴다 |

- **정규화**: 두 코드를 사전순(작은 쪽이 앞)으로. 파일의 `a<b`와 같은 규칙이라 `pairSlug`가 어느 순서로 줘도 같은 주소를 낸다. canonical·og:url·사이트맵·내부 링크는 모두 정규 주소.
- **반대 순서(B-A)는 404.** 리다이렉트(조합당 1개, 413개)는 만들지 않았다: 리다이렉트 규칙이 Worker에 실려(요청마다 정규식 검사) Worker가 커지고(조합당 약 4.6 KiB 중 일부), 우리가 만드는 링크는 정규 주소뿐이라 B-A가 나올 일이 없다.
- 화면의 역 이름 순서는 가나다 순(`강남·홍대입구`)이며 주소 순서와 다를 수 있다. 시간은 이름에 맞게 매핑된다(테스트로 고정).
- 페이지 구성: 빵부스러기, H1("A역·B역 중간 만날 곳 추천"), 후보 3곳(역·노선, 출발역별 시간·환승 막대, 최장·차이·합계, 이유 문장), "다른 역으로 다시 찾기"(입력 화면 미리 채움),
  같은 역이 들어간 다른 조합 최대 6개(내부 링크), 데이터 기준 안내(날짜·버전·출처·한계). 허브(`/meet`)는 역 30곳별로 상대 역 링크를 묶어 보여 준다(조합은 두 역 아래에 한 번씩).
- 문구 톤은 product-ux를 따랐다(제안하는 말투, 손해 보는 사람을 숨기지 않음, "역에서 역까지 기준"). 개인정보처리방침 링크는 아직 페이지가 없어 넣지 않았다(결정 필요 2).

### 메타데이터
- 페이지별 `title`(`A역·B역 중간 만날 곳 추천 3곳 | 반반역`), `description`(1위와 각자 시간을 앞에, 100자 안쪽), canonical(절대 주소), Open Graph, Twitter(`summary_large_image`). 하위 페이지는 `openGraph`·`twitter`를 통째로 다시 채운다(Next는 최상위 키 단위로 덮어쓴다).
  OG 이미지 태그는 `opengraph-image` 파일 규약이 붙이고 Twitter도 같은 이미지를 쓴다.
- JSON-LD는 빵부스러기(BreadcrumbList)만. 후기·FAQ·평점 같은 근거 없는 마크업은 넣지 않았다. `<script>` 안에서 `<`를 이스케이프한다(`dangerouslySetInnerHTML` 없이 React 19 글자 자식으로).
- **`SITE_URL`**: 하드코딩 없음, 기본 `http://localhost:3000`. 형식 오류(경로 포함 등)는 빌드 실패. **빌드 때 정해진다**(정적 페이지의 canonical·OG에 박히므로 P8이 배포 빌드에 넣어야 한다).
  `SITE_URL`이 없거나 localhost류면 모든 페이지 `noindex`, robots.txt는 전체 차단(개발·미리보기 배포가 색인되지 않게).
- `/s`(공유 링크)는 색인하지 않지만(`noindex`) **robots.txt로 막지 않는다**: 카카오톡·슬랙 같은 미리보기 크롤러가 읽어야 하고, 구글은 막혀 있으면 `noindex`도 못 읽는다.
  robots.txt는 `/api/`만 막고 sitemap을 안내한다. sitemap.xml은 홈·허브·조합 413개(`lastmod` = dataVersion 날짜).

### OG 이미지
- **조합 페이지: 빌드 때 정적 생성**(`opengraph-image.tsx`, `generateStaticParams`). 요청 때는 그림을 그리지 않는다. 413장, 평균 53 KB(합 약 21 MB), 빌드 전체(835쪽 prerender) 약 2초.
- **공유 링크 `/s`: 동적**(`app/s/og/route.tsx`). `opengraph-image` 규약은 `searchParams`를 못 받아 라우트 핸들러로 만들었다. `generateMetadata`가 서버 API로 결과를 받아 제목("{1위역}에서 볼까?")·설명("나 34분 · 지훈 38분 · 공평하게 고름")을 만들고
  이미지 주소는 `/s/og?<링크 쿼리>&dv=<dataVersion>`(새 데이터에서 주소가 바뀌어 크롤러 캐시를 비켜 감). 서버가 3초 안에 못 답하면 사이트 기본 미리보기로 간다. 이미지 안의 문구는 쿼리가 아니라 서버 결과로만 만든다(임의 문구 주입 방지).
  결과 화면용 요청과 합쳐 한 번만 부르지는 못한다(P4의 `ResultLoader`가 따로 prefetch). 필요하면 후속으로 같은 캐시 함수를 쓰게 한다.
- **글꼴**: Pretendard Bold(OFL 1.1, 의존성 `pretendard@1.3.9`에서 읽음)를 `subset-font`(harfbuzz)로 서브셋: ASCII + KS X 1001 한글 2,350자 + 역 이름(`og-glyphs.txt`, 웹 역 인덱스) + 고정 문구(`og-text.ts`) = **2,448자, 349 KB**.
  KS X 1001을 넣은 이유: 공유 링크 별칭(예: "지훈")이 역 이름에 없는 글자를 쓰기 때문(역 이름만 서브셋하면 89 KB지만 별칭이 자주 대체 이름으로 바뀐다).
  - **라이선스**: Pretendard는 OFL 1.1이고 *Reserved Font Name "Pretendard"*라서 서브셋(수정본)이 그 이름을 쓸 수 없다. 글꼴 안의 이름(name 표, CFF 이름·문자열)을 `BanbanSans`로 바꾸고, 결과에 `Pretendard`가 남으면 스크립트가 실패한다.
    원 저작권 표기와 OFL 전문은 `public/fonts/OFL.txt`로 동봉한다(테스트로 확인).
  - 스크립트는 결정적이다(같은 입력 → 같은 바이트). CI `check:contracts`가 `pnpm gen`(+글꼴) 재생성 후 `git diff`로 확인한다.
- **서브셋에 없는 글자**: `ogSafeName`이 별칭에서 글꼴에 없는 글자(이모지·한자 등)를 빼고, 남는 게 없으면 기본 이름("나/친구N")으로 바꾼다. 7글자를 넘으면 말줄임표. 빈 네모(□)는 나오지 않는다.
  역 이름은 서브셋에 반드시 들어간다(테스트: 역 인덱스·`og-glyphs.txt`의 모든 글자가 글꼴에 있음).

## 3. 의존성 (게시 후 7일 이상, 2026-11-14 기준)

| 패키지 | 버전 | 게시일(npm `time`) | 용도 |
|---|---|---|---|
| `subset-font` (dev) | 2.9.0 | 2026-09-20 | 글꼴 서브셋(스크립트 전용) |
| `harfbuzzjs` (전이) | 1.6.4 | 2026-10-22 | 위의 harfbuzz wasm |
| `fontverter`, `p-limit` (전이) | 2.0.0, 3.1.0 | 2021-04-19, — | 위의 의존 |

pnpm `minimumReleaseAge: 10080`이 전이 의존성까지 강제한다. 새 런타임 의존성은 없다(`next/og`는 Next에 포함). 글꼴은 이미 의존성인 `pretendard` 패키지에서 읽어 **다운로드가 없다**.

## 4. OpenNext / Cloudflare

- **발견**: `open-next.config.ts`가 기본값이면 증분 캐시가 비어 있어 "정적" 페이지와 정적 OG 이미지도 **요청마다 Worker 안에서 다시 렌더**된다(wrangler dev에서 `/meet`이 파일을 읽다 500, 조합 페이지는 404).
  정적 SEO 페이지·정적 OG의 전제(CPU 10ms 회피)가 성립하려면 미리 만든 결과를 읽어야 한다. → `staticAssetsIncrementalCache`(읽기 전용, Workers Static Assets에서 읽음)로 설정했다.
  재검증(ISR)이 필요해지면 R2/KV로 바꾼다(P8). P4의 홈(`/`)·404도 같은 이유로 이 설정의 덕을 본다.
- **배포 순서(P8)**: 캐시를 정적 자산에 채우는 일은 `opennextjs-cloudflare populateCache`(또는 `deploy`)가 한다. `pnpm cf:build`만으로는 채워지지 않으므로 배포·미리보기는 `build → populateCache → deploy` 순서여야 한다.
  로컬 확인: `pnpm cf:build && pnpm exec opennextjs-cloudflare populateCache local && pnpm exec wrangler dev`.
- 글꼴은 Workers 정적 자산(`public/fonts`)이고, 동적 OG 라우트는 `ASSETS` 바인딩으로 읽는다(Workers 밖 Node에서는 파일). 한 번 읽으면 isolate 안에서 재사용.
- `process.cwd()` 기준 fs는 빌드 때만 쓴다(`load.ts`, `/* turbopackIgnore */`로 프로젝트 전체 추적 방지). Workers 런타임에서는 `dynamicParams = false`라 데이터 파일을 읽지 않는다.

## 5. 측정 (2026-11-14, 로컬 macOS)

| 항목 | 값 | 비고 |
|---|---|---|
| Worker 크기(`wrangler deploy --dry-run`) | **11,107.52 KiB / gzip 2,373.94 KiB** | P4 기준 5,383.54 / 1,172.49. +5.4 MiB(raw)·+1.1 MiB(gzip) |
| 증가 분해 | `next/og`(resvg.wasm 1.4 MiB·yoga 72 KiB·Geist 글꼴 126 KiB·satori JS) 약 +3.8 MiB(조합 페이지 7개일 때 9,248 KiB) + 조합 페이지 413개의 라우트·prerender manifest 약 +1.8 MiB(**조합당 약 4.6 KiB**, 매니페스트가 번들에 여러 벌 실림) | 무료 한도 raw 64 MiB(spikes/REPORT.md 2절 열람) 이내. 계정의 실제 업로드 검증은 P8 |
| 정적 자산 | 946개 파일, 95 MB(증분 캐시 91 MB: 페이지 HTML·RSC·OG PNG base64) | 파일당 25 MiB 한도·파일 수 한도 이내 |
| 글꼴 | 349 KB(원본 Bold 1.6 MB, 전체 CJK 16 MB) | 스파이크의 고정 문구 서브셋은 11 KB였으나 임의 별칭을 못 그렸다 |
| 정적 OG 생성(빌드) | 413장, 평균 53 KB, prerender 835쪽 전체 약 1.9 s(11 workers) | `next build` 전체 약 8 s |
| 정적 페이지·정적 OG 응답(wrangler dev, 캐시에서) | 페이지 4~6 ms, OG PNG 4 ms | CPU 아님(벽시계) |
| 동적 `/s/og` 응답(wrangler dev, warm) | 약 37 ms(첫 요청 103 ms) | 서버 호출(가짜 서버)·글꼴 읽기·satori·PNG 포함, 벽시계 |
| 동적 `/s/og` CPU(Node `next start`, 40회 평균) | **약 13.8 ms/요청**(같은 서버의 robots.txt는 1.0 ms) | CPU 시간(`ps`). 무료 Workers CPU 10 ms를 **넘을 가능성이 크다** |

**위험**: 공유 링크 동적 OG(`/s/og`)는 satori + resvg(wasm)라 CPU가 약 14 ms로 측정돼 Workers **무료 플랜(요청당 CPU 10 ms)에서는 오류(1102)가 날 수 있다**. 조합 페이지(정적)는 영향 없음.
실제 Workers CPU는 계정에서 측정해야 한다(wrangler dev는 CPU를 보고하지 않는다). 선택지는 결정 필요 1.

## 6. 검증 (2026-11-14, 로컬)

```text
$ pnpm typecheck && pnpm lint          # tsc, Biome, ESLint(타입 규칙), Knip, dependency-cruiser 모두 통과, 예외(suppress·baseline) 추가 없음
$ pnpm test                            # Vitest: 24 파일 213 테스트 통과
$ pnpm check:contracts                 # 재생성(API 타입·역 인덱스·OG 글꼴) 후 diff 없음
$ pnpm e2e                             # Playwright 7개 통과(기존 4 + SEO 3: 허브→조합 페이지·메타·정적 OG PNG·다시 찾기·axe 위반 0, sitemap/robots, 공유 링크 미리보기·동적 OG)
$ pnpm cf:build                        # OpenNext 빌드 성공
$ pnpm exec opennextjs-cloudflare populateCache local && pnpm exec wrangler dev
  /meet 200, /meet/<a>-<b> 200, 반대 순서 404, /meet/<a>-<b>/opengraph-image-… 200 image/png,
  /s/og 200 image/png, /sitemap.xml 200, /robots.txt 200
```

테스트는 데이터 내용(이유 문장)에 의존하지 않는다: 실제 파일은 수·형식·manifest 대조만 보고, 문장·역 이름이 필요한 단위 테스트는 `web/fixtures/seo-pairs.json`(테스트 전용 표본)을 쓴다. e2e는 허브의 첫 링크를 따라간다.

## 7. 기타 발견

- **P4 버그 수정**: 기억해 둔 "나"처럼 부모가 역을 채워 넣어도 `StationField`의 입력 칸이 비어 있었다(내부 `query`가 처음 마운트 때만 값에서 초기화). 값이 밖에서 바뀌면 이름을 보여 주게 고쳤다(테스트 추가).
- P4의 `shareMessage`는 설명을 `…· {모드}로 고름`으로 만들어 "공평하게로 고름"이 된다(product-ux 예시는 "공평하게 고름"). 이번 OG 설명은 모드별 문장(`공평하게 고름`/`가장 빠른 만남으로 고름`/`{이름} 쪽으로 고름`)을 따로 썼다. 공유 문구를 맞출지는 P4 소관.
- 이유 문장의 이름 표기는 W2가 바꾼다. 페이지는 문장을 그대로 보여 주므로 코드 변경 없이 따라간다.

## 8. 결정 필요

1. **동적 `/s/og`의 Workers CPU.** 약 14 ms(Node 측정)라 무료 플랜 10 ms를 넘을 수 있다. 선택지: (a) Workers 유료 플랜(월 $5, CPU 한도 상향) — 권고, 이미 수익화 계획이 있다, (b) 이미지를 작게(예: 800×420)·단순하게 줄여 CPU를 낮추고 계정에서 재측정, (c) 공유 링크 미리보기를 정적 기본 이미지로 후퇴(각자 시간 미리보기 포기, 제품 가치 손실). 계정이 생기면 P8에서 실제 CPU를 측정해 정한다.
2. **개인정보처리방침·출처 푸터**: 데이터 기준 안내에 공공누리 1유형 출처 표시는 넣었다. 개인정보처리방침 페이지가 없어 링크는 없다(tech-stack 6.3 필수 항목). 페이지가 생기면 `DataBasis` 아래에 링크를 단다.
3. **옛 역 이름 → 새 주소 리다이렉트는 필요 없다**(주소가 코드라서). 다만 `deprecated`로 퇴역한 코드가 조합 데이터에 남으면 역 인덱스에 없어 빌드가 멈춘다(의도: 데이터 게이트). P2c가 퇴역 코드를 조합에 넣지 않는지 확인 필요.
4. **`SITE_URL`·`API_ORIGIN`은 빌드 때 고정**: P8의 배포 빌드가 둘 다 넣어야 한다(P4 노트 6.7과 같은 문제). `SITE_URL`이 빠지면 배포가 색인되지 않는다(안전한 쪽).
5. **조합 수 상한**: 조합당 Worker +4.6 KiB, 정적 자산 +약 0.2 MB(캐시). 수천 쌍까지는 무리가 없지만 상한을 정하려면 Search Console 데이터가 필요하다(tech-stack 6.3 3단계).
