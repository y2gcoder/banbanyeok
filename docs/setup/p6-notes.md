# P6 작업 노트 — 공유 클라이언트 모듈 (`shared/links`, `shared/app-logic`)

작성 2026-11-12 · 범위: 공유 링크 `/s` 코덱, 지도 앱 길찾기 링크, 추천 이유 문장 생성, 입력 검증, 극단 상황 문구. `shared/core`에는 의존하지 않는다(P1이 동시에 만드는 중이라 코어 타입과의 어댑터는 서버가 붙인다).

## 1. 계약을 바꾼 것

| 변경 | 이유 | 고친 파일 |
|---|---|---|
| 공유 링크 별칭 구분자 `\|` → `.` | `\|`는 RFC 3986 쿼리에 그대로 쓸 수 없는 문자다. `.`은 base64url 알파벳(`A-Za-z0-9-_`)에 없고 `o` 파라미터와 같은 구분자라 정규형 쿼리가 퍼센트 인코딩 없이 `A-Za-z0-9-_.=&`만으로 끝난다. 옛 구분자 `\|`는 별칭 세그먼트의 알파벳 위반이라 `BAD_NICKNAMES`로 거부한다(`nickname_pipe_separator_rejected` 벡터) | `contracts/data-format.md` §7, `prototype/gen_link_vectors.py`, `contracts/golden/link-vectors.json`(재생성, 벡터 36개 decode), `prototype/test_contracts.py`(정규형 쿼리가 안전 문자만 쓴다는 테스트 추가) |
| 추천 이유 문장은 **서버가** 한국어로 만들어 응답에 넣는다 | 웹·앱이 같은 문장을 쓰게 하려는 결정. `reasonCode`는 표현(아이콘·강조)용으로 유지 | `contracts/openapi.yaml` `Candidate.reason`(string, 필수) 추가 |

검증: `python3 -B -m unittest discover -s prototype` 18개 통과(기존 17 + 1).
**어긋나는 문서(내가 고치지 않음)**: `docs/research/tech-stack.md` 8.2의 "`|`로 이은 값", `docs/setup/s0a-notes.md` 2절의 `|` 서술은 옛 규칙이다. 원본은 `data-format.md` §7이다.

## 2. 공개 API

### `shared/links` (`app.banbanyeok.links`, 의존: `shared:schema`)

| 타입 | 설명 |
|---|---|
| `ShareLink(origins: List<StationCode>, mode: LinkMode, nicknames: List<String?>? = null)` | `/s` 링크가 담는 상태. 생성 시 규칙(2~4명, favor 위치, 별칭 개수·20자·서로게이트)을 검증하며 어기면 `IllegalArgumentException` |
| `LinkMode` | `Fair` · `Fast` · `Favor(index)` |
| `ShareLinkCodec.encodeQuery(link)` / `encodePath(link)` / `encodeUrl(siteOrigin, link)` | 정규형 인코더. 순서 `v, o, m, n`. 별칭이 없거나 전부 빈 값이면 `n` 생략 |
| `ShareLinkCodec.decodeQuery(query)` / `decodeUrl(url)` | `LinkDecoding.Success(link)` 또는 `Failure(code)`. 순서 무관, 알 수 없는 키 무시, 퍼센트 디코딩 후 해석(`+`는 공백이 아님), 오류는 첫 번째 하나만 |
| `LinkErrorCode` | `MALFORMED_QUERY` `MISSING_PARAM` `DUPLICATE_PARAM` `UNSUPPORTED_VERSION` `BAD_ORIGIN_COUNT` `BAD_STATION_CODE` `BAD_MODE` `FAVOR_INDEX_OUT_OF_RANGE` `BAD_NICKNAMES` (검사 순서 `v`→`o`→`m`→`n`) |
| `NicknameRules` | `MAX_CODE_POINTS = 20`, `codePointCount`, `isWellFormed`. app-logic이 같은 규칙을 쓴다 |
| `MapPlace(name, latitude, longitude)` | 지도 앱에 넘길 장소. 이름은 그대로 쓴다(예: "합정역") |
| `KakaoMapLinks.transitDirections(from, to)` | `MapLinks(webUrl, appUrl)` |
| `NaverMapLinks.transitDirections(from, to, appName)` | 〃. `appName`은 필수(아래 3절) |

테스트: `contracts/golden/link-vectors.json`의 encode 9개, decode 36개 전부(9개 오류 코드 모두 벡터가 있음을 확인), 코덱 단위 테스트, 지도 링크 테스트. 벡터 파일은 `banbanyeok.contract-test-data` 플러그인이 commonTest 상수로 넣는다(파일 I/O 없음).

