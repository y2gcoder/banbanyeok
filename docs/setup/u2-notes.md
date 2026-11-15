# U2 작업 노트: 운영 QA에서 나온 입력·방·동의 배너 UX 수정

검증일: 2026-11-16. 운영(폰 390×844, 데스크톱 1280) 브라우저 QA에서 나온 4건. 범위 밖: "누구 쪽으로" 탭 이름이 출발역에 따라 바뀌는 것(의도).
새 의존성 없음. 계약은 방 응답(`Room`)에 선택 필드 `timeBasis` 하나를 더했다(3번).

## 1. "다시 입력"이 일부만 복원됨

- **원인**: "다시 입력"은 `href="/"`였고 입력 화면은 기기에 기억한 "나" 한 칸(`banbanyeok:me`)만 되살렸다. 둘째 칸 이후는 저장한 적이 없고,
  구분(`언제 만나요?`)은 열릴 때마다 지금 시각으로 덮였다. 모드는 입력 화면에 상태가 없어 다시 찾으면 공평으로 돌아갔다.
- **수정**: "다시 입력"(과 오류 때의 "출발역 바꾸기")이 결과 링크와 같은 쿼리로 간다: `/?v=2&o=…&m=…&t=…&n=…`(`restoreHref`).
  입력 화면은 이 쿼리를 `decodeShareQuery`로 읽어 모든 줄(이름·역)·구분·모드(배려하던 사람 포함)를 되살린다(`parseRestore`). 기기 저장소에 새로 쓰는 것이 없다.
  계산할 수 없는 역은 그 줄만 비운다(줄 순서·배려 대상 위치가 어긋나지 않는다). 쿼리가 규칙에 안 맞으면 예전처럼 `?o=` 미리 채우기 → 기억한 "나" 순으로 넘어간다.
  입력 화면이 모드를 이어 들고 있다가 제출 때 링크에 싣는다(배려하던 줄이 지워졌거나 역이 비면 공평으로).
- 분석: 페이지 URL의 쿼리는 이미 `redactUrl`이 모든 URL 속성에서 지운다(출발역 코드가 통계로 나가지 않는다).
- 테스트: `prefill.test.ts`, `home-form-prefill.test.tsx`(컴포넌트), `e2e/u2-ux.spec.ts`(혜화+강남, 토요일 밤 → 결과 → 다시 입력, 모드 이어짐, 한 줄만 바꾸기).

## 2. 역 자동완성 키보드 선택

- **원인 1(버그)**: `StationField`가 고른 역을 후보 목록 **맨 앞에** 끼워 넣었다("고른 역은 목록에 항상 있어야 값이 보인다"). 그래서 다른 이름을 새로 칠 때
  (예: 혜화를 고른 칸에서 "강남") 이전에 고른 역이 첫 후보가 되어 자동 하이라이트·Enter가 그 역을 골랐고 정확 일치는 둘째로 밀렸다.
  → 검색 결과만 후보로 둔다. 입력 칸 글자는 우리가 정한 `inputValue`라 고른 역이 목록에 없어도 표시는 그대로다.
- **원인 2(버그 아님)**: `autoHighlight`로 첫 후보가 처음부터 하이라이트이고 `aria-activedescendant`도 그 항목이다. 그래서 **ArrowDown은 둘째 후보**로 옮기고
  Enter는 하이라이트된 항목을 고른다. "강남" → 강남/강남대/강남구청이면 ArrowDown+Enter는 강남대이며 Base UI 규약대로다(Enter만 누르면 강남). 이 동작은 그대로 두었다.
- 정렬은 이미 정확 일치(0) → 자모 접두사 → … 순이라 "강남"의 첫 후보는 강남이다(`index.test.ts`).
- 테스트: `station-field.test.tsx`(하이라이트·activedescendant·Enter 일치, 고른 역이 끼어들지 않음 — 수정 전 실패 확인), `e2e/u2-ux.spec.ts`.

## 3. 방 참여자 화면에 계산 기준 안내 없음

- 방장 만들기 화면은 약속 날짜·시각으로 클라이언트가 구분을 보여 주지만, 이미 만들어진 방의 참여 화면은 **서버가 구분을 정한다**(공휴일은 서버 목록).
  웹이 날짜로 공휴일을 다시 계산하면 서버와 어긋날 수 있어, 방 응답이 기준을 직접 준다.
- **계약**: `Room.timeBasis`(기존 `TimeBasis` 스키마 재사용, 선택 필드). `label`("토요일 저녁")·`holidayName`("추석")을 서버가 약속 날짜·시각에서 정해 준다.
  `timeSlot`과 `requestedTimeSlot`은 같다(대신 계산하는 경우는 결과에서만 생긴다). 선택 필드로 둔 이유: 웹·서버가 따로 배포되므로 한쪽이 먼저 나가도 화면이 깨지지 않는다
  (없으면 문구를 그리지 않는다). 서버는 `Room` 응답(GET·PATCH)에 항상 싣는다.
