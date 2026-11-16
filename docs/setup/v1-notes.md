# V1 작업 노트: 카카오 미리보기 그림, 결과 카드 시간 행, 짧은 이름, 세 번째 탭

검증일: 2026-11-16. 사용자가 실제 폰(iPhone Safari)과 카카오톡에서 본 문제 4건. 1단계 시안(썸네일 4안, 시간 행 3안, 이름 표기 3안, 탭 이름 5안)을
보고 사용자가 고른 안을 구현했다: **썸네일 C(노선이 한 역으로 모이는 그림), 시간 행 R1(두 줄 + 공통 눈금), 표기 L3(칸에는 짧은 이름), 탭 "누구 쪽으로"(고정)**.
새 의존성 없음. 계약은 `participants[].shortLabel` 하나를 더했다(사용자 허락, 3절).

## 1. 카카오 미리보기 그림이 회색 빈칸

- **원인**: 루트 레이아웃 `siteMetadata()`가 `metadataBase`를 `process.env.SITE_URL`로 만든다. 배포는 `SITE_URL`을 빌드에만 넣고
  Worker 런타임 변수로는 넣지 않는다. 그래서 **요청 때 렌더되는** `/s`, `/r/[방 ID]`, `/result`의 og:image·twitter:image·canonical·og:url이
  `http://localhost:3000/...`이었다(운영 HTML을 카카오 스크랩 UA로 받아 확인). 정적 페이지는 빌드 값이 박혀 정상이었다.
  그림 자체(`https://banbanyeok.app/s/og?...`)는 카카오 UA(`facebookexternalhit/1.1;kakaotalk-scrap/1.0`)로 200 image/png였다. 주소만 틀렸다.
- **수정**: `next.config.ts`의 `env`로 `SITE_URL`·`SITE_NOINDEX`를 빌드 값으로 번들에 박고, 사이트 모듈은 `siteEnv()`
  (`process.env.SITE_URL`을 이름 그대로 적어 빌드가 치환하게)를 기본값으로 쓴다. `process.env`를 통째로 넘기면 런타임 환경을 읽어 Worker에서는 비어 있다.
- **canonical·og:url 정리**:
  - 링크마다 다르고 색인하지 않는 페이지(`/s`, `/result`, `/r/[방 ID]`): 레이아웃의 홈 canonical·og:url을 물려받지 않게 canonical을 지우고 og:url을 두지 않는다
    (메신저는 공유한 링크 그대로 연다). 결과를 못 가져온 `/s`(잘못된 링크·서버 지연)와 `/result`는 사이트 기본 이미지를 직접 가리킨다.
  - `/privacy`, `/r/new`: canonical·og:url이 홈을 가리키던 것을 자기 주소로.
- **검증**(로컬 운영 빌드): `SITE_URL=https://banbanyeok.app SITE_NOINDEX=1 pnpm build` 후 `SITE_URL` 없이 `next start` + 가짜 서버.
  `/s?v=2&o=ryf.4q3.dxy.bvq&m=f&t=weekday-day`의 og:image = `https://banbanyeok.app/s/og?v=2&o=ryf.4q3.dxy.bvq&m=f&t=weekday-day&dv=20261115.8`,
  그 경로 200 image/png 1200×630(캐시 1일). `/s?bad`, `/r/…`, `/result?…`의 og:image = `https://banbanyeok.app/opengraph-image`,
  `/privacy`·`/r/new`의 canonical·og:url = 자기 주소.
- **스모크**(`web/scripts/smoke-deploy.sh`): 서버가 연결된 배포에서 `/s`의 og:image가 `${SITE_URL}/s/og?…`로 시작하고 그 주소가 200 image/png인지 본다.
  `SITE_URL`이 없으면(workers.dev 단계) 경고만. 지금 운영 HTML로 돌리면 localhost라서 실패한다(검사가 버그를 잡는다).
- **robots.txt**(`Disallow: /`): 같은 robots 아래에서 카카오가 제목·설명을 가져갔으므로 스크랩 봇이 robots로 HTML을 거르지 않는다. 이미지에만 따로 적용된다는 근거는 없다.
  **배포 후 할 일(사용자)**: 카카오 공유 디버거에서 기존 링크의 캐시를 지우고 다시 스크랩해 그림이 나오는지 확인.

## 2. 공유 링크 그림(`/s/og`) — 시안 C

왼쪽에 "{1위역} / 에서 볼까?"와 요약("가장 오래 걸려도 31분" / "차이 11분 · 공평하게 고름 · 토요일 밤 기준"), 오른쪽에 각자의 노선이 만날 역의 환승 고리로 모인다.
노선 길이는 사람마다 같다(길이로 시간을 읽게 하지 않는다. 시간은 노선 위 숫자). 카카오 말풍선(약 270px)에서도 역 이름과 색 노선이 읽힌다.