### `shared/app-logic` (`app.banbanyeok.applogic`, 의존: `shared:schema`, `shared:links`)

| 타입 | 설명 |
|---|---|
| `ReasonInput` | 카드 한 장의 입력: `mode`, `rank`(1..3), `stationCode`, `stationName`, `people: List<PersonTime>`(사람별 `PersonRef`·초·환승), `maxSeconds`/`spreadSeconds`/`totalSeconds`, `reasonCode`, `toleranceSeconds`, `comparison`(1위는 2위, 대안은 1위), `favor: FavorContext?`, `isFairBaseline` |
| `ReasonGenerator.generate(input): String` | 문장 생성. 규칙을 어기면 `ReasonInputException(code)` |
| `ReasonInputValidator.validate(input)` / `validatePeople(people)` | 첫 오류 코드 또는 null |
| `InputErrorCode` | 14개(아래 표) |
| `SituationAdvisor.evaluate(SituationInput): List<Notice>` | 극단 상황 안내(`NoticeKind`: `NO_COMMON_CANDIDATE`, `SAME_NEIGHBORHOOD`, `LONG_TRAVEL`, `SIMILAR_CANDIDATES`). 버튼 제안(`favorIndex`, `ctaLabel`) 포함 |
| `DisplayMinutes` | `fromSeconds`(반올림), `format`(분→"1시간 4분"), `transferLabel`. **웹·앱도 같은 함수 규칙을 쓸 것** |
| `DisplayNames.resolve(people)` | 별칭 없으면 "나/친구1/친구2/친구3" |

서버(P3)가 코어 결과를 `ReasonInput`으로 옮기는 어댑터를 붙인다. 코어가 내는 `favorCaps`·`baselineStationId`·`excluded(FAVOR_CAP_EXCEEDED)`가 `FavorContext`의 `capSeconds`·`baselineTimesSeconds`·`closerStationsExcluded`로 대응한다.

### 입력 검증 오류 코드 (선언 순서 = 검사 순서, 첫 오류 하나만 보고)

| 코드 | 조건 |
|---|---|
| `PEOPLE_COUNT` | 사람이 2~4명이 아님 |
| `BLANK_PERSON_ID` | 사람 ID가 비어 있음 |
| `DUPLICATE_PERSON` | 같은 사람(ID) 중복. **같은 출발역을 두 사람이 넣는 것은 허용** |
| `NICKNAME_TOO_LONG` | 별칭이 코드포인트 20자 초과(이모지 20개는 통과, 21개는 오류) |
| `NICKNAME_MALFORMED` | 별칭에 짝 없는 서로게이트 |
| `BAD_STATION_CODE` | 출발역·추천역·비교 후보 역 코드가 3자 소문자 base32 정규형이 아님(숨긴 참가자의 출발역 null은 허용) |
| `EMPTY_STATION_NAME` | 역 이름이 비어 있음 |
| `NEGATIVE_VALUE` | 시간·환승·허용오차가 음수 |
| `RANK_OUT_OF_RANGE` | 순위가 1..3이 아님 |
| `REASON_CODE_MISMATCH` | `reasonCode`가 모드·순위와 안 맞음(1위 ↔ `*_MINIMAX/_TOTAL/_CAPPED`, 2위 이하 ↔ `*_ALTERNATIVE`) |
| `AGGREGATE_MISMATCH` | 최장·차이·합계가 사람별 시간에서 다시 계산한 값과 다름 |
| `COMPARISON_MISMATCH` | 비교 대상의 순위(1위 카드는 2, 대안은 1)·인원 수·음수 |
| `FAVOR_CONTEXT_MISSING` | favor인데 맥락이 없거나, favor가 아닌데 있음 |
| `FAVOR_CONTEXT_INVALID` | 우대 위치·배열 길이·음수 |

## 3. 지도 앱 길찾기 링크 (확인일 2026-11-12)