- 서버: `RoomView.toDto`가 `TimeSlotResolver`(결과 계산과 같은 규칙·같은 번들 공휴일 목록)로 만든다. `ApiServices`에 파라미터를 더하면 detekt `LongParameterList`(최대 6)에 걸려
  Routes의 지연 초기화 값으로 두었다.
- 웹: 참여·수정 폼(`JoinForm`)에 방장 화면과 같은 문구 "○○ 기준으로 계산해요"(공휴일이면 "토요일 낮(추석) 기준으로…")를 서버 `label` 그대로 보인다.
- 테스트: `TimeSlotHttpTest`(서버, 계약 검증·공휴일 이름), `room-screen.test.tsx`(서버 문구가 우선, 옛 서버는 문구 없음), `e2e/u2-ux.spec.ts`, `e2e-real/time-slots.spec.ts`(실제 서버·참여 전 친구).

## 4. 분석 동의 배너가 폰 화면 아래를 크게 가림

- 폰(390×844)에서 배너가 348px(화면의 41%)였다 → **약 310px(37%)**. 같은 390 폭에서 체크박스를 나란히 두고 안내 글자·여백을 줄였다(설명을 숨겼을 때는 236px였으나, 아래처럼 설명을 보이게 되돌렸다).
  · 두 체크박스는 360px 이상에서 나란히(그 아래는 위아래), 라벨 글자 13px, 라벨 누르는 영역은 높이 44px 이상을 지킨다(U1 터치 기준).
  · 체크박스 **설명**(항목·목적·보유 기간·국외 이전 내용)과 철회 안내("언제든 바꿀 수 있어요")는 폰에서도 **눈에 보인다**. 구분 동의·국외 이전 동의는 동의 받는 화면에서
    중요 내용을 알기 쉽게 보여야 하므로 처리방침 링크로 대체하지 않는다(링크는 "자세히"용으로만 남는다).
  · 동의 문구(`consent-text.ts`)는 **한 글자도 바꾸지 않았다**(그래서 `CONSENT_VERSION`도 그대로, 이미 고른 사람은 다시 묻지 않는다).
- 동의 의미·선택 동등성 유지: 두 항목 구분 동의(기본 해제, 둘 다 체크해 저장해야 동의), 버튼은 "모두 거부"·"선택한 대로 저장" 두 개뿐이고 같은 크기·같은 줄·같은 모양,
  "모두 동의" 같은 묶음 단추 없음. `consent.test.tsx`·`policy.test.ts`는 수정 없이 통과한다.
- 가리지 않기: 배너는 문서 끝의 `sticky bottom-0`이라 맨 아래까지 스크롤하면 본문 **아래에 배너 자리가 따로** 있다(본문 하단 여백 = 배너 높이). 화면 키보드가 열리면 숨는 동작(U1)도 그대로다.
  e2e가 4개 크기에서 맨 아래로 스크롤한 뒤 본문 마지막 링크가 배너 위에 완전히 보이고 눌리는지 확인한다.
- 테스트: `e2e-analytics/banner-layout.spec.ts`(U1 7개 크기 + U2 4개 크기: 높이 비율, 버튼 같은 크기·한 줄, 체크박스 기본 해제·화면 안, 터치 44px, 맨 아래 가림 없음).

## 5. 검증

```text
$ cd web && pnpm typecheck && pnpm lint && pnpm test      # 통과 (Vitest 53 파일 449 테스트)
$ pnpm check:contracts                                     # 통과(커밋 뒤 diff 없음)
$ CI=1 pnpm e2e                                            # 기본 398 passed(U1 반응형 행렬 포함) + 통계 빌드 28 passed
$ pnpm e2e:real                                            # 17 passed, 1 skipped(라이브 PostHog) — 로컬 compose DB + Ktor + next start
$ ./gradlew :server:app:ktlintCheck :server:app:detekt :server:app:test   # 통과
```

## 6. 캡처 (`docs/setup/u2-screens/<기기>/`)

기기: `phone-390x844`(폰), `fold-cover-344`(폴드 접힘), `fold-open-690`(폴드 펼침), `desktop-1280`. 화면: `2-result`(결과), `1-home-restored`(다시 입력 뒤 입력 화면),
`3-room-join`(방 참여, 기준 문구), `4-consent-banner`(동의 배너). CSS px 1:1.

```sh
cd web
UPDATE_SCREENSHOTS=1 pnpm exec playwright test e2e/u2-ux.spec.ts -g 캡처
UPDATE_SCREENSHOTS=1 pnpm exec playwright test --config playwright.analytics.config.ts e2e-analytics/banner-layout.spec.ts -g "U2 "
```

(`UPDATE_SCREENSHOTS`는 다른 spec의 캡처 경로도 켜므로 `-g`로 좁혀 돌린다.)

## 결정 사항

1. `Room.timeBasis`는 선택 필드로 둔다(웹·서버 배포가 병렬이라 순서를 보장할 수 없다).
2. 폰 배너에서도 체크박스 설명·철회 안내를 보인다(동의 효력). 높이 증가분은 수용.
