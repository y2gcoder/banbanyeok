# 기술스택과 아키텍처 제안 (작업 C) — 3판

작성일: 2026-11-12 · 3판 개정: 2026-11-12 · 작성: 작업 C 담당 · 상태: 제안 (코디네이터 종합 대상)

표기: **[확인]** = 출처 URL을 직접 읽어 확인한 사실(확인일 2026-11-12), **[추정]** = 계산·일반 지식·경험에 기반한 추정(검증 필요), **[미확인]** = 확인하지 못한 것. 환율은 1 USD ≈ 1,400원으로 가정한다 [추정].

---

## 변경 이력

| 판 | 내용 |
|---|---|
| 1판 | 웹 SPA(Vite+React) + Cloudflare Pages + 브라우저 계산 + URL 상태 공유, 서버·DB 없음 |
| 2판 | 모바일 앱(Capacitor 먼저, Expo는 나중) 비교, control/data plane 검토, `manifest.json` 포인터 도입 |
| **3판** | **사용자가 전제를 바꿈**: (1) 웹+iOS+Android 세 개를 모두 만들고 앱은 RN/Expo가 아니라 Swift+Kotlin(KMP). (2) 서버가 필요함(방 상태, 출발지 숨기기, 통계). (3) 웹은 Next.js(SEO·동적 OG). (4) 공유 URL은 한국어 대신 짧은 역 코드. (5) 사용 통계는 PostHog 확정. (6) 코드는 GitHub **퍼블릭** 레포. (7) 비회원 서비스로 시작, 나중에 로그인 연결. (8) 웹+서버 먼저 출시, Android·iOS는 검증 후 순서대로. (9) 모노레포 하나. (10) 비밀값 원본은 사용자 개인 1Password vault. 이에 따라 스택·구조·plane 설계를 처음부터 다시 썼다. 폐기한 1~2판 결론은 1장 표 참고 |

---

## 1. 결론 / 권고

### 1.1 권고 스택 (한 가지)

| 영역 | 권고 | 한 줄 이유 |
|---|---|---|
| **공유 코어** | **Kotlin Multiplatform(KMP)**: `shared/core`(추천 알고리즘)·`schema`(데이터 형식)·`links`(링크 코덱)·`api-client`·`app-logic`. 타깃은 JVM(서버·파이프라인), Android, iOS, JS | 알고리즘·형식을 한 번만 쓰고 서버·앱·웹이 같이 쓴다. 사용자가 Kotlin에 익숙 |
| **서버** | **Ktor 3.x**(JVM) + kotlinx.serialization + Postgres(Exposed/Flyway) | 작은 API(약 10개), KMP와 직렬화·클라이언트 공유, Spring보다 가볍다 [추정] |
| **DB** | **Neon Postgres 무료 플랜**(싱가포르 리전) | 방 상태는 작고 일시적. 무료 한도 충분 [확인] |
| **서버 호스팅** | **Google Cloud Run**(서울 리전, min-instances=0) | 무료 구간, GitHub OIDC 키리스 배포, Secret Manager [확인] |
| **데이터 산출물** | 파이프라인이 만든 불변 해시 파일 + `manifest.json` 포인터를 **GCS 비공개 버킷**(OIDC 키리스)에 발행, 서버가 시작할 때 받아 메모리에 올림 | 장기 배포 키를 없앤다. 서버가 마지막 정상 버전으로 계속 돈다 |
| **웹** | **Next.js(App Router, TypeScript)** + Vercel Hobby. 인기 역 조합 SSG, 공유 링크별 동적 OG | SEO·메타 태그·OG가 일급 기능. 비상업 조건 |
| **Android** | Jetpack Compose(네이티브 Kotlin) + `shared` | 사용자 결정(네이티브) |
| **iOS** | SwiftUI + `shared`(direct integration으로 XCFramework 링크) | 사용자 결정(네이티브) |
| **통계** | **PostHog Cloud 무료 플랜**(익명 distinct_id, 출발역은 속성에 넣지 않음) | 사용자 확정. 월 100만 이벤트 무료 [확인] |
| **파이프라인** | **Kotlin(JVM) CLI**, GitHub Actions 예약/수동 실행 | `schema` 코덱을 서버·웹과 공유 |
| **저장소** | **모노레포 하나**. Kotlin은 Gradle 루트, 웹은 pnpm workspace, iOS는 Xcode 프로젝트 | 사용자·코디네이터 결정 |
| **CI/비밀값** | GitHub Actions(퍼블릭이라 표준 러너 무료 [확인]) + **OIDC(Workload Identity Federation)**로 GCP 키리스 + 런타임은 Secret Manager. **값의 원본은 개인 1Password vault**, 로컬은 `.env.tpl`(참조만 커밋)+`op run`(`OP_ACCOUNT`로 개인 계정 고정), CI는 서비스 계정+`load-secrets-action`(불가 시 Environment secrets 수동 동기화) | 장기 키 최소화, 원본 일원화 |

### 1.2 출시 순서

1. **웹 + 서버** (S0 계약 → 병렬 구현). KMP `shared`는 처음부터 서버(JVM)와 공유하고, 웹은 Kotlin/JS로 쓰거나 서버 API를 호출한다(3장).
2. **Android** — 웹 검증 후. `shared`를 그대로 붙인다.
3. **iOS** — Android 다음. Apple 개발자 프로그램 비용(연 99 USD [확인])이 따로 든다.

### 1.3 월 비용 요약 (목표 1만 원 이하)

| 단계 | 월 비용 | 근거 |
|---|---|---|
| 웹+서버 (출시 1단계) | **약 0~2,000원** (도메인만) | Vercel Hobby·Cloud Run·Neon·PostHog·GitHub Actions 모두 무료 구간 [확인]. 도메인 연 1~2만 원 [추정] |
| + Android | 일회성 25 USD ≈ 3.5만 원 [확인] | Google Play 등록비 1회 |
| + iOS | **월 환산 약 11,500원** (연 99 USD ≈ 13.9만 원) [확인] | 이것만으로 월 1만 원 목표를 넘는다 → 결정 필요 |
| 서버를 항상 켜 둬야 할 때(콜드스타트 회피) | Cloud Run min-instance 1 ≈ 월 10달러 안팎 [추정, 아래 5.3] 또는 Fly.io 512MB 월 3.69달러 [확인] | 4장 비교 |

### 1.4 폐기·변경한 1~2판 결론

| 1~2판 결론 | 3판 | 이유 |
|---|---|---|
| 서버 없음, DB 없음 | **폐기** | 사용자가 방 상태·출발지 숨기기·통계를 원함. 숨기기는 서버 계산이 필요(3장) |
| TypeScript 전체 + pnpm 모노레포 | **폐기** → Kotlin(KMP+JVM) 중심, TS는 `web/`만 | 앱이 Swift/Kotlin, 코어를 서버·앱이 공유해야 함 |
| Vite+React SPA, Cloudflare Pages Function으로 OG | **폐기** → Next.js, Vercel Hobby | SEO·페이지별 메타·동적 OG |
| Capacitor 먼저, 필요하면 Expo | **폐기** | 사용자가 RN/Expo를 원치 않고 네이티브/KMP를 선택 |
| 공유 URL의 역 id는 숫자 점 연결 | **변경** → 자체 발급 3자 base32 코드 | 한국어·긴 숫자 대신 짧고 안정적인 코드 |
| 파이프라인 TypeScript | **변경** → Kotlin(JVM) | `schema` 코덱 공유 |
| Vercel Hobby는 3순위 | **변경** → 1순위(비상업 조건부) | Next.js에 가장 마찰이 적다 |
| "요청 경로는 컨트롤 플레인을 지나지 않는다 = 서버가 없어서" | **재작성** (10장) | 서버가 생겨 요청 경로·배포 경로를 다시 매핑 |
| 웹은 브라우저 계산만 | **유지·확장** | 혼자 입력(URL 상태)은 클라이언트 계산, 방·숨기기는 서버 계산 |
| `manifest.json` + 불변 해시 파일 | **유지** | 저장소만 GCS로 |
| URL 상태 공유(서버 저장 없음) | **유지(혼자 입력 전용)** + 방 ID 방식 추가 | UX 조사 B의 "30초, 한 사람이 전부 입력" 유지 |
| 최소 PWA | **우선순위 하향** | 네이티브 앱이 생김. 웹은 SEO·링크 입구 |
| 월 0원 | **조정** | 웹+서버 약 0~2천 원, iOS 포함 시 월 환산 약 1.15만 원 추가 |

### 1.5 질문 A~H에 대한 답 (각 권고 1개)

| 질문 | 권고 | 상세 |
|---|---|---|
| A. 추천 계산 위치 | **(c) 서버 + 클라이언트 둘 다**, 단 코어는 KMP 한 벌 | 3장 |
| B. 앱 | **KMP(로직) + 네이티브 UI(Compose/SwiftUI)** | 4장 |
| C. 서버 | **Ktor + Cloud Run + Neon Postgres** | 5장 |
| D. 웹 | **Next.js(App Router) on Vercel Hobby**, Astro는 비권고 | 6장 |
| E. 통계 | **PostHog**(확정), 이벤트 설계·프라이버시 | 7장 |
| F. 공유 URL | **혼자 입력은 URL 상태, 각자 입력은 방 ID.** 3자 base32 역 코드 | 8장 |
| G. 파이프라인 언어 | **Kotlin(JVM)** | 9장 |
| H. control/data plane | **배포 단위와 의존 방향의 분리**, 관리자 서버 없음 | 10장 |

---

## 2. 전제와 근거 문서

- 제품: 브리프·종합·UX 조사(`product-ux.md`)에서 정한 대로 가입·권한 요구 없는 비회원 서비스, 결과 후보 3개, 사람별 시간·환승·추천 이유, 모드 3종. 한 사람이 전부 입력하는 흐름이 30초 목표의 핵심이다.
- 알고리즘: `algorithm.md`의 fair/fast/favor 규칙과 골든 시나리오 16건(`prototype/scenarios.json`). 입력은 N×C 시간·환승 행렬이다.
- 데이터: `data-sources.md`. 기관마다 역 코드가 달라 **자체 역 코드 레지스트리**가 필요하다. KTDB 가공물의 상업 배포 범위는 미확정, TMAP은 24시간 이상 저장 불가, ODsay·카카오는 저장에 사전 동의가 필요하다.

---

## 3. A. 추천 계산 위치

### 3.1 비교

| 기준 | (a) 서버만 계산, 웹·앱은 API 호출 | (b) KMP 코어를 앱·웹이 모두 사용(서버 없음) | **(c) 서버 + 클라이언트 둘 다 (권고)** |
|---|---|---|---|
| 지연시간 | 요청당 왕복 + 서버 콜드스타트(JVM, 아래 5.3) | 즉시(로컬) | 혼자 입력은 즉시, 방 결과는 왕복 |
| 오프라인 | 불가 | 가능(번들 시드 데이터) | 앱은 가능, 방은 온라인 필요 |
| 데이터 갱신 | 서버만 새 버전을 올리면 끝 | 클라이언트마다 데이터 내려받기·호환성 관리 | 서버가 기준, 클라이언트는 `manifest.json`으로 따라감 |
| 코드 중복 | 없음(서버 1벌) | KMP 1벌 | **KMP 1벌**(서버는 JVM, 앱은 네이티브, 웹은 JS) |
| 출발지 숨기기 | 가능(서버가 원본을 쥠) | **불가**(클라이언트가 남의 출발역을 알아야 계산) | 숨긴 방은 서버가 계산 |
| 1인 유지보수 | 낮음 | 중간(웹 JS 연동) | 중간~높음(KMP JS 타깃 필요) |
| 권고 이유 | 숨기기·통계·OG에는 필요 | 숨기기 불가가 결정적 약점 | 장점을 취함 |

**핵심 논거**: 출발지 숨기기는 클라이언트가 남의 출발역을 모르는 상태에서 결과를 보여줘야 하므로 서버 계산이 필수다. 반면 혼자 입력해 URL로 공유하는 기본 흐름(UX의 30초 목표)은 서버가 없어도 되고, 서버 콜드스타트(JVM)를 피하려면 클라이언트 계산이 낫다 [추정, 5.3에서 측정 항목으로 둠].

### 3.2 구체 구조