| 앱 | 링크 | 근거 | 상태 |
|---|---|---|---|
| 카카오맵 웹 | `https://map.kakao.com/link/by/traffic/{이름},{위도},{경도}/{이름},{위도},{경도}` | Kakao 지도 Web API 가이드 "지도 URL → 길찾기 바로가기" https://apis.map.kakao.com/web/guide/ — 이동수단 `traffic` = 대중교통, PC/모바일웹으로 자동 연결 | **공식** (직접 읽음) |
| 카카오맵 앱 | `kakaomap://route?sp={위도},{경도}&ep={위도},{경도}&by=PUBLICTRANSIT` | 공식 문서를 찾지 못했다. developers.kakao.com 카카오맵 문서는 스크립트 렌더링이라 가져오지 못했고 `.../kakaomap/url-scheme`는 404였다 | **미확인**. 형식은 널리 쓰이는 것을 기억에서 옮긴 것. 앱 쪽에서 실기기로 확인하기 전에는 보조로만 쓸 것 |
| 네이버지도 앱 | `nmap://route/public?slat=&slng=&sname=&dlat=&dlng=&dname=&appname=` | 네이버 클라우드 플랫폼 Maps "지도 앱 연결(URL Scheme)" https://guide.ncloud-docs.com/docs/maps-url-scheme, https://guide.ncloud-docs.com/docs/application-maps-url-scheme-vpc (페이지 갱신 2026-09-17). `dlat`·`dlng`만 필수, `appname`은 모든 URL에 필수(안드로이드 applicationId, iOS 번들 ID, 모바일 웹은 페이지 URL). 미설치 폴백은 문서가 안드로이드 `market://details?id=com.nhn.android.nmap`, iOS `http://itunes.apple.com/app/id311867728?mt=8`을 안내 | **공식** (에이전트가 두 페이지를 읽음. 이 문서는 "새로운 Maps"로 대체됐다고 안내하고 `stale: true`로 표시돼 있음) |
| 네이버지도 웹 | `https://map.naver.com/p/search/{도착지 이름}` | **길찾기용 웹 URL은 공식 문서에 없다.** 도착지 검색 페이지로 대신하고 사용자가 "도착"을 눌러 길찾기를 시작하게 한다 | **비공식**, 동작은 실기기·브라우저로 확인하지 못함 |

구현 규칙: 이름은 UTF-8 퍼센트 인코딩(`,` `/` 공백 포함해 unreserved 외 전부), 좌표는 소수 6자리 고정(`Double.toString` 차이와 지수 표기 방지), 위도·경도는 유한값·범위 검증. 앱 스킴은 앱이 없으면 열리지 않으므로 **웹 링크가 기본**이고 호출하는 쪽이 앱 스킴 실패 시 웹 링크로 되돌아간다.
iOS에서 `canOpenURL`을 쓰려면 `LSApplicationQueriesSchemes`에 `kakaomap`, `nmap`이 필요하다(I1에서).

## 4. 문구 규칙

### 4.1 표시 규칙 (서버·웹·앱 공통)

| 규칙 | 내용 |
|---|---|
| 초 → 분 | **0.5분(30초)은 올림**: `분 = (초 + 30) / 60`(정수 나눗셈). 29초 → 0분, 30초 → 1분 |
| 파생 값 | 합계·차이·최장은 **반올림한 사람별 분에서 다시 계산한다**. 화면의 숫자끼리 더하고 빼면 항상 맞는다(초에서 따로 반올림하면 1분씩 어긋날 수 있다. 예: 2249초·2250초는 37분·38분, 차이는 1분) |
| 순위 | 반올림 전 초로 정하고 표시만 반올림한다 |
| 60분 이상 | "1시간 4분", 정확히 60의 배수면 "2시간" |
| 환승 | 0 → "환승 없음", n → "환승 n번" |
| 이름 | 별칭이 있으면 그대로, 없으면 입력 순서대로 "나/친구1/친구2/친구3". A/B가 필요하면 호출하는 쪽이 이름으로 넣는다 |
| 조사 | 마지막으로 읽히는 글자의 받침으로 은/는·이/가·와/과를 고른다(한글, 영문 글자 이름 L·M·N·R, 숫자 0·1·3·6·7·8은 받침 있음. 끝의 기호·이모지는 건너뜀) |
| 허용오차 | 양수(반올림 후 1분 이상)이면 문장 끝에 ` (N분 동점 옵션)`. 빨리 만나기 1위의 "가장 짧아요"는 "가장 짧은 편이에요"로 누그러뜨린다 |
| 모두 0분 | 어느 모드든 "이미 같은 동네예요." |
| 한 줄 | 해요체, 문장 1~3개, 비교 대상(2위 또는 1위)을 밝힌다 |

### 4.2 문장 템플릿 (`ReasonGenerator`)

`M`=최장, `m`=최단, `D`=차이, `S`=합계(모두 표시 분). `비교`=`comparison`의 같은 값, `Δ`는 두 값의 차(표시 분). `그룹`=2명 "둘 다", 3~4명 "N명 모두". `최장자`=표시 분이 최장인 사람(여럿이면 `·`로 연결).

