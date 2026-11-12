# 반반역 — 조사 종합 (코디네이터)

개정 2026-11-12 (2판: tech-stack 3판 반영). 근거 문서: [data-sources](research/data-sources.md) · [product-ux](research/product-ux.md) · [tech-stack 3판](research/tech-stack.md) · [algorithm](research/algorithm.md)

## 1. 한 줄 결론

공공데이터로 노선 그래프를 직접 만들어 미리 계산하고, Kotlin(KMP) 코어 하나를 서버·웹·앱이 같이 쓴다. 웹+서버를 먼저 내고 Android, iOS 순서로 붙인다. 승부처는 신뢰(정확한 시간, 납득되는 카드)와 "오늘은 ○○ 쪽으로" 배려 모드다.

## 2. 확정된 것

| 영역 | 결정 | 출처 |
|---|---|---|
| 제품 | 비회원, 익명 사용자 ID, 후보 3개 카드(사람별 시간·환승·이유), 모드 3종, 막차는 2차 | B, 사용자 |
| 공평 규칙 | fair = (최장, 차이, 합계, ID), favor 상한 = fair 1위 대비 +min(15분, 50%), 기본 동점 0분 | D |
| 데이터 | 자체 그래프 사전계산. 외부 경로 API 결과는 저장하지 않음. KTDB는 허용 범위 확인 전 사용 안 함 | A |
| 공유 코어 | KMP `shared/{core,schema,links,api-client,app-logic,analytics}` | C3, 사용자 |
| 서버 | Ktor + Cloud Run(서울, min 0) + Postgres | C3 |
| 웹 | Next.js(App Router) on **Cloudflare Workers + OpenNext** (수익화 계획이 있어 Vercel Hobby의 비상업 제한을 피함). 인기 역 조합 SEO 페이지 + 링크별 동적 OG | C3, 사용자 |
| 숨기기 | 숨긴 출발역은 이름만 가리고 시간은 보임 | 사용자 |
| 앱 | Android Compose → iOS SwiftUI. RN/Expo/Compose Multiplatform 아님 | 사용자 |
| 공유 방식 | 혼자 입력 → URL 상태(3자 base32 역 코드), 각자 입력/숨기기 → 서버 방 ID | C3 |
| 계산 위치 | 클라이언트(혼자 입력, 즉시) + 서버(방, 숨기기). 코어는 한 벌 | C3 |
| 통계 | PostHog, 익명 ID 시작, 출발역은 이벤트에 넣지 않음 | 사용자 |
| 저장소 | 퍼블릭 GitHub 모노레포 하나 (Gradle 루트 + pnpm web + Xcode ios) | 사용자 |
| plane 분리 | control = 파이프라인 + 검증 게이트 + 해시 산출물을 GCS에 발행 + manifest 포인터. data = 서버 + 웹. 관리자 서버 없음 | 코디네이터, C3 |
| 비밀값 | 원본은 개인 1Password. 로컬은 `.env.tpl` + `op run`, CI는 OIDC(WIF) + 서비스 계정 또는 Environment secrets, 런타임은 Secret Manager | 사용자, C3 |
| 웹 계산 | **웹은 추천을 직접 계산하지 않고 서버 API를 호출**. 웹과 서버의 결합은 `contracts/openapi.yaml`(contract-first)로만. KMP js 타깃은 끔. 입력 화면이 열릴 때 `/healthz`로 서버를 미리 깨움 | 사용자, 코디네이터 |
| 서버 구조 | Gradle 멀티모듈 모듈러 모놀리스: `server/{app, room, recommendation, artifact}` + `build-logic` 관례 플러그인. 기능 모듈끼리 의존 금지. 헥사고널은 아님. 프레임워크는 **Spring Boot(MVC + 가상 스레드) + Liquibase(SQL changelog)**. JPA/JDBC는 S0b 실측으로 결정. **대체 규칙: Spring 콜드스타트 때문에 상시 가동(min 1) 비용이 들어야 한다면 Ktor + 코루틴(+ Exposed)으로 간다.** 실제로 갈아끼울 곳에만 포트(`ArtifactStore`, `TravelTimeProvider`, `Clock`/`IdGenerator`) | 사용자, 코디네이터 |
| 웹 세부 | TypeScript, Tailwind v4, shadcn/ui **Base UI 기반**(디자인 토큰 자체 설정, 역 검색은 Base UI Combobox), Pretendard, openapi-typescript + openapi-fetch, RSC + TanStack Query, nuqs(URL 상태), 전역 상태 없음, zod, es-hangul(초성 검색), Vitest, Playwright | 코디네이터 |
| 정적 검사 | TS: 엄격한 tsc, Biome(포맷+린트), typescript-eslint 타입 규칙 일부, Knip, dependency-cruiser, 계약 동기화 검사. Kotlin: ktlint, detekt, Konsist. 골격을 만들 때 같이 넣고 CI에서 강제 | 사용자, 코디네이터 |
| 골든 테스트 | `contracts/golden/`으로 이관하고 전체 순위 스냅샷을 추가. Python 오라클과 Kotlin 각 타깃이 같은 스냅샷을 통과 | C3 |