- `shared/core`는 `commonMain`만 쓰는 순수 Kotlin 함수 `rank(participants, candidates, times, transfers, mode, tolerance)` 하나로 둔다. 서버(JVM), Android, iOS(Kotlin/Native), 웹(Kotlin/JS)이 같은 소스를 컴파일한다. Kotlin/JVM·Native·JS는 Stable, Kotlin/Wasm은 Beta이고 Compose Multiplatform의 웹 타깃도 Beta다 [확인: https://kotlinlang.org/docs/multiplatform/supported-platforms.html, https://kotlinlang.org/docs/components-stability.html]. 따라서 웹 타깃은 **Kotlin/JS(Stable)** 로 한정한다.
- **웹 계산 방식은 S0 스파이크로 정한다**(1~2일): ① `shared`를 Kotlin/JS 라이브러리로 빌드해 Next.js가 import(번들 크기, 타입 정의, Turbopack/Webpack 호환 확인), ② 실패하면 웹도 `POST /v1/recommend`를 호출(중복 구현 없음), ③ TS 포팅은 마지막 수단(코어가 200줄 안팎이라 가능하지만 기본안으로 삼지 않음). 어느 경우든 `shared/core`는 `commonMain` 한정 규칙을 지켜 JS 타깃 컴파일이 깨지지 않게 CI에서 `jsTest`를 돌린다.
- 클라이언트 계산에 필요한 N×M 행렬은 `manifest.json`이 가리키는 불변 파일로 내려받는다(약 130KB 원본 [추정], 10장).
- 숨긴 방은 `GET /v1/rooms/{id}/result`가 서버에서 계산한다. 나머지는 클라이언트가 방 상태(`GET /v1/rooms/{id}`)를 받아 로컬 계산해도 되고 서버 결과를 써도 된다. **데이터 버전**을 방에 기록해 두 결과가 달라지지 않게 한다(5.4).

### 3.3 골든 테스트를 여러 구현이 공유하는 방법

1. `prototype/scenarios.json`을 `contracts/golden/scenarios.json`으로 옮긴다(원본은 Python 오라클이 계속 읽을 수 있게 같은 경로를 참조하거나 복사본을 CI에서 동일성 검사).
2. 현재 골든은 `expectedFirst`(1위 역)만 있다. Python 프로토타입이 출력하는 **전체 순위 스냅샷**(`contracts/golden/expected.ranking.json`: rank, 사람별 시간·환승, `reasonCode`)을 사람이 검토한 뒤 고정한다. 구현이 늘수록 1위만 맞추는 테스트는 약하다.
3. 각 구현이 같은 데이터를 읽는 방법: Gradle 태스크 `generateGoldenTests`가 JSON을 `commonTest`용 Kotlin 소스(문자열 상수)로 변환하고, kotlinx.serialization으로 파싱한다. 파일 I/O가 필요 없어 JVM·JS·iOS 시뮬레이터·Android 단위 테스트가 **똑같은 데이터**를 쓴다. 웹(TS 쪽 테스트가 필요하면)과 Python은 JSON을 직접 읽는다.
4. CI에 **오라클 일치 잡**을 둔다: Python 프로토타입이 스냅샷을 그대로 재생산하는지(`python3 -B -m unittest`)와 Kotlin 각 타깃이 같은 스냅샷을 통과하는지를 한 워크플로에서 확인한다.
5. 주의: 역 ID 정렬은 코드포인트 사전순이어야 한다(`algorithm.md`). Kotlin `String` 비교는 UTF-16 코드 단위 순이라 보충 평면 문자에서 다를 수 있다. 역 코드를 ASCII로 제한(8.3)해 이 차이를 구조적으로 없앤다. 수치는 **정수**(초 단위 권고)로 고정해 JVM·JS·Native 부동소수 차이를 피한다(결정 필요 5번).
6. 속성 테스트(순서 불변, 단조성)는 `kotest-property` 같은 멀티플랫폼 라이브러리 사용을 검토한다 [미확인, 도입 시 확인].

---

## 4. B. 앱: KMP + 네이티브 UI

### 4.1 비교

| | **KMP 로직 공유 + 네이티브 UI (권고)** | Compose Multiplatform(iOS UI까지 공유) | 완전 네이티브 두 벌 |
|---|---|---|---|
| 성숙도 | KMP Android·iOS·서버 Stable [확인: supported-platforms] | Compose Multiplatform iOS Stable [확인: 같은 문서] | 가장 성숙 |
| 공유 범위 | 알고리즘·형식·API 클라이언트·링크 코덱·화면 로직 | 위 + UI 전체 | 없음(알고리즘 2벌) |
| UI | SwiftUI·Compose 각각. 화면 3~4개로 작음 | 한 벌(Skia 렌더링) | 각각 |
| 사용자 선호 | 부합("Swift+Kotlin 또는 KMP") | 네이티브 UI 감각이 떨어질 수 있음 [추정] | 부합하나 중복 큼 |
| iOS 마찰 | 아래 4.2 | 위 + 렌더링·접근성 차이 | 없음 |
| 1인 유지보수 | 중간 | 낮음~중간 | 높음 |

**권고 이유**: 화면은 입력·결과·공유·받은 링크 4개 안팎이고 푸시·공유 시트·위젯·지도 앱 연결처럼 플랫폼 기능의 비중이 크다. UI 공유 이득이 작고 iOS의 UI 위화감 위험이 있다. 로직(추천, 링크 코덱, API, 화면 상태)은 화면과 무관하게 공유하는 쪽이 이득이 크다. Compose Multiplatform은 iOS가 Stable이라 나중에 재고할 수 있으나, 웹 타깃은 Beta라 웹에는 쓰지 않는다 [확인].

### 4.2 iOS에서 KMP를 쓸 때의 실제 마찰 (공식 문서 기준)

- **통합 방식**: ① direct integration(Xcode 빌드 단계 스크립트로 Kotlin 빌드를 iOS 빌드에 포함. KMP IDE 플러그인 기본, CocoaPods 의존성이 없을 때), ② 로컬/원격 SwiftPM(XCFramework), ③ CocoaPods(Pod 의존성을 가져올 때). 모노레포에서는 direct integration 또는 로컬 SwiftPM이 맞다 [확인: https://kotlinlang.org/docs/multiplatform/multiplatform-ios-integration-overview.html, 2026-07-21 갱신 표기].
- **Swift 연동은 아직 Obj-C 헤더 경로가 기본**: Swift export는 **Alpha**(다중 모듈, 패키지 보존, suspend/Flow→`AsyncSequence` 지원, 하지만 파괴적 변경 예상) [확인: https://kotlinlang.org/docs/native-swift-export.html]. 따라서 Alpha에 의존하지 않고, `app-logic`의 공개 API를 **Swift에서 쓰기 쉬운 모양**(단순 데이터 클래스, 콜백 또는 상태 스냅샷)으로 얇게 감싸 둔다 [추정, 설계 규칙]. C·Obj-C interop 자체는 Beta 표기다 [확인: components-stability].
- **SwiftPM import(KMP가 Swift 패키지를 가져오는 기능)는 Alpha**이고 Kotlin 2.5.0-RC가 필요하다고 안내한다 [확인: https://kotlinlang.org/docs/multiplatform/multiplatform-spm-import.html]. iOS 쪽에서 쓰는 서드파티 SDK(PostHog 등)는 **KMP가 아니라 Swift 앱 쪽에서 SwiftPM으로** 붙이고, `shared`에는 인터페이스(`AnalyticsPort`)만 둔다.
- **CocoaPods는 사실상 퇴장 중**: PostHog 문서가 "CocoaPods 공개 스펙 저장소가 2026-12-02부터 영구 읽기 전용"이라고 안내한다 [확인: https://posthog.com/docs/libraries/ios, CocoaPods 원문은 미확인]. KMP의 CocoaPods 플러그인에 의존하지 않는다.
- **일상 마찰** [추정, 일반 경험]: 첫 빌드와 Xcode→Gradle 호출이 느림, Kotlin 소스 디버깅이 Xcode에서 제한적, 제네릭·sealed class 노출 제약, iOS 빌드·테스트에는 Mac(macOS 러너)이 필요. 사용자의 Mac 환경은 이를 충족한다.
- 출시 순서상 iOS가 마지막이므로 **S0 단계에서 iOS 타깃 컴파일(`iosSimulatorArm64`)만 CI로 유지**하고, 앱 구현은 늦춘다.

### 4.3 공유할 것과 공유하지 않을 것

| 모듈 | 위치 | 공유 대상 | 설명 |
|---|---|---|---|
| `shared:core` | KMP | 서버, 웹(JS), Android, iOS | 추천 알고리즘, 입출력 타입 |
| `shared:schema` | KMP | 파이프라인(쓰기), 서버·웹·앱(읽기) | `od.bin`·`manifest`·역 레지스트리 형식 |
| `shared:links` | KMP | 전부 | 공유 URL 코덱, 지도 앱 URL 생성기 |
| `shared:api-client` | KMP(Ktor client) | 웹(JS), Android, iOS | `contracts/openapi.yaml`과 일치하는 호출·토큰 보관 인터페이스 |
| `shared:app-logic` | KMP | 웹, Android, iOS | 입력 검증, 상태 전이, 추천 이유 문장, 문자열 키 |
| `shared:analytics` | KMP | 전부 | `AnalyticsPort` 인터페이스와 이벤트 정의(7장) |
| UI | `android/`(Compose), `ios/`(SwiftUI), `web/`(React) | 공유 안 함 | |

---

## 5. C. 서버

### 5.1 프레임워크: Ktor 권고

| | **Ktor (권고)** | Spring Boot |
|---|---|---|
| 규모 적합성 | API 약 10개, 상태 단순 → 충분 | 과함 [추정] |
| KMP 연계 | 서버·클라이언트 모두 Ktor, kotlinx.serialization 공유 | 별도 직렬화(Jackson) |
| 기동 속도·메모리 | 가볍다 [추정] | 더 무겁다 [추정] |
| 생태계 | 필요한 것만 조립(인증·마이그레이션 직접) | 풍부 |
| 사용자 친숙도 | Kotlin | Java/Kotlin |
| 현재 버전 | 3.6.1 문서 [확인: https://ktor.io/docs/server-deployment.html] | 미조사 |

배포는 Ktor Gradle 플러그인으로 fat JAR/컨테이너를 만든다 [확인: 같은 문서]. JVM 서버는 콜드스타트가 길 수 있어 아래 5.3에서 측정한다. 데이터 접근은 Exposed(또는 JDBC)+Flyway 마이그레이션 [추정, 일반적 조합]. Spring Boot를 쓸 이유(기존 코드·보안 모듈 필요)가 생기면 이전 비용이 크지 않다: 도메인 로직은 `shared`에 있고 서버는 얇다.

### 5.2 API 설계 초안 (`/v1`, JSON, 로그인 없음)

비회원이므로 **캐퍼빌리티 토큰**(알고 있으면 권한이 있는 무작위 토큰)을 쓴다. 토큰은 `Authorization: Bearer`로만 보내고 URL·로그·OG에는 절대 넣지 않는다.

| 메서드 경로 | 설명 | 인증 |
|---|---|---|
| `POST /v1/anon` | 익명 사용자 발급 → `{anonUserId, deviceToken}` (첫 방 작업 때 자동) | 없음 |
| `POST /v1/rooms` | 방 생성: `{mode, favorTarget?, meetingDate?, host:{nickname?, originCode?, hidden?}, expectedCount?}` → `{roomId, hostToken, participantId, participantToken, expiresAt}` | deviceToken(선택) |
| `GET /v1/rooms/{roomId}` | 방 상태: 참여자 목록(숨긴 출발역은 `null`+`hidden:true`), 모드, 만료, 데이터 버전. 토큰 없이 조회 가능 | 없음 |
| `POST /v1/rooms/{roomId}/participants` | 참여: `{nickname?, originCode, hidden?}` → `{participantId, participantToken}` (최대 4명, 잠긴 방은 거부) | deviceToken(선택) |
| `PUT /v1/rooms/{roomId}/participants/{pid}` | **자기** 출발역·별칭·숨김 수정 | participantToken |
| `DELETE /v1/rooms/{roomId}/participants/{pid}` | 자기 항목 삭제(또는 방장이 강퇴) | participantToken 또는 hostToken |
| `PATCH /v1/rooms/{roomId}` | 모드 변경, 잠금, 약속일 | hostToken |
| `DELETE /v1/rooms/{roomId}` | 방 삭제 | hostToken |
| `GET /v1/rooms/{roomId}/result?mode=&favor=` | 서버 계산 결과(숨긴 방 필수). 요청자에게는 본인 출발역·경로만 상세, 타인의 숨긴 출발역은 제외 | 선택(participantToken이면 본인 상세) |
| `POST /v1/recommend` | 무상태 계산: `{origins:[code], mode, favorIndex?}` → 순위. 저장 없음 | 없음 |
| `POST /v1/rooms/{roomId}/outcome` | "실제로 만났나" 응답 `{outcome: top1\|top3\|other\|none, stationCode?}` | participantToken |
| `GET /v1/manifest`, `GET /v1/data/{version}/{file}` | 데이터 매니페스트와 불변 산출물(클라이언트 캐시용, `Cache-Control: immutable`) | 없음 |
| `POST /v1/auth/link` (후속) | 로그인 후 익명 사용자를 계정에 연결(5.5) | deviceToken + OAuth id token |

공통: 요청 크기 제한, IP·기기 단위 속도 제한(인스턴스 메모리 토큰 버킷 + 방 생성 일일 상한), 오류는 `{code, message}`, 모든 변경 요청에 멱등성 키 선택. 짧은 링크는 **방 ID가 곧 짧은 링크**다(8장).

### 5.3 호스팅·DB 후보 비교 (확인일 2026-11-12)

환율 가정 1 USD ≈ 1,400원, 목표 월 1만 원 ≈ 7달러.

**서버 컴퓨트 후보**

| 후보 | 무료/저가 한도 | 장점 | 단점 | 출처 |
|---|---|---|---|---|
| **Cloud Run** (권고) | 월 180,000 vCPU-초, 360,000 GiB-초, 요청 200만 건 무료(us-central1 기준 표기, 결제 계정 단위) [확인]. 최소 인스턴스 유휴 단가 vCPU-초·GiB-초당 $0.0000025(Tier 1 열) [확인]. 서울(asia-northeast3) 리전 제공 [확인] | 0원 가능, scale-to-zero, **GitHub OIDC(WIF)** [확인], Secret Manager 연동 | JVM 콜드스타트, 결제 수단 등록 필요·하드 지출 상한 없음(예산 알림·max-instances로 제한) [추정] | https://cloud.google.com/run/pricing |
| Fly.io | shared-cpu-1x 256MB 월 $2.19, 512MB $3.69, 1GB $6.70(상시 가동 가정) [확인] | 상시 가동이라 콜드스타트 없음, 월 약 5천 원 | 무료 구간 없음, 배포 키는 장기 토큰 방식으로 보임 [추정, OIDC 미확인] | https://fly.io/docs/about/pricing/ |
| Railway | 무료 플랜에 월 $1 크레딧 [확인] | 간편 | 크레딧이 작아 JVM 상시 가동은 부족 [추정], 유료 요금 미확인 | https://docs.railway.com/reference/pricing/plans |
| Render 무료 | 15분 무트래픽 시 스핀다운, 월 750시간, 무료 Postgres는 30일 후 만료 [확인] | 간편 | 스핀다운 지연, DB 만료 | https://render.com/docs/free |
| Oracle Always Free | AMD 마이크로 VM 2대, Ampere A1 월 1,500 OCPU-시간·9,000 GB-시간 [확인] | 상시 가동 VM 무료 | 가입·회수 정책 변수, 운영 부담(OS·보안 업데이트) [추정] | https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm |
| Cloudflare Workers + D1 | Workers 일 10만 요청·호출당 CPU 10ms, D1 일 500만 행 읽기·10만 행 쓰기·5GB [확인] | 0원, 콜드스타트 없음 | **JVM(Ktor) 실행 불가**. 서버를 TS로 써야 해 KMP 서버 공유를 잃음(Kotlin/JS를 Workers에 올리는 방법은 [미확인]) | https://developers.cloudflare.com/workers/platform/pricing/ , https://developers.cloudflare.com/d1/platform/pricing/ |

**DB 후보**

| 후보 | 무료 한도 | 비고 | 출처 |
|---|---|---|---|
| **Neon Free** (권고) | 프로젝트 100개, 프로젝트당 100 CU-시간/월, 1GB 저장 [확인]. 5분 무활동이면 scale-to-zero(무료 플랜 고정), 재개는 수백 ms [확인]. 리전은 서울이 없고 싱가포르·시드니가 가장 가까움 [확인: https://neon.com/docs/introduction/regions] | Cloud Run(서울)→Neon(싱가포르) 질의당 수십 ms 추가 [추정]. 방 API는 질의 1~3회라 허용 | https://neon.com/pricing |
| Supabase Free | DB 500MB, 활성 프로젝트 2개, **1주일 무활동 시 일시정지** [확인] | 일시정지는 방 서비스에 부적합 | https://supabase.com/pricing |
| Firestore | 무료 할당량 존재(수치 미추출) [미확인] | 같은 GCP, TTL 정책 가능 [추정] | https://cloud.google.com/firestore/pricing |
| 서버 내장 SQLite(상시 가동 VM) | 0원(Fly 볼륨 등 별도 비용 [미확인]) | 인스턴스가 하나여야 함, 백업 직접 | — |

**권고 조합**: Cloud Run(서울, min 0) + Neon Free. 총 0원 구간. **콜드스타트가 문제면** ① 기동 최적화(AppCDS, 기동 CPU 부스트 [추정, 기능 존재 여부 문서 확인 필요]), ② Fly.io 512MB 상시 가동(월 약 5천 원), ③ Cloud Run min-instance=1은 1 vCPU·0.5GiB 기준 유휴 단가만으로 월 약 9.7달러(0.0000025×(1+0.5)×2,592,000초) [확인된 단가로 계산, 서울 단가는 [미확인]]라 예산을 넘으므로 비권고. **S0 스파이크**에서 Ktor fat JAR의 Cloud Run(서울) 콜드스타트를 실측하고 3초 이내인지 본다 [추정 목표].

### 5.4 데이터 모델 (Postgres)

```
anon_users(
  id            text pk,         -- 'u_' + 128비트 무작위(base32)
  device_hash   bytea unique,    -- deviceToken의 SHA-256
  account_id    text null,       -- 후속: 로그인 연결
  created_at, last_seen_at
)
rooms(
  id            text pk,         -- 10자 Crockford base32 (≈50비트)
  host_hash     bytea,           -- hostToken의 SHA-256
  host_anon_id  text null -> anon_users,
  mode          text,            -- fair | fast | favor
  favor_pid     text null,
  data_version  text,            -- 생성 시점 manifest의 dataVersion
  meeting_date  date null,
  expected_count smallint null,  -- 도달하면 자동 잠금
  status        text,            -- open | locked
  outcome       text null, outcome_station text null,
  created_at, last_activity_at, expires_at
)
participants(
  room_id       text -> rooms on delete cascade,
  pid           text,            -- 6자 base32
  anon_id       text null -> anon_users,
  token_hash    bytea,           -- participantToken의 SHA-256
  nickname      text null,       -- 최대 16자
  origin_code   text,            -- 3자 역 코드
  hidden        boolean,
  joined_at, updated_at,
  primary key (room_id, pid)
)
```

- 토큰은 256비트 무작위, 서버에는 SHA-256 해시만 저장한다(엔트로피가 높아 느린 해시 불필요 [추정]). 비교는 상수 시간으로 한다.
- 최대 참여자 4명은 애플리케이션과 CHECK 트리거로 강제한다. IP·User-Agent는 저장하지 않는다.
- 데이터 버전 고정: 방은 생성 시점 `data_version`을 기억한다. 서버는 현재·직전 버전을 메모리에 두고, 요청 버전이 없으면 최신으로 계산하며 응답에 `dataVersionChanged:true`를 표시한다.

### 5.5 비회원 신원: 토큰, 저장 위치, 유출 위험, 계정 연결

**토큰 종류**

| 토큰 | 발급 | 권한 | 저장 위치 | 유출되면 |
|---|---|---|---|---|
| `roomId` (링크 자체) | 방 생성 | 방 **조회**, 새 참여자로 **참여** | URL | 낯선 사람이 방을 보고 참여할 수 있음. 자동 잠금·강퇴·인원 상한으로 완화 |
| `hostToken` | 방 생성자에게 1회 | 방 설정·잠금·삭제·강퇴 | 웹: localStorage(방별 키), iOS: Keychain, Android: Keystore 기반 암호화 저장소 | 방 삭제·변경 가능. 재발급 불가(방 삭제 후 재생성) |
| `participantToken` | 참여 응답에 1회 | **본인** 출발역·별칭 수정·삭제 | 위와 동일 | 해당 한 사람의 항목만 변경 가능 |
| `deviceToken` | 첫 방 작업 때 `POST /v1/anon` | 익명 사용자 식별(내 방 목록, 계정 연결) | 웹: 같은 출처 `httpOnly; Secure; SameSite=Lax` 쿠키(API를 Next.js 같은 출처로 노출하는 경우, 6.4), iOS Keychain, Android Keystore | 해당 익명 사용자의 방 목록 열람 정도. 편집 권한은 방별 토큰이 따로 필요 |

- **방 링크만으로 남의 출발역을 고칠 수 없다**: 수정 API는 항상 `participantToken`(그 참여자) 또는 `hostToken`(강퇴·삭제만)을 요구하고, 조회 응답에 토큰을 절대 싣지 않는다. 토큰은 링크·OG·로그에 넣지 않는다(`Authorization` 헤더만, 서버 로그 필터링).
- **기기를 바꾸거나 토큰을 잃으면** 본인 항목을 수정할 수 없다. MVP에서는 방장이 강퇴하고 다시 참여시키는 우회로를 둔다. 로그인 연결 후 같은 계정이면 복원(후속).
- **웹 저장소 위험**: localStorage는 XSS에 취약하다. CSP·`Trusted Types`로 완화하고, 토큰의 가치(방 하나의 한 사람 수정 권한)가 낮다는 점에서 허용한다. `deviceToken`은 쿠키로 둔다 [추정, 판단].
- **익명 사용자 ID를 서버에 두는 이유**: 후속 소셜 로그인 때 `accounts` 테이블을 추가하고 `anon_users.account_id`만 채우면, 웹·iOS·Android에서 각각 만든 익명 사용자들을 한 계정으로 **데이터 이전 없이** 연결할 수 있다(방은 `anon_id`로 참조). `POST /v1/auth/link`가 deviceToken과 OAuth id 토큰을 받아 연결한다. 한 `anon_user`는 최대 한 계정에 속한다.
- **Apple 가이드라인(후속 로그인 때) [확인: https://developer.apple.com/app-store/review/guidelines/]**: ① 4.8 — 소셜 로그인(카카오·구글 등)으로 계정을 만들거나 인증하는 앱은, 이름·이메일만 수집하고 이메일 비공개를 허용하며 광고용 상호작용 수집을 하지 않는 **동등한 로그인 옵션**(사실상 Apple로 로그인)을 함께 제공해야 한다(자체 계정만 쓰는 앱 등은 예외). ② 5.1.1(v) — 앱이 큰 계정 기반 기능이 없으면 로그인 없이 쓰게 하고, 계정 생성을 지원하면 **앱 안에서 계정 삭제**를 제공해야 한다. 이는 로그인을 필수로 만들지 않는 현재 설계와 부합한다.
- **iOS 앱 지금(로그인 없이)도 필요한 것 [확인: 같은 문서 5.1.1(i)(ii)]**: 앱 안과 App Store Connect에 **개인정보처리방침 링크**, 데이터 보존·삭제 정책, 삭제 요청 방법, 그리고 분석 수집에 대한 **동의 취득**(익명이어도). → 앱의 PostHog는 동의 전 `optOut` 상태로 시작한다(7.4).

### 5.6 방 만료와 개인정보

| 항목 | 권고 | 이유 |
|---|---|---|
| 기본 만료 | 마지막 활동 후 7일(슬라이딩), 생성 후 최대 30일 | 약속 잡는 기간이 짧다 [추정] |
| 약속일 입력 시 | 약속일 +1일에 만료(최대 30일) | 약속 후 데이터 보존 불필요 |
| 삭제 방식 | 만료 행 물리 삭제. 별도 스케줄러 없이 **방 생성·참여 요청 때 `DELETE ... WHERE expires_at < now()`를 기회적으로 실행** + 주 1회 GitHub Actions가 IAM 인증된 내부 엔드포인트 호출 | 인스턴스가 scale-to-zero라 백그라운드 스레드를 믿을 수 없음 [추정]. 관리자 서버를 만들지 않는다 |
| 즉시 삭제 | 참여자: 자기 항목 삭제. 방장: 방 삭제 | 개인정보 삭제 요청 대응 |
| 익명 사용자 | 90일 무활동·참조 없음이면 삭제 | 최소 보존 |
| 숨기기 | `hidden`이면 API가 타인에게 출발역 이름을 주지 않는다. **시간은 보인다**(출발 지역을 대략 유추할 수 있음을 UI에 고지: "역 이름만 가려요") | 시간까지 숨기면 결과 카드의 핵심 가치(사람별 시간)가 사라짐. 수준 선택은 결정 필요 |
| 로그 | 요청 로그에 출발역·토큰 미기록 | 퍼블릭 레포 + 최소 수집 |
| PostHog | 출발역을 이벤트 속성에 넣지 않음(7.3) | 요청 사항 |
| 개인정보처리방침 | 필수: 수집 항목(출발역, 별칭, 익명 ID, 기기 토큰, 통계), 목적, 보존기간, 국외 처리(Vercel·Neon 싱가포르·PostHog 리전 등), 삭제 방법, 문의처 | Apple 요구 [확인] + 국내법상 요건은 법률 확인 필요 [추정] |

출발역+별칭이 개인정보에 해당하는지는 결합 가능성에 달려 있어 단정하지 않는다 [추정]. 안전하게 방침을 쓰고 최소 수집을 지키는 쪽을 권고한다.

---

## 6. D. 웹

### 6.1 Next.js(App Router) 권고와 Astro 판단

필요한 것: ① SEO용 정적 페이지 수백 개, ② 방/공유 링크별 `generateMetadata` OG, ③ 앱처럼 동작하는 입력·결과 화면. Next.js의 App Router는 메타데이터와 `ImageResponse`(JSX로 OG 이미지 생성)를 제공한다 [확인: https://nextjs.org/docs/app/api-reference/functions/image-response]. Astro는 콘텐츠 중심 정적 사이트에 가볍고 우수하지만, 이 서비스는 상호작용 화면 비중이 커서 React 섬을 많이 얹게 되고 동적 OG를 위해 SSR 어댑터가 필요하다. **판단 [추정]: Next.js가 더 단순**하다. 정적 SEO 영역만 분리하려는 경우에 Astro가 유리하지만 두 스택을 유지하는 비용이 크다.

### 6.2 호스팅 비교

| 후보 | 한도·조건 | 판단 |
|---|---|---|
| **Vercel Hobby** (권고, 조건부) | Fast Data Transfer 100GB, 함수 호출 월 100만, **개인·비상업 용도 한정**, 한도 초과 시 30일 대기 [확인: 검색 요약, https://vercel.com/docs/plans/hobby 직접 열람은 못함] | Next.js 마찰 최소. 광고·수익화를 하면 Pro로 올려야 함 |
| Cloudflare Workers + OpenNext 어댑터 | Cloudflare 문서에 Next.js(OpenNext) 가이드 존재 [확인: https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/]. 무료 Workers는 호출당 CPU 10ms·일 10만 요청, 정적 자산은 무제한 [확인]. 대기 시간은 CPU에 안 잡힘 [확인] | SSG는 정적이라 무료. 동적 OG(satori) CPU가 10ms를 넘을 위험 [추정], 동적 SSR 호환성은 [미확인]. 비상업 제한 없음 → **수익화 시 이전 경로** |
| Cloud Run(Node 컨테이너) | 서버와 같은 무료 구간 공유 | 콜드스타트가 SEO 페이지에도 영향. 비권고 [추정] |

이전 가능성을 위해 Vercel 전용 API(@vercel/kv, Edge Config 등)를 쓰지 않는다.

### 6.3 SSG로 만들 SEO 페이지 범위

- **1단계(약 50개)**: 허브 역 페이지 "○○역에서 만나면 각 역에서 몇 분?" — 후보역 50~100개 중 상위. 표(출발역별 소요시간·환승)를 포함한다.
- **2단계(최대 약 300개)**: 인기 조합 페이지 "강남–홍대 중간 어디?" — 호선이 다른 대표 조합. 페이지마다 공평/빨리 만나기 결과 3위와 이유 문장.
- **3단계(조합 전체)**: 하지 않는다. 650역 조합(수십만 개)은 얇은 콘텐츠 위험 [추정]. Search Console 데이터로 조합을 늘린다. 검색량은 미확인이다.
- 데이터는 파이프라인이 만든 `seo-pages.json`(Kotlin 코어로 계산)을 매니페스트로 받아 `generateStaticParams`로 빌드. 새 데이터 버전이 발행되면 파이프라인 마지막 단계가 Vercel Deploy Hook을 호출해 재빌드한다(후크 URL은 빌드 트리거 권한만 가진 비밀값 [추정]).
- 필수: 사이트맵, canonical, 푸터에 **공공데이터 출처 표시**(공공누리 1유형은 출처표시 조건 [확인: data-sources.md]), 개인정보처리방침 링크.

### 6.4 공유 링크별 동적 OG 이미지

- `/s?...`(혼자 입력, URL 상태)와 `/r/{roomId}`(방)의 `generateMetadata`가 서버에서 결과를 계산해 제목("신촌에서 볼까?")과 설명("나 34분 · 지훈 38분")을 만든다. 숨긴 방은 출발역을 쓰지 않는다. 카카오 스크랩은 서버가 내려준 HTML의 OG 태그를 읽는다(JS 실행 여부는 [추정] — 카카오 디버거로 실측). 캐시 키는 URL이므로 재스크랩은 카카오 개발자 도구의 캐시 초기화를 쓴다 [확인: 1판 출처].
- 이미지는 Next `opengraph-image`(ImageResponse)로 생성하고, 한글 폰트 파일은 번들에 포함한다 [추정]. 방 결과가 바뀌면 URL은 같고 이미지는 달라지므로 `?v=<hash>`를 붙인다.
- 같은 출처 API: `web/next.config`의 rewrites로 `/api/v1/*`를 Cloud Run으로 프록시하면 쿠키가 first-party가 되고 CORS가 필요 없다. Cloud Run 커스텀 도메인 매핑이 서울 리전에서 되는지는 [미확인]이라 이 방식을 기본으로 둔다(앱도 같은 기본 URL 사용 가능, 대역폭은 Vercel 한도에 포함 [추정]).

---

## 7. E. 사용 통계: PostHog (확정)

### 7.1 요약

대안 비교는 생략한다(Cloudflare Web Analytics는 페이지뷰 위주, 자체 이벤트 수집은 구현 비용). PostHog Cloud 무료 플랜은 매월 이벤트 100만 건, 세션 리플레이 5,000건, 기능 플래그 요청 100만 건, 오류 추적 10만 건을 제공하고 카드 없이 쓸 수 있다 [확인: https://posthog.com/pricing]. 이 규모면 1만 이벤트/일 정도까지 무료다 [추정 산술].

### 7.2 SDK

| 플랫폼 | SDK | 상태 | 출처 |
|---|---|---|---|
| 웹 | `posthog-js` | 안정 | https://posthog.com/docs/libraries |
| Android | `com.posthog:posthog-android:3.+` (Gradle) | 안정 | https://posthog.com/docs/libraries/android |
| iOS | PostHog iOS SDK, **SwiftPM**(CocoaPods는 2026-12-02부터 신규 버전 배포 불가) | 안정 | https://posthog.com/docs/libraries/ios |
| 서버(JVM) | PostHog **Java SDK(Beta)** 또는 HTTP 캡처 API | Beta | https://posthog.com/docs/libraries/java |
| KMP | PostHog Kotlin Multiplatform SDK | **Beta** | 같은 목록 |

공통 이벤트 정의는 `contracts/events.json` 한 곳에 두고 Kotlin 상수와 TS 타입을 생성한다. `shared:analytics`의 `AnalyticsPort` 인터페이스를 각 플랫폼 SDK로 구현한다(KMP SDK가 Beta라 의존하지 않음).

### 7.3 이벤트 설계 초안

모든 이벤트에 공통 속성: `platform`(web/ios/android/server), `app_version`, `data_version`, `anon_user_id`. **출발역·별칭·방 ID 원문은 넣지 않는다**(방 ID는 해시 `room_hash`).

| 이벤트 | 발생 위치 | 속성 | 목적 |
|---|---|---|---|
| `input_completed` | 클라이언트 | `participant_count`, `has_nickname`, `mode`, `input_ms`(첫 진입→완료) | 30초 목표 검증 |
| `result_viewed` | 클라이언트 | `participant_count`, `mode`, `max_minutes_bucket`(예: 30-45), `candidate_count`, `top1_station_code`(만날 역은 장소이므로 허용 [추정]) | 결과 품질·극단 상황 |
| `mode_switched` | 클라이언트 | `from_mode`, `to_mode`, `favor_used` | 배려 모드 사용 |
| `share_clicked` | 클라이언트 | `channel`(kakao/copy/system), `link_type`(url_state/room) | 공유율 |
| `link_opened` | 서버(`GET` 방/공유 링크) 또는 클라이언트 | `link_type`, `is_first_visit`, `referrer_kind` | 바이럴(열람/참가 인원) |
| `room_created` | 서버 | `participant_count_expected`, `hidden_used` | 방 사용률 |
| `participant_joined` | 서버 | `hidden`, `seconds_since_room_created` | 친구 참여 전환 |
| `map_app_opened` | 클라이언트 | `app`(kakao/naver), `rank`(1/2/3) | 의사결정 신호 |
| `outcome_answered` | 클라이언트/서버 | `outcome`(top1/top3/other/none), `meeting_station_code`(허용 [추정]), `days_since_result` | **"실제로 만났나"** 핵심 지표 |
| `analytics_consent_changed` | 클라이언트 | `granted` | 동의 기록 |

서버가 권위 있는 이벤트(`room_created`, `participant_joined`)는 서버에서만 보내 중복을 막는다.

### 7.4 "추천된 역에서 실제로 만났나" 지표

- 방(또는 URL 공유)에 **약속일**이 있으면 약속일 다음 날, 없으면 마지막 활동 3일 후 같은 링크를 다시 열 때 한 줄 질문을 띄운다: "어디서 만났어요? ① 1위 ② 2·3위 ③ 다른 곳 ④ 안 만났어요". 푸시 알림은 앱 단계에서 로컬 알림으로 보강한다.
- 지표: **채택률** = `outcome in (top1, top3)` / 응답, **1위 채택률**, **응답률**(응답/결과 확인 방). 응답 편향(만족한 사람이 더 답함)을 기록하고 UX 조사 6.2의 목표(상위 3곳 채택 70% 이상)와 비교한다.
- 보조 신호(응답 없이도 측정): `map_app_opened`(길찾기 열기) rank 분포, `share_clicked` 후 `link_opened`, 같은 방의 `participant_joined` 수.

### 7.5 개인정보 처리

- **이벤트 속성에 출발역을 넣지 않는다.** `max_minutes_bucket`, `participant_count`처럼 파생·집계 값만 보낸다.
- 익명으로 시작: `personProfiles`의 기본값이 `identified_only`라 `identify()`·`alias()`·`group()` 등을 부르기 전에는 익명 이벤트로 수집된다 [확인: https://posthog.com/docs/data/anonymous-vs-identified-events]. 자동 캡처(autocapture)와 세션 리플레이는 끈다(입력창 내용 수집 방지) [추정, 설정 존재 확인 필요].
- 프로젝트 토큰(`phc_`)은 공개해도 되고 개인 API 키(`phx_`)는 절대 공개하면 안 된다 [확인: https://posthog.com/docs/privacy]. 퍼블릭 레포에는 `phc_`만 둔다.
- **동의**: Apple은 익명이어도 사용·데이터 수집에 동의를 받도록 요구한다 [확인: 5.1.1(ii)]. 앱은 동의 전 `optOut`, 웹은 첫 방문 시 간단한 고지·거부 선택을 둔다 [추정]. 국내법 요건과 PostHog 리전(US/EU) 선택에 따른 국외 이전 고지는 법률 확인이 필요하다 [미확인].
- **익명 → 계정 연결 흐름**: ① 익명: SDK가 만든 anonymous distinct_id로 익명 이벤트. ② 방 작업 시 서버가 `anon_user_id`를 발급하면 모든 이벤트에 속성으로 등록(PostHog의 distinct_id는 그대로). ③ 후속 로그인 때 클라이언트가 `identify(accountId)`를 호출하고 서버 이벤트도 그 ID를 사용. PostHog는 "가능하면 빨리 identify하라"를 권고한다 [확인: 같은 문서 목차·모범 사례]. 이전 익명 이벤트와의 병합 세부 동작은 구현 시 문서로 재확인한다. 과거 이벤트는 `anon_user_id` 속성으로 조인한다.

---

## 8. F. 공유 URL과 역 코드

### 8.1 두 방식을 함께 쓴다

| | 혼자 입력 → **URL 상태** | 각자 입력 → **방 ID** |
|---|---|---|
| 형태 | `/s?v=1&o=ab3.k9x&m=f` | `/r/7QK2M9X4TP` |
| 서버 저장 | 없음 | 있음(Postgres) |
| 용도 | UX 조사 B의 30초 흐름(한 사람이 전부 입력) | 친구가 각자 출발역 입력, 숨기기 |
| 변경 가능성 | 불변(링크=상태) | 참여·수정 가능 |
| 전환 | "친구가 직접 입력하게 하기" 버튼으로 URL 상태를 방으로 승격(입력된 역을 방장 항목으로 시드) | — |
| OG | `generateMetadata`가 쿼리에서 계산 | `generateMetadata`가 서버에서 조회·계산 |

두 링크 모두 동일한 결과 컴포넌트가 렌더링한다. 유니버설/앱 링크는 경로 접두어(`/s`, `/r/*`)로 건다. 카톡 인앱 브라우저는 유니버설 링크로 앱을 못 여는 사례가 보고되므로 웹 폴백을 항상 유지한다 [확인: 커뮤니티 사례 https://devtalk.kakao.com/t/ios-android/134879, 공식 정책은 [미확인]].

### 8.2 URL 파라미터

- `v`: URL 스키마 버전(데이터 버전 아님). `o`: 출발역 코드를 점(.)으로 연결(입력 순서 = A, B, C, D). `m`: `f`(공평)·`q`(빨리)·`p<index>`(배려, 대상 번호). `n`(선택): 별칭 목록. **별칭은 UTF-8을 base64url로 인코딩해 `|`로 이은 값** — 한국어 퍼센트 인코딩을 피하고, 기본은 별칭 없이 "나/친구1/친구2" 표시. 별칭이 없는 링크가 기본이라 방 ID 링크에는 별칭을 넣지 않는다.
- 토큰·개인 식별자는 URL에 넣지 않는다.

### 8.3 역 코드 체계

- **자체 발급 불투명 코드**: 소문자·숫자 base32(혼동 문자 제외) **3자**. 32³ = 32,768개로 650역(1,100개 노선별 레코드 이상 가능)에 충분하고 폐역·신설 여유가 크다.
- 단위는 **환승역을 묶은 물리 역**(`algorithm.md`의 공통 역 ID). 기관별 코드는 기관마다 달라 결합 불가라고 `data-sources.md`가 지적하므로, 레지스트리가 `{code, name, lines[], lat, lng, sources{kric, seoul, tago, ...}}`를 소유한다.
- `data/registry/stations.json`은 **append-only**: 코드는 재사용하지 않고, 폐역·개명은 `deprecated`/`aliases`로 처리. 파이프라인과 CI가 "이전 main에 있던 코드가 사라졌는지" 검사해 막는다(옛 링크 보존).
- 이름 대신 코드를 쓰는 이유: 한국어 퍼센트 인코딩 회피, URL 길이(4명 ≈ 20자), 개명에 영향 받지 않음. 단점은 사람이 읽을 수 없다는 것이라 화면·OG에서 항상 이름을 보여준다.
- 3자 코드는 `ascii`이므로 3.3의 정렬 주의가 사라진다.

### 8.4 방 ID

- 10자 Crockford base32(약 50비트): 추측으로 방을 찾기 어렵다. 링크를 아는 사람은 조회·참여할 수 있으므로 자동 잠금과 강퇴를 제공한다(5.5). 방 ID에서 시간 정보가 새지 않도록 무작위로 만든다.

---

## 9. G. 파이프라인 언어: Kotlin(JVM) 권고

| | **Kotlin(JVM)** | TypeScript |
|---|---|---|
| `schema` 코덱 | 파이프라인(쓰기)·서버·웹(Kotlin/JS)·앱(읽기)이 **같은 코드** | 별도 구현 필요 → 형식 불일치 위험 |
| 알고리즘 코어 재사용 | 직접 import | 불가(또는 TS 포팅) |
| 입력 파싱 | XLSX/CSV/JSON/XML 라이브러리 풍부(JVM) [추정] | 가능 |
| 시간 확장 그래프(막차, 2차) | 같은 JVM 코드베이스에 자연스러움 | 가능 |
| 실행 | `./gradlew :pipeline:run`, GitHub Actions 예약 | `pnpm` 스크립트 |
| 단점 | Gradle 기동이 느림 | Kotlin과 이중 언어 |

권고: 파이프라인과 서버는 같은 언어(Kotlin)로 맞춘다. 이유는 코어·형식·타입의 단일화이고, 1인 유지보수에서 가장 중요한 "형식 불일치" 위험을 구조적으로 없앤다. Python 프로토타입은 **참조 오라클**로 남긴다. TypeScript는 `web/`과 계약 코드 생성 스크립트에만 쓴다.

---

## 10. H. control plane / data plane (새 구조)

기준 글: 달레의 코딩 블로그 "컨트롤 플레인과 데이터 플레인" [확인: https://daleseo.com/control-plane-data-plane/, 2026-10-22 게시]. 요지: 데이터 플레인은 요청을 처리하는 경로, 컨트롤 플레인은 처리 방식을 정해 내려보내는 쪽이고, 요청이 컨트롤 플레인을 지나지 않아야 컨트롤 플레인이 멈춰도 마지막 설정으로 서비스가 돈다(정적 안정성). 흔한 실수: 요청마다 컨트롤 플레인에 묻기, 관리 API를 사용자 문으로 열기, 설정을 검증 없이 내려보내기.

### 10.1 코디네이터 권고 방향: 타당하다 (한 가지 조정)

권고된 방향(컨트롤 = 파이프라인 + 검증 게이트 + 버전된 산출물과 manifest 포인터, 데이터 = 추천/방 API 서버 + 웹, 서버는 시작 시 manifest의 산출물을 메모리에 올리고 새 버전 검증 실패 시 마지막 정상 버전 유지, 관리자 서버 없음)을 그대로 채택한다. **조정 2가지**:

1. **객체 저장소는 R2 대신 GCS(비공개) 권고.** Cloudflare 문서의 CI 인증은 API 토큰 방식이고 OIDC는 확인하지 못했다 [확인: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/]. 반면 GitHub Actions→Google Cloud는 Workload Identity Federation으로 **저장된 장기 키 없이** 인증할 수 있다 [확인: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-google-cloud-platform]. 산출물은 MB 단위라 저장 비용은 사실상 0이다 [추정]. R2는 무료 10GB·Class A 100만/B 1,000만·송신 무료라 [확인: https://developers.cloudflare.com/r2/pricing/] 클라이언트 직배포 CDN이 필요해지면 그때 복제 대상으로 고려한다(그때는 쓰기 토큰이 생기는 예외를 인정해야 한다).
2. **서버에 마지막 정상 산출물을 컨테이너 이미지에 굽는다.** 서버가 콜드스타트 때 저장소 장애로 산출물을 못 받으면 시작 자체가 실패한다. 배포 시점의 정상 산출물을 이미지에 포함해 두고 시작 후 manifest 확인으로 갱신하면 저장소가 죽어도 마지막 정상 버전으로 시작한다(정적 안정성).

### 10.2 매핑

| 구성요소 | 플레인 | 배포 단위/위치 | 멈추면 |
|---|---|---|---|
| 원본 수집·정규화·그래프·다익스트라·검증 | 컨트롤 | GitHub Actions 예약/수동 잡(`pipeline/`) | 새 데이터 미반영 |
| 역 레지스트리·후보 목록·별칭(원하는 상태) | 컨트롤 | git(`data/`) | 위와 같음 |
| 검증 게이트(불변식, 크기 예산, 직전 버전 대비 변화, 골든 테스트) | 컨트롤 | 파이프라인 안 | 발행 중단(기존 유지) |
| 불변 산출물 + manifest 포인터 | 컨트롤이 쓰고 데이터가 읽음 | GCS | 서버·클라이언트가 현재 버전 유지 |
| 추천/방 API 서버 | **데이터** | Cloud Run | 사용자 즉시 영향 |
| 웹(SSG/SSR) | **데이터** | Vercel | 사용자 즉시 영향 |
| 앱 | **데이터** | 스토어 | 번들 시드로 동작 |
| 방 DB | 데이터 | Neon | 방 기능 실패(혼자 입력은 계속 동작해야 함) |
| 서버 재배포(WIF) | 컨트롤 | GitHub Actions | 새 서버 코드 미반영 |

### 10.3 데이터 배포 흐름(발행)

1. 파이프라인이 임시 디렉토리에서 산출물을 만들고 검증 게이트를 통과해야 한다(실패 시 아무것도 쓰지 않음).
2. 불변 객체를 `gs://…/versions/<dataVersion>/` 아래에 먼저 올린다(`stations.<hash>.json`, `od.<hash>.bin`, `seo-pages.<hash>.json`, 레지스트리 사본).
3. 마지막에 `manifest.json`(현재 유효 버전 포인터, `schemaVersion`, `minClientSchema`, 해시들)을 한 번에 교체한다.
4. 롤백 = 이전 manifest로 되돌리는 수동 워크플로(`workflow_dispatch`). 이전 버전 객체는 최소 N개 보존한다.
5. 서버는 요청 처리 때 마지막 확인 후 5분이 지났으면 비동기로 manifest를 조건부 조회(ETag)해 새 버전을 받아 **검증(해시·스키마·차원·골든 샘플)** 한 뒤 교체하고, 실패하면 직전 정상 버전을 유지하며 경고를 남긴다. Cloud Run은 요청 외 CPU가 제한되므로 백그라운드 스레드 대신 요청 시 확인한다 [추정].
6. 웹/앱은 서버의 `GET /v1/manifest`·`/v1/data/*`(immutable 헤더)를 통해 같은 산출물을 받는다. SEO 재빌드는 Vercel Deploy Hook으로 트리거한다.

### 10.4 지켜야 할 규칙(글의 실수 3가지에 대응)

- 요청마다 컨트롤 플레인에 묻지 않는다: 서버는 메모리 데이터로 응답하고, manifest 확인은 요청 경로를 막지 않는다.
- 관리 API를 만들지 않는다: 관리자 서버·화면 없음. 컨트롤 접근은 git/GitHub Actions 권한과 GCP IAM이다. 주 1회 정리 호출처럼 꼭 필요한 내부 엔드포인트는 IAM 인증(Cloud Run 호출자 제한)으로 보호한다.
- 검증 없이 내려보내지 않는다: 위 게이트와 서버 측 재검증, 롤백 경로.
- 의존 방향: `pipeline` → `shared:schema`만. `server`/`web`/`apps` → `shared`. `server`가 `pipeline`을 import하지 않는다. 클라이언트·서버는 데이터의 **읽기 전용 소비자**다.

### 10.5 과한 것

별도 컨트롤 플레인 서비스·DB·관리자 화면, xDS식 실시간 설정 푸시, 비율 카나리(preview 배포와 롤백이면 충분), 플레인별 독립 스케일, 멀티 테넌트 논의, 피처 플래그 서비스(manifest의 `flags` 몇 개면 충분). 재검토 시점은 2판과 같다. 한 가지 위험은 **GitHub 예약 워크플로가 공개 레포에서 60일 활동이 없으면 비활성화될 수 있다**는 점이다 [추정, GitHub 동작 확인 필요]. 예약 실행은 보조이고 발행은 수동 디스패치를 기본으로 둔다.

---

## 11. 비밀값, CI, 퍼블릭 레포 운영

### 11.1 원칙

1. **클라이언트에는 진짜 비밀값이 없다.** 웹·Android·iOS 빌드에 들어가는 값은 공개돼도 되는 것만: PostHog 프로젝트 토큰 `phc_` [확인], API 기본 URL. 외부 경로 API 키(TMAP/ODsay/카카오 REST), 서울 열린데이터광장·TAGO 키, DB 비밀번호는 **서버·파이프라인만** 가진다. 카카오 JS 키 같은 도메인 제한형 키가 필요하면 도메인/번들 ID 제한을 건다.
2. **장기 배포 키 없음(OIDC)**: GitHub Actions→GCP는 WIF [확인]. `permissions: id-token: write`로 OIDC 토큰을 받아 서비스 계정을 가장하고, WIF 공급자의 조건에 `repository`(+브랜치/Environment)를 걸어 이 레포의 `main`/`production` Environment만 허용한다 [추정, 설정 세부는 GCP 문서 확인]. 웹은 Vercel Git 연동으로 CI에 토큰이 필요 없다 [추정]. Cloudflare를 배포에 쓰면 API 토큰이 필요하다(위 10.1).
3. **런타임 비밀값은 플랫폼 저장소**: Cloud Run은 Secret Manager 비밀을 환경 변수/볼륨으로 주입한다. Secret Manager는 활성 버전 6개와 접근 1만 건/월을 무료로 표기한다 [확인: https://cloud.google.com/secret-manager/pricing, 표기 해석은 재확인]. 서버 비밀: DB URL(Neon 비밀번호), 토큰 해시용 페퍼(pepper), 내부 엔드포인트용 값.
4. **원본은 개인 1Password vault, 로컬은 `.env.tpl`(참조만 커밋)+`op run`**(11.2). 로컬 DB는 Docker/Testcontainers로 띄워 **DB 비밀번호가 필요 없게** 하고, 로컬 비밀값은 사실상 데이터 API 키 2~3개뿐이다.

### 11.2 비밀값 원본: 개인 1Password vault (확정)

**진짜 값의 원본은 사용자 개인 1Password 계정의 전용 vault** 하나다. 다른 곳(Actions secrets, Secret Manager, 로컬 파일)에 있는 값은 모두 여기서 파생된 사본이며, 교체는 항상 1Password에서 시작한다.

**vault 분리 (권고)**

| vault | 내용 | 접근 |
|---|---|---|
| `banbanyeok` | 로컬 개발용 값: 서울 열린데이터광장 키, TAGO 키, (개발용) 외부 API 키 | 사용자 본인(데스크톱 앱 연동) |
| `banbanyeok-ci` | CI가 쓰는 값만: 파이프라인 키, Vercel Deploy Hook | 서비스 계정(읽기 전용) — 아래 CI 절 |
| `banbanyeok-release` | 업로드 키 keystore 백업, App Store Connect API 키 등 **서명·제출 자료** | 사용자 본인만. 서비스 계정에 절대 부여 안 함 |

서비스 계정은 기본 제공 Personal/Private vault나 기본 Shared vault에 접근 권한을 줄 수 없으므로 전용 vault가 필요하다 [확인: https://developer.1password.com/docs/service-accounts/get-started/]. 위 분리는 그 제약과도 맞는다.

**회사 계정과 섞이지 않게 개인 계정 고정하기**

- 1Password 데스크톱 앱 연동으로 CLI에 로그인하면 앱에 추가한 모든 계정에 접근할 수 있고, `--account`를 주지 않으면 **가장 최근에 로그인한 계정**으로 명령이 실행된다 [확인: https://developer.1password.com/docs/cli/use-multiple-accounts/]. 회사 계정과 섞일 위험이 바로 여기에 있다.
- 계정 지정 방법은 둘: 명령마다 `--account <로그인 주소 또는 ID>` 플래그, 또는 환경 변수 **`OP_ACCOUNT`** [확인: 같은 문서의 항목 제목 "Set an account with the OP_ACCOUNT environment variable"]. 주소·ID는 `op account list`로 확인한다(문서 항목 "Find an account sign-in address or ID" [확인]).
- 권고: 프로젝트 루트의 **gitignore된 `mise.local.toml`** 에 `OP_ACCOUNT`를 고정한다(개인 계정 주소는 퍼블릭 레포에 올리지 않는다 [추정, mise의 local 설정 파일 지원은 문서로 재확인]).
  ```toml
  # mise.local.toml  (gitignore)
  [env]
  OP_ACCOUNT = "<개인 계정 로그인 주소 또는 ID>"
  # 회사용 서비스 계정 토큰이 셸에 올라와 있어도 이 프로젝트에서는 쓰지 않도록 해제
  OP_SERVICE_ACCOUNT_TOKEN = false
  ```
  `OP_SERVICE_ACCOUNT_TOKEN`이 셸에 설정돼 있으면 CLI가 개인 로그인 대신 그 서비스 계정으로 동작할 수 있다 [추정, 환경 변수가 서비스 계정 인증용이라는 점은 문서 확인: 같은 문서군]. 이 값을 `false`로 해제하는 mise 문법과 효과는 [미확인] — 대안은 `direnv`의 `unset`이다. **첫 실행 때 `op whoami`로 개인 계정인지 확인**하는 체크를 `mise run doctor` 태스크로 둔다.
- 안전망: `.env.tpl`의 참조 vault 이름을 `banbanyeok`로 고정하면, 실수로 회사 계정이 활성이어도 해당 vault가 없어 `op run`이 실패한다(조용히 다른 값을 쓰지 않음) [추정].

**로컬: `.env.tpl`(참조만 커밋) + `op run`**

`.env.tpl`에는 값이 아니라 `op://<vault>/<item>/<field>` 참조만 담아 커밋한다 [확인: op run은 비밀 참조를 환경 변수로 해석해 앱에 전달: https://developer.1password.com/docs/cli/secrets-environment-variables/].

```
# .env.tpl  (커밋됨 — 값 없음)
SEOUL_OPENAPI_KEY=op://banbanyeok/seoul-openapi/credential
TAGO_SERVICE_KEY=op://banbanyeok/tago/credential
```

```sh
# 파이프라인 (Kotlin CLI)
op run --env-file=pipeline/.env.tpl -- ./gradlew :pipeline:run --args="build"

# 서버 (Ktor, 로컬 DB는 Docker라 비밀번호 불필요 -> 서버용 .env.tpl은 거의 비어 있음)
op run --env-file=server/.env.tpl -- ./gradlew :server:run

# 웹 (Next.js 개발 서버) — 서버 전용 값만 참조, NEXT_PUBLIC_*에는 비밀을 넣지 않는다
op run --env-file=web/.env.tpl -- pnpm --filter web dev
```

`OP_ACCOUNT`가 설정돼 있으면 `--account`는 생략한다. 위 명령은 `mise.toml`의 태스크(`mise run dev:pipeline`, `dev:server`, `dev:web`)로 감싸 한 번에 실행한다. Gradle 데몬에 환경 변수가 전달되는 방식은 [추정]이라, 값이 안 보이면 `--no-daemon`으로 확인한다. 로컬 비밀값이 서울·TAGO 키 2~3개뿐이어서 이 구조가 가장 단순하다.

**CI: 서비스 계정 + `load-secrets-action` — 개인 플랜에서 가능한가?**

- 1Password 문서의 서비스 계정 **요청 한도 표에 "1Password, 1Password Families"가 별도 행으로 있다**: 토큰당 시간당 읽기 1,000·쓰기 100, **계정 전체 하루 1,000건** [확인: https://developer.1password.com/docs/service-accounts/rate-limits/]. 개인/Families에서도 서비스 계정을 쓸 수 있다는 강한 간접 증거다. 다만 "생성 화면에서 만들 수 있는지"를 명시한 문장은 찾지 못했다 [미확인] → **S0에서 실제로 `banbanyeok-ci` 서비스 계정을 한 번 만들어 보는 것을 체크 항목**으로 둔다. 문서는 생성 요건을 "1Password 가입과 충분한 계정 권한"으로만 적는다 [확인: get-started].
- GitHub Actions 연동은 `1password/load-secrets-action`이 서비스 계정 또는 Connect 서버로 인증한다. 저장소(Environment) 비밀 `OP_SERVICE_ACCOUNT_TOKEN`에 토큰을 넣고 `configure` 단계로 지정한다 [확인: https://developer.1password.com/docs/ci-cd/github-actions/]. 비밀 참조는 1Password와 자동 동기화되고 로그에서 마스킹된다 [확인: 같은 문서].
- 제약: 하루 1,000건 한도를 넘지 않게 워크플로당 참조 수를 줄이고(`data-publish`만 사용), 서비스 계정은 `banbanyeok-ci`에 **읽기 전용**으로만 부여한다. 토큰 유출은 해당 vault 읽기 노출이므로 Environment(`production`, 필수 승인자)에 한정하고 액션은 SHA로 고정한다.
- 참고: 1Password 문서는 토큰 없이 CI의 OIDC 신원으로 접근을 검증하는 **Credential Broker(공개 미리보기)** 도 소개한다 [확인: https://developer.1password.com/docs/service-accounts/]. 설정을 "관리자"가 한다고 적혀 있어 개인 플랜 사용 가능 여부는 [미확인]이다. 쓸 수 있게 되면 토큰 보관 자체를 없앨 수 있으므로 관찰 항목으로 둔다.

**서비스 계정이 안 될 때의 폴백(수동 동기화)과 런타임**

| 대상 | 방식 |
|---|---|
| GCP 배포(Cloud Run) | **OIDC(WIF)** 로 키 없음. 1Password와 무관 |
| CI 잡이 쓰는 값(파이프라인 키, Deploy Hook) | 폴백: GitHub **Environment `production`** secrets. 동기화는 `scripts/sync-ci-secrets.sh`가 `op read ... | gh secret set --env production`을 실행(로컬에서만 실행, 1Password가 원본) |
| 런타임(Cloud Run) | **Secret Manager** 에 저장하고 서비스에 주입(11.1). 동기화는 `scripts/sync-runtime-secrets.sh`가 `op read ... | gcloud secrets versions add ...`를 실행(로컬에서만) |
| 웹(Vercel) | 서버 전용 환경 변수를 Vercel 프로젝트 설정에 수동 입력(값 목록은 `docs/runbooks/secrets-inventory.md`에 이름만 기록) |

원칙: 런타임·CI 저장소는 값의 사본일 뿐이므로 1Password 항목을 바꿨으면 동기화 스크립트를 한 번 실행한다. 어느 사본이 어느 버전인지 `secrets-inventory.md`(이름·위치·마지막 동기화 날짜, 값 없음)로 추적한다. **기본안**: 서비스 계정 생성이 확인되면 CI는 `load-secrets-action`, 아니면 위 폴백. 런타임은 어느 쪽이든 Secret Manager다(Cloud Run이 1Password 토큰을 따로 들고 있지 않게).

**다른 도구 (한 줄)**: SOPS+age는 암호문이 퍼블릭 레포에 영구히 남아 키 유출 시 과거 값이 모두 열리므로 비권고, Doppler·Infisical은 1Password가 이미 있어 서비스만 늘고 무료 한도는 [미확인], mise의 secrets 기능(SOPS·age·fnox)은 experimental 표기가 있어 채택하지 않는다 [확인: https://mise.jdx.dev/environments/secrets/]. mise는 도구 버전 고정과 `OP_ACCOUNT` 같은 비밀 아닌 환경 설정에만 쓴다.

### 11.3 앱 서명

- **Android**: Play App Signing을 쓰면 업로드 키로 서명해 올리고 Play가 최종 서명 키를 관리한다 [확인: https://developer.android.com/studio/publish/app-signing]. 로컬에는 **업로드 키 keystore만** 두고 1Password 같은 별도 저장소에 백업한다. 커밋 금지 패턴: `*.jks`, `*.keystore`, `keystore.properties`.
- **iOS**: 1인·로컬 릴리스는 **Xcode 자동 서명**으로 충분하다. CI 릴리스가 필요해지면 fastlane match를 쓴다. match는 인증서·프로비저닝 프로파일을 **별도 비공개 git 저장소 또는 Google Cloud/S3**에 암호화 저장한다 [확인: https://docs.fastlane.tools/actions/match/]. 퍼블릭 모노레포에는 절대 넣지 않으며, 이미 GCS를 쓰므로 match 저장소를 **GCS 버킷**으로 두면 별도 저장소가 필요 없다. 따라서 **저장소를 하나로 유지하는 방침의 예외는 필요 없다**(GCS를 쓰지 않을 경우에만 비공개 `certs` 저장소가 예외). 커밋 금지: `*.p12`, `*.p8`, `*.mobileprovision`, App Store Connect API 키.
- 스토어 제출 비밀(Play 서비스 계정, ASC API 키)은 CI에 두지 않고 **로컬 수동 릴리스**를 기본으로 둔다. CI 릴리스가 필요하면 Actions Environment(필수 승인자)에 한정한다.

### 11.4 유출 방지와 키 교체

- **gitleaks pre-commit**: `pre-commit` 또는 lefthook으로 gitleaks를 커밋 전에 실행 [확인: https://github.com/gitleaks/gitleaks]. CI에도 같은 검사를 넣는다.
- **GitHub 시크릿 스캐닝 + push protection**을 저장소 설정에서 켠다(퍼블릭 레포 기능, 설정 방법은 https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection 참고 [확인: 페이지 존재, 적용 조건 세부는 재확인]).
- **교체 절차(런북 `docs/runbooks/key-rotation.md`)**: ① 유출 의심 즉시 제공자 콘솔에서 **폐기(revoke)** → ② 새 키 발급 → ③ Secret Manager에 새 버전 추가·서비스 재배포(또는 Actions secret 교체) → ④ 제공자 감사 로그에서 오용 확인 → ⑤ 그다음에야 git 히스토리 정리(이미 퍼블릭이면 폐기가 우선이며 히스토리 삭제는 안전하지 않음) → ⑥ 원인 규칙을 gitleaks 설정에 추가.

모든 비밀의 **원본은 1Password**(`banbanyeok`/`banbanyeok-ci`/`banbanyeok-release`)다. 교체는 ① 제공자에서 폐기·재발급 → ② 1Password 항목 갱신 → ③ `scripts/sync-*.sh`로 아래 "위치"의 사본 갱신 → ④ 재배포 순서로 한다.

| 비밀 | 사본 위치 | 교체 주기/방법 |
|---|---|---|
| Neon DB 비밀번호 | Secret Manager | 유출 시 즉시, 정기 6개월 [추정] |
| 토큰 해시 페퍼 | Secret Manager | 교체 시 기존 토큰 무효 → 신중(이중 페퍼 단계 전환) |
| 서울 열린데이터광장·TAGO 키 | Actions Environment secret(파이프라인 실행 시) 또는 로컬 `op run` | 유출 시 재발급 |
| 외부 경로 API 키(TMAP/ODsay/카카오, 버스 확장 때) | Secret Manager(서버만) | 제공자 정책 |
| PostHog 개인 API 키 | 사용 안 함(필요 시 로컬만) | — |
| PostHog 프로젝트 토큰 `phc_` | 공개 가능 | — |
| Vercel Deploy Hook URL | Actions secret | 재생성 |
| Android 업로드 키 | 로컬 + 안전한 백업 | 분실 시 Play에 재설정 요청 |
| iOS 서명/ASC API 키 | 로컬 키체인 | Apple 포털에서 폐기 |

### 11.5 퍼블릭 레포 운영 규칙

- 워크플로 기본 `permissions: contents: read`, 필요한 잡만 `id-token: write`. 외부 PR에는 `pull_request`(비밀 미노출)만 쓰고 `pull_request_target`은 피한다. 처음 기여자의 워크플로는 승인 후 실행하도록 설정한다 [추정]. 서드파티 액션은 커밋 SHA로 고정한다.
- 배포 잡은 `production` Environment(필수 승인자)와 WIF 조건(레포·브랜치)으로 제한.
- 브랜치 보호, CODEOWNERS, `SECURITY.md`, 의존성 업데이트 봇(Gradle·pnpm).
- **커밋하면 안 되는 데이터**: KTDB 원본 GTFS, 외부 경로 API 응답(TMAP는 24시간 초과 저장 불가, ODsay·카카오는 저장에 사전 동의 필요 [확인: data-sources.md]), 서울 시간표 전체 덤프 등 대용량 원본, `data/raw/`, `data/cache/`, 사용자 데이터. `.gitignore`와 CI 검사(파일 크기·금지 경로)로 막는다. **외부 경로 API와의 대조 표본(spot check)에는 그쪽 결과값을 저장하지 않고** 우리 값과 통과 여부만 기록한다(퍼블릭 레포에 TMAP/ODsay 결과를 두면 약관 위반 소지 [추정]).
- **출처 표시가 필요한 공공데이터**: 공공누리 1유형(서울 열린데이터광장 일부, S3·S4·S5·S7)은 출처표시 조건으로 상업 이용·변경·저장이 가능하다 [확인: data-sources.md]. `data/ATTRIBUTION.md`에 출처·라이선스·확인일을, 웹 푸터·앱 정보 화면에 출처 표시를 둔다. 파생 산출물(행렬)은 R2/GCS에 배포하되 KTDB 가공물은 **상업 배포 허용 범위 확정 전 사용·배포 금지**(결정 필요). `data/samples/`의 샘플은 라이선스를 재확인해 유지한다.
- 코드 라이선스(MIT/Apache-2.0/AGPL 등)와 서비스 이름·로고 상표 정책을 정한다(결정 필요).

### 11.6 CI: 경로 필터와 잡 구성

단일 모노레포에서 바뀐 부분만 돌린다. 경로 필터는 의존 관계를 포함해야 한다(`shared/**`가 바뀌면 서버·앱·웹이 모두 영향).

| 워크플로 | 트리거 경로 | 잡 | 러너 |
|---|---|---|---|
| `ci-kotlin` | `shared/**`, `server/**`, `pipeline/**`, `android/**`, `gradle/**`, `*.kts`, `contracts/**` | `./gradlew check`(JVM·JS 테스트, 서버 테스트) | ubuntu |
| `ci-shared-ios` | `shared/**`, `ios/**` | `iosSimulatorArm64Test`, Xcode 빌드 | macOS (퍼블릭 레포 표준 러너 무료 [확인], macOS 표준 러너 포함 여부는 [미확인]) |
| `ci-web` | `web/**`, `pnpm-lock.yaml`, `contracts/**`, `shared/**`(JS 산출물 사용 시) | lint·타입·테스트·`next build` | ubuntu |
| `ci-contracts` | `contracts/**`, `prototype/**` | 골든 일치(Python 오라클 vs Kotlin) | ubuntu |
| `data-publish` | 수동/예약, `pipeline/**`, `data/**` | 파이프라인 실행→검증→GCS 발행→Deploy Hook | ubuntu(WIF) |
| `deploy-server` | `server/**`, `shared/**`, `gradle/**` (main) | 이미지 빌드(산출물 굽기)→Cloud Run 배포 | ubuntu(WIF) |
| `secrets-scan` | 전체 | gitleaks | ubuntu |

GitHub의 표준 러너는 퍼블릭 레포에서 무료다 [확인: https://docs.github.com/en/billing/concepts/product-billing/github-actions].

---

## 12. 저장소 구조 (모노레포 하나)

```
banbanyeok/
├─ settings.gradle.kts / build.gradle.kts / gradle/libs.versions.toml   # Kotlin 루트 (shared, server, pipeline, android)
├─ pnpm-workspace.yaml / package.json                                    # web + 계약 코드 생성 스크립트
├─ mise.toml                                                             # JDK / node 24 / pnpm / bun 버전 고정
├─ contracts/                       # 언어 중립 계약 (모든 구현이 공유)
│  ├─ golden/{scenarios.json, expected.ranking.json}
│  ├─ openapi.yaml                  # 서버 API
│  ├─ events.json                   # 분석 이벤트 정의 → Kotlin/TS 생성
│  ├─ data-format.md                # od.bin / manifest / registry 형식
│  └─ fixtures/                     # 작은 샘플 산출물
├─ shared/                          # KMP (jvm, android, ios*, js)
│  ├─ core/  schema/  links/  api-client/  app-logic/  analytics/
├─ server/                          # Ktor (JVM), Dockerfile, Flyway 마이그레이션
├─ pipeline/                        # Kotlin CLI: sources → graph → build → validate → publish
├─ android/                         # Compose 앱 (Gradle 루트의 :android:app)
├─ ios/                             # Xcode 프로젝트 (SwiftUI), shared를 direct integration으로 링크
├─ web/                             # Next.js (App Router)
│  ├─ app/(app)/ 입력·결과·방      app/(seo)/ SEO 페이지       app/**/opengraph-image
│  ├─ public/.well-known/           # apple-app-site-association, assetlinks.json (앱 단계)
├─ prototype/                       # Python 참조 오라클 (유지)
├─ data/                            # registry/stations.json, candidates.json, aliases.json, samples/, ATTRIBUTION.md  (raw/cache는 gitignore)
├─ docs/  (runbooks/ 포함)
├─ infra/                           # gcloud/Terraform 스크립트 (WIF, Cloud Run, GCS, Secret Manager 설정)
└─ .github/workflows/
```

의존 방향: `web`, `server`, `android`, `ios` → `shared` → (없음). `pipeline` → `shared:schema`(+`shared:core` 검증용). 계약 파일은 읽기 전용 소비.

---

## 13. 데이터 흐름 (텍스트)

```
── 컨트롤 플레인 (GitHub Actions, 수동/예약, WIF 키리스) ──
[공공데이터 API/파일(키는 Actions secret)] + data/registry + candidates + aliases
  -> pipeline: 정규화 -> 그래프(역×노선) -> 소스마다 다익스트라 -> 후보 열 추출
  -> shared:schema writer (임시 디렉토리)
  -> 검증 게이트 (불변식, 크기 예산, 직전 버전 대비 변화, 골든 샘플)  --실패--> 중단, 기존 유지
  -> gs://…/versions/<dataVersion>/ 업로드 (stations, od, seo-pages)
  -> manifest.json 교체 (마지막)
  -> Vercel Deploy Hook 호출 (SEO 페이지 재빌드)

── 데이터 플레인 ──
서버(Cloud Run): 시작 -> 이미지에 구운 정상 산출물 로드 -> 요청 중 5분마다 manifest 조건부 조회
                 -> 새 버전 검증 통과 시 교체, 실패 시 유지
                 -> API: /v1/rooms*, /v1/recommend, /v1/manifest, /v1/data/*  (Neon Postgres)

웹(Next.js): SSG(허브·조합 페이지) / SSR(generateMetadata, OG 이미지)
  혼자 입력: 브라우저에서 shared(JS)로 계산 -> /s?v=1&o=ab3.k9x&m=f  (서버 저장 없음)
  각자 입력: /r/{roomId} -> API로 참여·수정 -> 결과(공개 방은 로컬 계산, 숨긴 방은 서버 결과)
앱(Android -> iOS): 번들 시드 데이터로 로컬 계산, 방은 API, manifest로 데이터 갱신
공유: 카톡 -> /s 또는 /r 링크 -> (앱 설치자는 유니버설/앱 링크, 카톡 인앱 브라우저는 웹 폴백)
통계: 클라이언트·서버 -> PostHog (출발역 없음, 익명 distinct_id, 동의 후)
```

---

## 14. 테스트 전략

| 대상 | 방법 |
|---|---|
| 알고리즘 골든 | 3.3: 한 JSON을 Python·Kotlin(JVM·JS·iOS·Android)이 공유, 전체 순위 스냅샷 비교 |
| 알고리즘 속성 | 순서 불변, 단조성, 70/70 역전 방지, 도달 불가 처리 |
| 데이터 형식 | `schema` writer→reader 라운드트립(JVM·JS), 크기 예산, `manifest` 해시 일치, 레지스트리 코드 삭제 금지 |
| 파이프라인 | 손으로 계산한 작은 네트워크 fixture(역 8~10개, 환승 1곳) golden, 불변식(대각선 0, 후보 열 도달 가능, 최대값 범위, 정/역방향 차이 임계), 일부러 망가뜨린 입력으로 게이트가 **기존 산출물을 건드리지 않고 실패**하는지 |
| 실제 앱과의 대조 | 표본 30쌍을 카카오맵/네이버와 수동 대조하되 외부 결과값은 저장하지 않음(11.5) |
| 서버 | Ktor `testApplication` + Testcontainers Postgres: 토큰 권한(남의 출발역 수정 불가), 숨기기 응답, 만료 삭제, 최대 4명, 데이터 버전 교체·롤백 |
| 웹 | 단위(링크 코덱), Playwright 모바일 스모크(입력→결과→공유→재접속 동일 결과), OG 메타 단언(curl), 카카오 디버거 수동 실측 |
| 앱 | 공유 모듈 테스트는 CI, UI는 수동 + 최소 UI 테스트 |
| 개인정보 | 이벤트 스키마 테스트: `events.json`에 출발역·별칭 속성이 없는지 검사 |

---

## 15. 2단계 구현 병렬 단위 (소유 디렉토리가 겹치지 않게)

### S0 계약 단계 (직렬, 먼저)

소유: 루트 설정(`settings.gradle.kts`, `build.gradle.kts`, `gradle/`, `pnpm-workspace.yaml`, `package.json`, `mise.toml`), `.gitignore`, `.github/workflows/`의 골격(`secrets-scan`, 빈 CI), `contracts/` 전체, `shared/schema/`, `data/registry/` 초기본, `infra/` 초안.

산출: ① Gradle(KMP: jvm·js·android·ios 타깃) 골격과 빈 모듈, ② `contracts/golden` 이관과 전체 순위 스냅샷, `contracts/openapi.yaml`·`events.json`·`data-format.md` 초안, ③ `schema`(타입, `od.bin`·`manifest` reader/writer, fixture), ④ 역 코드 레지스트리 형식과 초기 코드, ⑤ **스파이크**: Kotlin/JS를 Next.js에서 import(번들 크기·타입), Ktor 콜드스타트 실측(Cloud Run 서울), WIF 키리스 배포 한 번 통과, ⑥ gitleaks pre-commit과 push protection 설정, ⑦ 1Password 설정 확인: vault 3개 생성, `OP_ACCOUNT` 고정과 `op whoami` 점검 태스크, `.env.tpl` 작성, **개인 플랜에서 `banbanyeok-ci` 서비스 계정이 실제로 만들어지는지**와 `load-secrets-action` 시험 실행(안 되면 폴백 동기화 스크립트). 스파이크 결과로 3.2의 웹 계산 방식(①/②)과 5.3의 호스팅을 확정한다.

### 병렬 단위 (S0 완료 후) — 웹+서버 단계

| 단위 | 소유 | 의존 | 산출 |
|---|---|---|---|
| P1 코어 | `shared/core/`, `contracts/golden/`(S0 이후 소유권 이전) | schema | `rank()`, 모드 3종, 골든·속성 테스트 |
| P2 파이프라인 | `pipeline/`, `data/`(registry 제외 raw/cache/sources) | schema, 데이터 조사 | 산출물 생성, 검증 게이트, 발행 스크립트 |
| P3 서버 | `server/`, `contracts/openapi.yaml`(소유권 이전) | schema, core | Ktor API, Flyway, 토큰·숨기기, manifest 로더(굽기+갱신) |
| P4 웹 앱 | `web/app/(app)/`, `web/components/`, `web/lib/`, `web/e2e/` | api-client, links, app-logic | 입력·결과·방 화면, 공유 |
| P5 웹 SEO·OG | `web/app/(seo)/`, `web/app/**/opengraph-image*`, `web/scripts/` | schema, core, 서버 API | 허브·조합 페이지, 사이트맵, 동적 OG |
| P6 공유 클라이언트 모듈 | `shared/links/`, `shared/app-logic/`, `shared/api-client/` | schema, core | 링크 코덱·지도 URL, 화면 로직, API 클라이언트(토큰 보관 인터페이스) |
| P7 통계·프라이버시 | `shared/analytics/`, `contracts/events.json`(소유권 이전), `web/lib/analytics/`는 P4와 협의 대신 **P7이 `web/analytics/` 소유** | contracts | `AnalyticsPort`, 이벤트 생성기, 동의 UI 훅, 스키마 테스트 |
| P8 CI·인프라 | `.github/workflows/`(S0 이후 소유권 이전), `infra/`, `docs/runbooks/` | S0 | 경로 필터 CI, WIF 배포, 키 교체 런북 |

### 후속 단계 (웹 검증 후, 순서대로)

| 단위 | 소유 | 비고 |
|---|---|---|
| A1 Android | `android/` | `shared`를 붙인 Compose 앱, Play 비공개 테스트 일정(개인 계정은 12명×14일 요건 [검색 요약 확인]) |
| I1 iOS | `ios/` | SwiftUI + direct integration, Apple 가이드라인 5.1.1 준비, 유니버설 링크는 `web/public/.well-known/`(P4 승인 후) |
| L1 로그인(후속) | `server/auth/`, `shared/api-client/` 확장 | 카카오/구글 + Apple 로그인(4.8), 계정 삭제(5.1.1(v)) |

모델·에이전트 배정은 코디네이터가 정한다(이 문서는 소유 경계만 제안).

---

## 16. 무료 플랜 한도 표 (확인일 2026-11-12)

| 서비스 | 항목 | 한도 | 이 프로젝트 영향 | 출처 |
|---|---|---|---|---|
| Cloud Run | 무료 구간 | 월 180,000 vCPU-초, 360,000 GiB-초, 요청 200만 건 | 방 API 규모에 충분 [추정] | https://cloud.google.com/run/pricing |
| Cloud Run | 최소 인스턴스 유휴 단가 | vCPU-초·GiB-초당 $0.0000025 (Tier 1 열) | 상시 가동은 월 약 $10 → 비권고 | 동일 |
| Secret Manager | 무료 | 활성 버전 6개, 접근 1만 건/월 표기 | 충분 | https://cloud.google.com/secret-manager/pricing |
| Neon Free | 컴퓨트/저장 | 프로젝트당 100 CU-시간/월, 1GB, scale-to-zero 5분 고정 | 충분 | https://neon.com/pricing , https://neon.com/docs/introduction/scale-to-zero |
| Supabase Free | DB | 500MB, 1주 무활동 일시정지, 활성 프로젝트 2개 | 일시정지로 부적합 | https://supabase.com/pricing |
| Fly.io | 상시 머신 | 256MB $2.19/월, 512MB $3.69, 1GB $6.70 | 콜드스타트 회피안 | https://fly.io/docs/about/pricing/ |
| Railway | 무료 플랜 | 월 $1 크레딧 | 부족 | https://docs.railway.com/reference/pricing/plans |
| Render 무료 | 웹 서비스 | 15분 무트래픽 스핀다운, 월 750시간, 무료 Postgres 30일 후 만료 | 부적합 | https://render.com/docs/free |
| Oracle Always Free | VM | AMD 마이크로 2대, Ampere A1 월 1,500 OCPU-시간 | 대안 | https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm |
| Vercel Hobby | 전송/호출/용도 | 100GB, 월 100만 호출, 비상업 한정 | 웹 호스팅, 수익화 시 이전 | https://vercel.com/docs/plans/hobby (검색 요약) |
| Cloudflare Workers | 요청/CPU | 일 10만 요청, 호출당 CPU 10ms (정적 자산은 무제한) | OpenNext 대안의 제약 | https://developers.cloudflare.com/workers/platform/pricing/ , .../static-assets/billing-and-limitations/ |
| Cloudflare D1 | 읽기/쓰기/저장 | 일 500만 행/10만 행/5GB | TS 서버 대안 | https://developers.cloudflare.com/d1/platform/pricing/ |
| Cloudflare R2 | 저장/연산 | 10GB-월, Class A 100만, Class B 1,000만, 송신 무료 | 복제 CDN 후보 | https://developers.cloudflare.com/r2/pricing/ |
| PostHog | 무료 | 이벤트 100만, 리플레이 5,000, 플래그 요청 100만, 오류 10만 | 충분 | https://posthog.com/pricing |
| GitHub Actions | 퍼블릭 레포 | 표준 러너 무료 | CI 비용 0 | https://docs.github.com/en/billing/concepts/product-billing/github-actions |
| Apple Developer Program | 연회비 | 99 USD/년 | 월 환산 약 1.15만 원 | https://developer.apple.com/programs/whats-included/ |
| Google Play | 등록비 | 25 USD 1회 (신규 개인 계정은 비공개 테스트 12명×14일 요건 [검색 요약]) | 일정 영향 | https://support.google.com/googleplay/android-developer/answer/6112435 , .../14151465 |

---

## 출처 (확인일 2026-11-12)

**직접 열람**: Kotlin 안정성 https://kotlinlang.org/docs/components-stability.html · 플랫폼 안정성 https://kotlinlang.org/docs/multiplatform/supported-platforms.html · iOS 통합 https://kotlinlang.org/docs/multiplatform/multiplatform-ios-integration-overview.html · SwiftPM import https://kotlinlang.org/docs/multiplatform/multiplatform-spm-import.html · Swift export https://kotlinlang.org/docs/native-swift-export.html · Ktor https://ktor.io/docs/server-deployment.html · Cloud Run https://cloud.google.com/run/pricing · Secret Manager https://cloud.google.com/secret-manager/pricing · Neon https://neon.com/pricing , https://neon.com/docs/introduction/regions , https://neon.com/docs/introduction/scale-to-zero · Supabase https://supabase.com/pricing · Fly.io https://fly.io/docs/about/pricing/ · Railway https://docs.railway.com/reference/pricing/plans · Render https://render.com/docs/free · Oracle https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm · Cloudflare(Pages, Workers, D1, KV, R2, 정적 자산, GitHub Actions CI) 1~2판 출처 + https://developers.cloudflare.com/r2/pricing/ , https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ , https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/ · PostHog https://posthog.com/pricing , https://posthog.com/docs/privacy , https://posthog.com/docs/data/anonymous-vs-identified-events , https://posthog.com/docs/libraries/ios , https://posthog.com/docs/libraries/android , https://posthog.com/docs/libraries/java · Next.js https://nextjs.org/docs/app/api-reference/functions/image-response · GitHub OIDC(GCP) https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-google-cloud-platform · GitHub Actions 과금 https://docs.github.com/en/billing/concepts/product-billing/github-actions · 1Password https://developer.1password.com/docs/cli/secrets-environment-variables/ · mise https://mise.jdx.dev/environments/secrets/ · fastlane match https://docs.fastlane.tools/actions/match/ · Android 서명 https://developer.android.com/studio/publish/app-signing · gitleaks https://github.com/gitleaks/gitleaks · Apple App Store 심사 가이드라인(4.8, 5.1.1) https://developer.apple.com/app-store/review/guidelines/ · Apple 비용 https://developer.apple.com/programs/whats-included/ · Google Play 등록비 https://support.google.com/googleplay/android-developer/answer/6112435 · 달레의 코딩 블로그 https://daleseo.com/control-plane-data-plane/

**1Password(직접 열람)**: 서비스 계정 개요 https://developer.1password.com/docs/service-accounts/ · 시작하기(제약) https://developer.1password.com/docs/service-accounts/get-started/ · 요청 한도(플랜별) https://developer.1password.com/docs/service-accounts/rate-limits/ · GitHub Actions https://developer.1password.com/docs/ci-cd/github-actions/ · 다중 계정(`--account`, `OP_ACCOUNT`) https://developer.1password.com/docs/cli/use-multiple-accounts/ · 비밀 참조와 `op run` https://developer.1password.com/docs/cli/secrets-environment-variables/

**검색 요약으로만 확인**: Vercel Hobby https://vercel.com/docs/plans/hobby · Google Play 개인 계정 테스트 요건 https://support.google.com/googleplay/android-developer/answer/14151465 · 카톡 인앱 브라우저 유니버설 링크 사례 https://devtalk.kakao.com/t/ios-android/134879 , https://devtalk.kakao.com/t/branch/151358 · 카카오 미리보기 캐시 https://devtalk.kakao.com/t/topic/22238

**1~2판 출처(유효)**: Kakao 지도 길찾기 링크 https://apis.map.kakao.com/web/guide/ · 네이버지도 URL Scheme https://guide.ncloud-docs.com/docs/application-maps-url-scheme-vpc · Expo/Capacitor 문서(3판에서 폐기된 경로의 근거) · 내부 문서: `docs/research/{data-sources,product-ux,algorithm}.md`, `docs/01-synthesis.md`

---

## 결정 필요

1. **iOS 비용 수용 여부**: Apple 연 99 USD(월 환산 약 1.15만 원)가 월 1만 원 목표를 넘는다. iOS를 출시하는 시점을 사용자 수·수익 가능성과 연결해 정할지, 그전에는 Android+웹만 낼지.
2. **웹 계산 방식(S0 스파이크 결과에 따름)**: Kotlin/JS로 `shared`를 웹에서 직접 쓸지, 서버 API만 호출할지. 기본안은 Kotlin/JS이며, 번들 크기·Next.js 연동이 나쁘면 서버 API로 폴백. TS 포팅은 원치 않는다는 전제 확인 필요.
3. **서버 콜드스타트 허용 범위**: Cloud Run(min 0)으로 시작하고 실측이 3초를 넘으면 Fly.io 512MB(월 약 5천 원) 상시 가동으로 갈지, 기동 최적화를 먼저 시도할지.
4. **Vercel Hobby의 비상업 제한**: 광고·수익화 계획이 있는가? 있으면 Vercel Pro 또는 Cloudflare+OpenNext(동적 OG의 CPU 한도 [미확인])로 가야 한다.
5. **수치 표현**: 소요시간을 정수 초(권고) 또는 정수 분으로 고정할지(부동소수 차이와 골든 일치 때문). 현재 골든은 분 단위 정수다.
6. **숨기기 수준**: 숨긴 출발역의 이름만 가릴지(권고, 시간은 보임), 시간까지 가릴지. 후자는 결과 카드 설계가 바뀐다.
7. **방 만료 정책**: 7일 슬라이딩/최대 30일(권고)을 확정할지, 약속일 입력을 필수·선택 중 무엇으로 할지.
8. **개인정보처리방침과 동의**: 방침 초안 작성자, 수집 항목(출발역·별칭·익명 ID·기기 토큰·통계), 국외 처리(Vercel, Neon 싱가포르, PostHog US/EU 리전 선택) 고지, 웹 분석 동의 UI 방식. 국내법 요건은 법률 확인 필요. Apple은 방침 링크와 분석 동의를 요구한다 [확인].
9. **PostHog 리전**: US/EU 중 선택(국외 이전 고지 영향). 퍼블릭 레포에는 `phc_` 토큰만 둘 것.
10. **API 노출 방식**: Vercel rewrite 같은 출처(권고) vs Cloud Run 커스텀 도메인(서울 리전 매핑 지원 [미확인]).
11. **산출물 저장소**: GCS+WIF(권고, 키리스) vs R2(무료 송신·CDN이지만 쓰기 토큰 필요). 클라이언트 직배포가 필요해질 때 R2 복제 시점.
12. **KTDB 가공물**: 상업 서비스·재배포 허용 범위가 확정되기 전에는 사용·배포하지 않는다는 방침에 동의하는지. 서울 열린데이터광장·TAGO 키 발급 주체(본인 계정 필요).
13. **퍼블릭 레포 정책**: 코드 라이선스(MIT/Apache-2.0/AGPL), 서비스 이름·로고 상표, `data/samples/`의 라이선스 재확인, 외부 경로 API 대조 표본은 결과값을 저장하지 않는다는 방침.
14. **1Password 운영 세부(원본은 개인 vault로 확정)**: ① 개인 플랜(Individual/Families)에서 서비스 계정을 실제로 만들 수 있는지 — 한도 표에 해당 플랜이 있어 가능해 보이나 생성 가능 여부는 [미확인], 하루 1,000건 한도에 주의. 안 되면 Environment secrets 수동 동기화로 간다. ② 서비스 계정 토큰 하나를 GitHub Environment에 영구 보관하는 위험을 받아들일지, Credential Broker(토큰 없음, 공개 미리보기, 개인 플랜 사용 가능 여부 [미확인])를 기다릴지. ③ `OP_SERVICE_ACCOUNT_TOKEN`을 `false`로 해제하는 mise 설정이 실제로 먹는지(안 되면 direnv `unset`). ④ vault 3개 분리(로컬/CI/릴리스)에 동의하는지.
15. **스토어 릴리스 방식**: 앱 제출은 로컬 수동(권고) vs CI 자동화. CI로 가면 Environment 승인자와 ASC/Play 서비스 계정 비밀을 어디에 둘지.
16. **Google Play 계정 유형**: 개인 계정이면 비공개 테스트 12명×14일 일정이 필요하다는 요건 [검색 요약] 반영 여부, 조직 계정 가능 여부.
17. **로그인 도입 시점과 제공자**: 카카오·구글을 붙이면 iOS에는 Apple 로그인 동등 옵션이 필수이고 계정 삭제를 앱에서 제공해야 한다 [확인]. 당분간 비회원만으로 가는지.
18. **예약 워크플로 의존**: 데이터 발행을 수동 디스패치로 둘지 예약 실행을 병행할지(공개 레포 60일 비활동 시 비활성화 [추정]).
19. **iOS 러너 비용**: macOS 표준 러너가 퍼블릭 레포 무료 범위인지 확인(미확인), 아니면 iOS CI는 로컬 빌드로 대체.