| 모드·순위 | 조건 | 문장 |
|---|---|---|
| 공평 1위 | 전원 같은 시간 | `{그룹} {M}이에요.` |
| | 2명 | `가장 오래 걸리는 {최장자}도 {M}이에요.` |
| | 3~4명 | `가장 오래 걸리는 {최장자}도 {M}, {N}명 모두 {m}~{M} 사이예요.` (60분 이상이면 `50분~1시간 5분`) |
| 공평 1위 + 2위 비교 | Δ최장>0 | `… 2위 {역}보다 가장 오래 걸리는 사람이 {Δ} 덜 걸려요.` |
| | Δ최장=0, Δ차이>0 | `… 2위 {역}과 최장 시간은 같지만, 시간 차이가 더 작아요 ({D} vs {비교D}).` |
| | 최장·차이 같고 Δ합계>0 | `… 2위 {역}과 최장 시간과 차이가 같고, 합계가 {Δ} 더 짧아요.` |
| | 전부 같음 | `… 2위 {역}과 거의 같아요.` |
| | Δ최장<0(허용오차로 올라온 경우) | `… 최장 시간은 2위 {역}보다 {Δ} 길지만, 시간 차이가 더 작아요 ({D} vs {비교D}).` (차이도 안 작으면 `동점 옵션 범위 안이에요.`) |
| 공평 대안 | 비교 없음 | `공평 모드 대안이에요.` |
| | 비교(1위) 있음 | `공평 모드 대안이에요. 1위 {역}보다 가장 오래 걸리는 사람이 {Δ} 더 걸려요.` + (차이가 더 작으면) ` 대신 시간 차이는 {Δ} 더 작아요.` / 최장이 같으면 `1위 {역}과 최장 시간은 같아요.` + ` 시간 차이는 {Δ} 더 작아요.` |
| 빨리 1위 | 기본 | `둘이 합쳐 {S}, 후보 중 가장 짧아요.` / 3~4명 `{N}명 모두 합쳐 {S}, …` |
| | 2명, 최장≠최단 | `… 대신 {최장자}가 {최단자}보다 {Δ} 더 걸려요.` |
| | 2명, 같음 | `… 둘 다 {M}이에요.` |
| | 3~4명 | `… 가장 오래 걸리는 {최장자}는 {M}이에요.` |
| | 공평 1위와 같은 역 | `… 가장 빠르면서 공평하기도 한 역이에요.` (위 두 줄 대신) |
| 빨리 대안 | | `빠른 만남 대안이에요.` + `1위 {역}보다 합쳐서 {Δ} 더 걸려요.` (같으면 `합계는 1위 {역}과 같아요.`) + (최장이 더 짧으면) ` 대신 가장 오래 걸리는 사람은 {Δ} 덜 걸려요.` |
| 배려 1위 | 우대 대상 | `{이름}은 {분}, 환승 없이 와요.` (환승 n번이면 `환승 n번으로 와요`) |
| | 다른 사람(2명) | `{이름}은 공평하게보다 {Δ} 더 걸려요 ({분}, 상한 +{Δ상한}).` 같으면 `공평하게 골랐을 때와 같은 {분}이에요.` |
| | 다른 사람(3~4명) | 가장 많이 맞춰 주는 사람 기준 `가장 많이 맞춰 주는 {이름}은 … 더 걸려요 (…). 나머지도 상한 안이에요.` 아무도 안 늘면 `다른 N명은 공평하게보다 더 걸리지 않아요.` |
| | 더 가까운 후보가 상한으로 빠짐 | ` {이름} 쪽에 더 가까운 역은 다른 사람 상한을 넘어서 뺐어요.` 덧붙임 |
| 배려 대안 | | `{이름} 쪽 대안이에요. 1위 {역}보다 {이름}은 {Δ} 더 걸려요 ({분}).` (덜/같음 변형 있음) |

상한 `+Δ상한`은 기준역(공평 1위) 대비 허용 증가분(표시 분)이다(알고리즘 규칙 `min(15분, 50%)`의 결과를 서버가 `capSeconds`로 넘긴다. 이 모듈은 규칙을 다시 계산하지 않는다).

### 4.3 극단 상황 (`SituationAdvisor`)