| 경우 | 정한 것 | 캡처 |
|---|---|---|
| 2·3·4명 | 노선 간격 210/150/112px | `og-two-saturday-night`, `og-three-favor-zero`, `og-four-fair` |
| 이름 | 서버 짧은 이름(shortLabel). 글꼴에 없는 글자(이모지)는 빼고 10자 넘으면 말줄임(`OG_NAME_MAX` 7 → 10, 가장 긴 역 이름 9자는 안 자름) | `og-nickname-hidden` (20자 별칭) |
| 출발역 숨김 | 서버가 출발역 이름을 주지 않고 이름은 "참가자 N"이다. 숨긴 역은 그림·설명에 나올 수 없고 테스트가 확인한다 | `og-nickname-hidden` |
| 같은 역 두 명 | "강남 1", "강남 2"(서버 번호 그대로) | `og-same-station` |
| 0분(만날 역이 바로 출발역) | 숫자 대신 "바로 여기" | `og-three-favor-zero` |
| 누구 쪽으로 | 고른 사람의 노선·점을 굵게 맨 위에, 나머지는 흐리게. 아래 줄 "○○ 쪽으로 고름" | `og-three-favor-zero`, `og-nickname-hidden` |
| 빠른 만남 | 그림은 같고 아래 줄 "가장 빠른 만남으로 고름" | `og-four-fast` |
| 평일 낮이 아닌 기준 | 아래 줄 끝에 "· 토요일 밤 기준". 한국어도 낱말 단위 줄바꿈(`word-break: keep-all`) | `og-two-saturday-night`, `og-long-station-over-hour` |
| 긴 역 이름·1시간 넘음 | 제목 크기를 글자 수에 맞춤, "1시간 7분" | `og-long-station-over-hour` |

- **시간 예산(사용자 결정)**: `/s/og`는 서버 결과 받기 + 그리기 전체를 1.5초 안에 끝내야 한다. 넘거나 실패하면 기본 카드(`SiteCard`)를 짧은 캐시(60초)로 준다.
  그리기 실패도 잡히게 PNG 바이트를 다 만든 뒤 응답한다. 테스트: `src/app/s/og/route.test.tsx`(성공 1일 캐시, 예산 초과·실패·잘못된 링크는 60초).
- **방 링크(`/r/[방 ID]`)는 기본 카드 유지(사용자 확정)**. 근거: 방 결과는 보는 사람마다 공개 범위가 다르고(숨긴 출발역은 본인만 봄), 참여 중에는 결과가 계속 바뀌며,
  방 ID만으로 서버를 부르면 링크를 가진 크롤러에게 참여자 이름·시간을 넘기게 된다. 방 ID·참여자 정보를 쓰지 않는 일반 문구와 사이트 기본 이미지다(기존 원칙 그대로).

### 그리기 시간·CPU (A 이전 그림 vs C 새 그림)

로컬(Apple M4 Pro, Node 24, `next/og` satori + resvg, 같은 서브셋 글꼴), 경우마다 예열 5회 후 40회. 단위 ms.
CPU는 프로세스 전체(`process.cpuUsage`, 사용자+시스템)라 벽시계보다 크게 나온다.

| 경우 | 그림 | 벽시계 p50 | p90 | CPU p50 | p90 | PNG |
|---|---|---|---|---|---|---|
| two-saturday-night | A | 7.7 | 8.2 | 10.2 | 13.0 | 38 KB |
| two-saturday-night | C | 11.1 | 11.8 | 13.7 | 18.3 | 51 KB |
| four-fair | A | 8.3 | 8.5 | 10.5 | 12.9 | 43 KB |
| four-fair | C | 11.9 | 12.1 | 13.7 | 14.7 | 59 KB |
| nickname-hidden | A | 8.3 | 8.5 | 10.2 | 13.4 | 46 KB |
| nickname-hidden | C | 12.1 | 12.5 | 14.0 | 16.4 | 60 KB |

C는 A보다 그리기가 약 3.5ms(약 +40%) 길다(곡선 SVG와 큰 글자). 로컬 응답 시간(`next start`, 가짜 서버): `/s/og` 200 image/png 0.086초.
Workers 실측은 배포 키가 필요해 하지 않았다: 병합·배포 후 `deploy-web` 수동 실행에서 `measure`를 켜면 경로별 CPU가 요약에 남는다(P8b 3절, `/s/og`는 무료 플랜 한도 10ms를 이미 넘던 경로).

## 3. 짧은 이름 `shortLabel` (계약 추가, 표기 L3)

