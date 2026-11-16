# W2(괄호) 작업 노트 — iOS Safari 여는 괄호 줄끝 고립, /privacy 배너 겹침

검증일: 2026-11-16. 수정 전 기준은 main(PR #41 병합 후).

## 1. 현상

1. iPhone Safari에서 /privacy "한눈에 보기" 마지막 줄이 "…외국 회사 (미국·싱가포르)입니다 (⏎7항)."로 보인다. "(" 바로 뒤에서 줄이 바뀐다.
   배너에서도 "쓰는지(⏎기능별"이 있었다.
2. /privacy에서 동의 배너가 바로 아래 '통계 설정' 카드(같은 두 동의)를 덮는다.

## 2. 재현 방법 (진짜 iOS 엔진만 재현한다)

- Chromium과 데스크톱 WebKit(Playwright, webkit-2388)은 **재현되지 않는다**(390×844, DSF 3, isMobile, 폰트 로드 후, 320~440px 1px 단위 훑기 포함).
  그래서 Playwright 줄 위치 검사(`orphanedOpenParens`)는 수정 전에도 통과한다 → 구조 검사(`unguardedOpenParens`)가 수정을 지킨다.
- Xcode iOS 시뮬레이터(iPhone 17, iOS 27.2, Safari 27.2)에서 재현된다: `web/scripts/ios-sim-line-break.ts`(`pnpm ios-sim:line-break`).
  웹 앞에 작은 프록시를 세워 HTML에 측정 코드를 넣고, 시뮬레이터 Safari로 열어 폭 320~440px을 2px씩 바꿔 가며
  "("와 그 다음 글자의 줄(y)을 `Range.getClientRects`로 비교한다(CI에서는 돌리지 않는다, 수동 점검).
  순서는 스크립트 머리말: 시뮬레이터 부팅 → 통계 키를 넣어 빌드 → `pnpm start --port 3100` → 스크립트 실행 → 시뮬레이터 종료.
- 실험용 환경변수: `LB_UNWRAP=1`(괄호 묶음을 풀어 수정 전 상태), `LB_CSS="…"`(후보 CSS 덧붙임).
  묶음은 수화(hydration) 뒤에 풀어야 한다(먼저 풀면 React가 되돌린다).

## 3. 원인

body의 `word-break: keep-all`(globals.css)이 iOS WebKit에서 "(" 뒤에 줄바꿈 기회를 만든다(UAX14상 OP 뒤는 금지인데 깨짐).
`LB_CSS="body{word-break:normal}"`로 바꾸면 사라진다. 하지만 normal은 한글을 음절 중간에서 끊으므로 전역으로 쓸 수 없다(keep-all이 필요하다).

## 4. 후보 비교 (iOS 시뮬레이터, 수정 전 = 묶음 해제, 폭 320~440px 61개)

| 후보 | /privacy "(" 고립 폭 수(최대 곳수) | 홈 "/" |
|---|---|---|
| 수정 전 | 61/61 (19곳) | 13/61 (1곳) |
| (a) `overflow-wrap: break-word` | 61/61 (19곳) | 13/61 |
| (b) `line-break: strict` | 61/61 (19곳) | 13/61 |
| (a)+(b) | 61/61 (19곳) | 13/61 |
| `word-break: normal`(참고, 한글 중간 끊김이라 불가) | 0/61 | 0/61 |
| **(c) 괄호 묶음을 한 덩어리로(`parenSafe`)** | **0/61 (0곳)** | **0/61** |

(a)·(b)는 효과가 없다. (c)를 골랐다.

## 5. 고른 수정: `parenSafe` (web/src/lib/text/paren-safe.tsx)

"("가 든 **말마디 전체**(공백 사이 덩어리, 정규식 `/\S*\(\S*/gu`)를 인라인 span 하나로 묶는다. 처음에는 `(`부터 묶어 "서울"+"(asia-northeast3)"처럼 단어가 쪼개졌고(문구의 묶음 163개 중 145개), 리뷰에서 지적돼 말마디 전체로 바꿨다.
  너비 점수(한글·전각 2, 반각 1) 16 이하는 `whitespace-nowrap`, 더 길면(주소) `[word-break:normal]`만(인라인 유지: inline-block은 Chromium이 접근성 이름에 앞뒤 공백을 넣는다. nowrap은 긴 주소를 화면 밖으로 넘기므로 쓰지 않는다).
  좁은 칸(스위치 라벨 약 176px @320px)에서 넘치지 않도록 e2e가 `[data-paren-safe]` 폭 ≤ 담은 블록 폭을 /·/privacy 320~430px에서 검사한다(상한을 크게 하면 실패하는 것을 확인).
- 단어 중간을 자르지 않고 말마디 통째로 묶으므로 낭독·복사·찾기는 그대로다.
- 한 줄보다 긴 덩어리(주소)는 블록 안에서 일반 규칙으로 접혀 가로로 넘치지 않는다(nowrap이면 넘친다). e2e가 320~430px에서 `scrollWidth <= innerWidth`를 확인한다.
- 전역 CSS는 바꾸지 않았으므로 다른 화면의 줄바꿈은 변하지 않는다(괄호가 있는 문구만 영향).
- 적용: /privacy 본문·표·통계 설정, 동의 배너 문구.
- 한계: 문자열 안에서만 동작한다(요소가 괄호 안에 섞이면 못 묶는다).

전/후 스크린샷: `w2-paren-screens/before-ios-privacy-summary.jpg`, `after-ios-privacy-summary.jpg`(요약 영역만 잘랐다)(시뮬레이터 Safari, 402pt).

## 6. /privacy에서는 배너를 띄우지 않는다

`ConsentBanner`가 `usePathname() === "/privacy"`이면 null. 다른 경로는 그대로. 배너의 "개인정보 처리방침의 통계 설정" 링크는
`/privacy#analytics-settings`로 가서 거기서 고른다. 통계 설정 카드가 배너 요건을 이미 채우는지 테스트로 고정했다
(`consent.test.tsx`): 수집·이용/국외 이전 두 스위치 분리·기본 해제, 알릴 사항(목적·항목·받는 자·국가·보유 기간·철회·14세·거부해도 불이익 없음).
카드는 켜기/끄기 스위치라 거부와 동의의 무게가 같다. 동의 문구가 바뀌지 않았으므로 `CONSENT_VERSION`은 올리지 않았다.

## 7. 같이 한 것

홈의 방 입구 링크 문구: "방 만들어서 각자 입력하기 →" / "링크를 보내면 친구가 자기 출발역을 직접 넣어요. 출발역은 숨길 수도 있어요."(운영자 결정: 용어 '방' 유지).

## 8. 리뷰 반영 후 재측정과 접근성 확인

- 말마디 전체 묶음(`/\S*\(\S*/gu`)으로 바꾼 뒤 iOS 시뮬레이터(iPhone 17, Safari 27.2) 재측정: /privacy 0/61, 홈 0/61. 묶음을 푼 상태(수정 전)는 /privacy 61/61(한 폭 최대 22곳), 홈 13/61.
- 접근성 이름: Accessibility Inspector(GUI)는 이 자동 작업에서 돌리지 못했다. 대신 Playwright(Chromium·WebKit)의 접근성 이름 계산으로
  11항 목차 링크와 h2의 이름이 `exact: true`로 글자 그대로("…장치(쿠키 등)의…")이고 `textContent`도 같음을 e2e가 확인한다. 실기기 VoiceOver 확인은 남아 있다(수동).
- 시뮬레이터 프록시는 127.0.0.1에만 열고 `/`로 시작하는 경로 요청만 받는다.