| 종류 | 조건 | 문구 |
|---|---|---|
| 공통 후보 없음 | 후보가 비어 있음 | `모두가 갈 수 있는 역을 찾지 못했어요. 출발역을 바꿔 보세요.` (product-ux에 문구가 없어 내가 정함) |
| 같은 동네 | 모두 같은 출발역(코드가 모두 있고 같음), 또는 1위 최장 ≤ 5분(300초) | `이미 같은 동네예요. {역}에서 만나세요.` ("역"이 없으면 붙임). 이 안내가 있으면 다른 안내는 내지 않음 |
| 90분 초과 | 1위 최장 > 90분(5400초, 정확히 90분은 아님) | `누군가는 90분 넘게 걸려요. 한쪽 동네에서 만나는 게 나을 수도 있어요.` + 버튼 `{가장 오래 걸리는 사람} 쪽으로 보기`(favor 모드에서는 버튼 없음) |
| 비슷한 후보 | 공평은 최장, 빨리는 합계가 1위와 2분 이내(표시 분, 후보 2~3개) | `세 곳 다 비슷해요. 가고 싶은 동네로 고르세요.` (2개면 `두 곳`). 배려 모드는 판단하지 않음 |

## 5. 결정 필요

1. **카카오맵 앱 스킴(`kakaomap://route…`)을 공식 문서로 확인하지 못했다.** 앱 개발(A1/I1)에서 실기기로 확인하거나 앱 스킴을 빼고 웹 링크만 쓸지 정해 달라. 웹 링크는 공식이다.
2. **네이버지도 길찾기용 웹 URL은 공식 문서에 없다.** 지금은 도착지 검색 URL(비공식)로 대신한다. 브라우저에서 확인한 뒤 길찾기 URL로 바꿀지(좌표계 등을 확인해야 함) 결정이 필요하다. 네이버 앱 스킴의 `appname` 값(웹은 페이지 URL, 앱은 번들 ID)도 정해야 한다.
3. **반올림 규칙(30초는 올림, 파생 값은 반올림한 분에서 재계산)** 을 웹·앱의 카드 숫자(막대 옆 분, 접힌 카드의 "최장·차이")가 똑같이 따라야 한다. 웹/앱 작업(P4 등)에 `DisplayMinutes`와 같은 규칙을 지시할 것.
4. **기본 이름이 "나/친구1…"이다**(data-format §7의 표시 규칙). 서버가 방 참가자에게 A/B를 쓰고 싶으면 이름을 직접 넣어야 한다. 같은 별칭이 둘 이상이면(링크 규칙상 허용) 문장이 모호해질 수 있다. 막지는 않았다.
5. **"같은 동네" 임계값 5분, "비슷하다" 임계값 2분은 제안값이다.** product-ux에는 "아주 가까운 역", "1~2분"이라고만 돼 있다. 빨리 모드의 "비슷하다"는 합계(사람·분)가 2분 이내라 인원이 많을수록 엄격하다.
6. **공통 후보 없음 문구는 내가 정했다**(product-ux에 문구가 없음). 환승이 갈린 경우 문구("합정과 시간은 같고, 둘 다 환승 1번 이하예요")와 막차 문구는 순위가 환승·막차를 쓰지 않으므로(알고리즘 규칙) 넣지 않았다.
7. **`reason`을 `required`로 넣었다.** 서버 구현(P3)이 모든 후보에 문장을 넣어야 한다. 선택 필드로 두려면 openapi를 고치면 된다.
8. `docs/research/tech-stack.md` 8.2, `docs/setup/s0a-notes.md`의 `|` 서술은 옛 규칙이다(코디네이터가 문서 정리 시 반영).

## 6. 알아 둘 점 / 한계

- 코어(P1)와 맞붙여 본 적은 없다. 어댑터는 서버(P3)의 몫이고, 그때 코어의 반올림 전 초 값과 이 모듈의 `AGGREGATE_MISMATCH` 검사가 맞는지 확인해야 한다.
- 별칭은 `NicknameRules`가 코드포인트로 센다. 결합 문자가 붙은 글자(예: 이모지 + 피부색)는 코드포인트 2개로 센다(서기소 클러스터가 아님). TS 구현도 같은 규칙이어야 한다(벡터에는 이모지 20개 케이스만 있음).
- 문구는 스냅샷 테스트(33개)로 고정했다. 문구를 바꾸면 테스트가 깨지고, 이 문서의 표와 함께 고쳐야 한다.
- js 타깃이 꺼져 있어 `jvmTest`만 돈다. 코드는 commonMain 순수 Kotlin이라 android·ios 타깃이 켜지면 같은 테스트가 돈다(`checkCommonMainPurity` 통과). `CharacterCodingException`은 common stdlib 타입이다.