- **규칙**(`contracts/data-format.md` §8, `golden/display-labels.json` 2판): 출발역 이름으로 부르는 사람은 `label` "홍대입구에서 오는 분"·`shortLabel` "홍대입구"
  (번호는 같게 "강남 2"), 이름을 넣은 사람·숨긴 사람("참가자 N")은 둘이 같다. 서버(`shared/app-logic ParticipantLabels`)가 만들고 웹·앱은 그대로 쓴다.
- **어디에 무엇을**: `shortLabel` = 결과 카드 시간 행, 배려 대상·"나는 누구?" 알약, 미리보기 그림, 미리보기 설명(og:description)·공유 버튼 문구의 시간 나열, 방 설정 요약의 "○○ 쪽으로".
  `label` = 추천 이유 등 문장(서버가 만든다, 그대로). 방 참여자 목록·길찾기 목록은 넓은 줄이라 그대로 `label`.
- **배포 순서**: 웹(main 병합 시 자동)이 서버(수동 배포)보다 먼저 나갈 수 있어, 웹은 `shortLabel`이 없으면 `label`로 그린다. 서버가 배포되면 짧은 이름이 나온다.
- 테스트: `DisplayLabelVectorsTest`(벡터 전부), `ApiHttpTest`(방 응답의 shortLabel, 숨긴 사람 "참가자 N"), 웹 단위·e2e 픽스처.

## 4. 결과 카드 시간 행 — 시안 R1

- 한 사람이 두 줄: 위 줄 "이름 · 환승 n번 ……… 31분", 아래 줄 트랙. **모든 트랙이 카드 폭 전체로 시작·끝·길이가 같다**(이전에는 이름 칸 폭만큼 트랙이 밀려 줄마다 길이가 달랐다).
- 맨 아래 공통 눈금(0·10·20·30·40분). 끝 눈금은 최장 시간을 눈금 간격으로 올린 값이라 "가장 오래 걸리는 사람 = 끝"이 아니라 자처럼 읽힌다.
  60분 넘으면 20분, 120분 넘으면 30분 간격(`railScale`). 0분인 사람은 0 눈금에 점.
- 이름이 길면 줄바꿈만 되고 트랙에 영향이 없다(20자 별칭도 잘리지 않는다).
- 캡처: `phone-390-card-four.png`, `phone-390-card-zero-favor.png`.

## 5. 세 번째 탭 "누구 쪽으로"(고정) + 공유 문구

- 탭 이름은 고르기 전후 모두 "누구 쪽으로"(5자, 320 폭 3등분에서도 안 잘림). 바로 아래 "오늘은 [홍대입구] … 쪽으로" 알약이 답한다.
  캡처: `phone-390-tabs-favor.png`, `phone-320-tabs-favor.png`(이전: "서울대입구에서 오는 분 쪽으로"가 양쪽이 잘려 "대입구에서 오는 분 쪽"으로 보였다).
- **공유 버튼 문구 버그 수정**: 탭 이름에 "로 고름"을 붙여 "공평하게로 고름", "빨리 만나기로 고름", "○○ 쪽으로로 고름"이 되던 것을
  미리보기와 같은 한 마디(`modeSentence`: 공평하게 고름 / 가장 빠른 만남으로 고름 / ○○ 쪽으로 고름)로.

## 검증

```text
$ ./gradlew check                       # ktlint, detekt, Konsist, 단위 테스트(shared 벡터·server ApiHttpTest 포함)
exit 0
$ cd web && pnpm typecheck && pnpm lint  # tsc, biome, eslint, knip, dependency-cruiser
✔ no dependency violations found
$ pnpm exec vitest run
Tests  456 passed
$ pnpm e2e                              # 가짜 서버, Playwright
398 passed / 28 passed
$ pnpm check:contracts                  # 커밋 후 재생성 diff 없음(글꼴·글자 목록은 바뀌지 않음: 새 고정 문구 글자가 이미 서브셋에 있음)
```

캡처 다시 만들기: OG 그림 `cd web && OG_SCREENS_DIR=../docs/setup/v1-screens pnpm exec vitest run og-render`.
폰 캡처는 로컬 운영 빌드에서 브라우저의 `/api/v1/recommend`를 운영 서버 응답(+shortLabel)으로 대신 답해 찍었다.

## 결정 필요

- 없음(이번 범위의 선택은 모두 사용자 결정). 배포 뒤 확인 2가지: ① 서버 배포(shortLabel), ② 카카오 공유 디버거 캐시 초기화 후 미리보기 그림.
  Workers CPU 실측이 필요하면 `deploy-web`을 `measure`로 수동 실행.