## 3. 코디네이터 검토 의견 (C3에 대한 조정)

1. **S0에서 KMP 타깃을 줄인다.** S0에서는 jvm + js만 켜고, android 타깃은 A1, ios 타깃은 I1에서 추가한다. iOS 타깃은 macOS 빌드가 필요해서 CI가 느려지고 비용도 생길 수 있는데, 웹 단계에서는 얻는 게 없다.
2. **DB 리전이 어긋난다.** Neon은 싱가포르이고 서버는 서울이라 쿼리마다 왕복 지연이 생기고 국외 이전 고지도 필요하다. S0에서 서울 리전이 있는 무료 Postgres 후보(예: Supabase 서울. 단 비활동 시 일시정지 조건 확인)와 비교한다.
3. **콜드스타트는 친구가 링크를 처음 여는 순간에 걸린다.** 방 링크를 처음 열 때 JVM 콜드스타트가 첫인상을 해친다. S0 스파이크에서 실측하고, 3초를 넘으면 상시 가동(min 1) 또는 Fly.io로 간다.
4. **vault 3개 분리(로컬/CI/릴리스)는 수용한다.** `banbanyeok`은 생성했다. `-ci`와 `-release`는 S0에서 서비스 계정 가능 여부를 확인한 뒤 만든다.
5. **19개 결정 항목 중 대부분은 기본값으로 정한다** (아래 4절).

## 4. 결정 항목 정리 (C3의 19건)

**코디네이터 기본값으로 진행** (이의가 있으면 변경): 수치는 내부 정수 초(5) · 방 만료 7일 슬라이딩/최대 30일, 약속일 선택(7) · API는 같은 출처 rewrite(10) · 산출물은 GCS+WIF(11) · KTDB 미사용(12) · 스토어 제출은 로컬 수동(15) · 데이터 발행은 수동 디스패치 + 주간 예약(18) · iOS CI는 로컬 빌드(19) · 로그인은 당분간 없음(17) · PostHog 리전은 S0에서 결정(9).

**사용자 결정 완료:** 수익화 있음 → Cloudflare + OpenNext (4) · 숨기기는 이름만 (6)

**사용자 결정 대기:**
- 코드 라이선스 (13): AGPL-3.0(권고, 오픈소스 유지 + 닫힌 복제 서비스 차단) vs FSL(2년 경쟁 금지, 비 OSI). 정할 때까지 저장소는 private
- iOS 출시 시점과 비용 (1): 나중에 정해도 됨

**사용자 직접 처리 (계정 필요):** [setup/accounts.md](setup/accounts.md) 체크리스트로 관리.

## 5. 2단계 구현 계획

**웨이브 0 (병렬 2개)**
| 단위 | 소유 | 에이전트 / 모델 / effort |
|---|---|---|
| S0a 골격 + 계약 | 루트 Gradle/pnpm/mise, `.gitignore`, `contracts/`, `shared/schema/`, `data/registry/`, gitleaks | Claude Sonnet 5.5 / high |
| S0b 스파이크 | `spikes/` (Kotlin/JS → Next.js import, Next.js를 OpenNext로 Cloudflare Workers용 빌드 + 동적 OG CPU 측정(로컬 wrangler), Ktor 기동 시간 로컬 실측) | Codex gpt-6.1-sol / high |

Cloud Run 콜드스타트와 WIF 배포 실측은 GCP 프로젝트가 생긴 뒤 P8에서 한다.

**웨이브 1 (S0a 완료 후)**: P1 코어(Codex high) · P2 파이프라인(Codex high) · P3 서버(Sonnet high) · P6 공유 클라이언트 모듈(Sonnet high)

**웨이브 2**: P4 웹 앱(Opus high) · P5 SEO/OG(Sonnet high) · P7 통계(Sonnet high) · P8 CI/인프라(Sonnet high, GCP 필요)

**후속**: A1 Android → I1 iOS → L1 로그인
