# 데이터 형식 계약 (data-format) — 2판

2판 · 2026-11-16(T2: 구분별 od 행렬, manifest 2세대, 공유 링크 v=2, §9 구분) · 1판 2026-11-12 · 소유: S0a(이후 형식 변경은 `schemaVersion`을 올리고 이 문서와 `shared/schema`, `prototype/gen_fixtures.py`를 같이 고친다)

이 문서는 파이프라인(쓰는 쪽)과 서버·앱·웹 SEO 빌드(읽는 쪽)가 공유하는 산출물 형식이다. 웹 앱은 추천을 직접 계산하지 않고 서버 API를 호출하므로 `od.bin`을 읽지 않는다. 웹-서버 계약의 원본은 [`openapi.yaml`](openapi.yaml)이다(contract-first, 웹은 이 파일에서 TS 타입을 생성한다). 이 문서의 §7(링크 코덱)은 웹·공유 모듈·앱이 각자 구현하는 유일한 로직이라 테스트 벡터로 일치를 검증한다. 구현은 `shared/schema`(Kotlin)이고, `prototype/gen_fixtures.py`가 **독립 구현**으로 같은 형식의 샘플을 만든다. 둘이 어긋나면 `shared/schema`의 테스트가 깨진다.

규칙 어휘: **반드시**(MUST) / **하면 안 된다**(MUST NOT)는 reader가 거부해야 하는 위반이다.

## 1. 한눈에 보기

| 산출물 | 위치(git / 발행) | 형식 | 누가 쓰나 |
|---|---|---|---|
| 역 레지스트리 | `data/registry/stations.json` | JSON, append-only | 사람 + P2 (git) |
| 후보 목록 | `data/registry/candidates.json` | JSON | 사람 + P2 (git) |
| 시간·환승 행렬 | `versions/<dataVersion>/od.<hash>.bin` | 바이너리 | 파이프라인 |
| 구분별 시간·환승 행렬 | `versions/<dataVersion>/od-<구분>.<hash>.bin` | 바이너리(od.bin과 같은 형식) | 파이프라인 |
| manifest | `manifest.json`(세대 1) + `manifest.v2.json`(세대 2) (발행 포인터) | JSON | 파이프라인 (`manifest.json`을 마지막에 교체) |

형식 판은 두 가지다. **구성 형식**(레지스트리 JSON·후보 JSON의 `schemaVersion`, od.bin 헤더의 `formatVersion`)은 `1`이고,
**manifest 세대**(`manifest.schemaVersion`)는 `1` 또는 `2`다. 세대 2는 구분(§9)별 od 행렬(`files.odSlots`)을 더한 것이고 구성 형식은
그대로 1판이다(레지스트리·웹 역 인덱스를 다시 만들 이유가 없어서 구성 형식은 올리지 않았다). reader는 자기가 아는 manifest 세대 안에서
각 세대의 구성 형식 판을 검사한다: 세대 1·2 모두 레지스트리·후보·od.bin이 1판이어야 한다.

## 2. 역 코드

- **3자, ASCII, 소문자·숫자 base32.** 알파벳(32자, Crockford에서 `i l o u` 제외):
  `0123456789abcdefghjkmnpqrstvwxyz`
- 코드 값(`codeValue`): 각 글자를 알파벳 위치(0..31)로 읽어 5비트씩 이어 붙인 15비트 정수.
  `value = c0·1024 + c1·32 + c2`, 범위 `0..32767`(= 32³ − 1).
  예: `"03v"` → 0·1024 + 3·32 + 27 = 123.
- **코드의 문자열 사전순(ASCII) = 코드 값 오름차순.** 알파벳이 ASCII 코드 순으로 정렬돼 있어 항상 성립한다(`0..9` < `a..z`).
  그래서 JVM·TypeScript·Python의 정렬 차이가 생기지 않는다.
- reader는 **소문자 정규형만** 받는다. `O→0` 같은 혼동 문자 치환이나 대문자 허용은 링크 계층(P6)의 선택이며, 레지스트리와 od.bin은 정규형만 가진다. 허용하지 않는 코드는 오류다.
- **안정 ID = 코드.** 한 번 발급된 코드는 같은 물리 역을 영구히 가리킨다. 재사용하지 않고 삭제하지 않는다(§3).
  발급 방법(P2): 암호학적 난수로 미사용 코드를 뽑아 `stations.json`에 기록한다. 역 이름·좌표에서 계산하지 않는다(개명·이전에 영향받지 않게).
  인접 코드가 비슷한 역이 되지 않도록 순차 발급은 쓰지 않는다.
- 단위는 **환승역을 묶은 물리 역**이다(`docs/research/algorithm.md`의 공통 역 ID). 기관별 코드는 `sources`에만 둔다.

## 3. 레지스트리 `stations.json`

```json
{
  "schemaVersion": 1,
  "registryVersion": 1,
  "stations": [
    {
      "code": "03v",
      "name": "B1",
      "status": "active",
      "lat": 37.5,
      "lng": 127.0,
      "lines": ["blue"],
      "aliases": [],
      "sources": {"fixture": "B1"},
      "addedIn": 1
    }
  ]
}
```

| 필드 | 형 | 규칙 |
|---|---|---|
| `schemaVersion` | 정수 | 반드시 reader가 지원하는 값 |
| `registryVersion` | 정수 ≥ 1 | 내용이 바뀔 때마다 1씩 증가. od.bin 헤더·manifest가 같은 값을 가진다 |
| `stations[].code` | 문자열 | §2 정규형. 파일 안에서 유일. **`stations`는 `code` 오름차순**이어야 한다 |
| `name` | 문자열 | 비어 있으면 안 된다. 현재 표시 이름 |
| `status` | `"active"` \| `"deprecated"` | 폐역·통합은 삭제하지 않고 `deprecated` |
| `lat`, `lng` | 수 | 십진 도(WGS84). 소수 6자리까지 쓴다 |
| `lines` | 문자열 배열 | 지나는 노선 표시명. 순서는 임의지만 결정적(정렬)으로 쓴다 |
| `aliases` | 문자열 배열 | 옛 이름·별칭. 검색에 쓴다 |
| `sources` | 문자열→문자열 객체 | 기관별 코드(`kric:<기관>:<노선>`, `seoul:…`, `tago:<TAGO 노선명>`, S1에 없는 역의 좌표 출처 `wikidata`, …). 값은 불투명 문자열 |
| `addedIn` | 정수 | 처음 들어간 `registryVersion` |
| `deprecatedIn` | 정수, 선택 | `status=deprecated`일 때만 |
| `replacedBy` | 코드, 선택 | 이 역을 대체하는 코드. 레지스트리에 존재해야 한다. 소비자(서버·웹 역 인덱스)는 사슬을 따라 `active` 코드까지 가서 그 코드로 계산·표시한다(순환·끊긴 사슬은 파이프라인 게이트가 거부한다) |

**append-only 규칙** (옛 링크 보존, `RegistryCompatibility`와 CI가 검사):
이전 `main`의 레지스트리에 있던 코드는 새 레지스트리에도 있어야 한다. 코드는 같은 `addedIn`을 유지하고, `status`는 `active → deprecated`로만 바뀐다(되돌림 금지). `registryVersion`은 줄어들지 않는다.
내용이 바뀌었는데 `registryVersion`이 그대로면 위반이다(파이프라인이 증가시킨다).

### 후보 목록 `candidates.json`

```json
{"schemaVersion": 1, "registryVersion": 1, "candidates": ["0aj", "…"]}
```

추천 가능한 만남 후보역. 코드 오름차순, 중복 없음, 모두 레지스트리에 `active`로 있어야 한다(`CandidateList.validateAgainst`). od.bin의 후보 축(§4)과 **같은 집합·같은 순서**여야 한다.

## 4. `od.bin` — 출발역 N × 후보 M 행렬

- **리틀 엔디언.** 모든 다바이트 정수는 하위 바이트가 먼저. 부호 없음(u8/u16/u32/u64).
- 시간은 **정수 초**. 환승은 정수 횟수. 두 값은 같은 최단 경로의 것이다(시간 동률일 때 최소 환승, `algorithm.md`).
- 경로 도달 불가: 시간 `0xFFFF`와 환승 `0xFF`를 **같은 칸에 함께** 쓴다. 한쪽만이면 오류.
- 대각(출발역 = 후보역)은 시간 0, 환승 0이어야 한다(파이프라인 검증 게이트의 불변식. reader는 강제하지 않음).

### 4.1 헤더 (고정 32바이트)

| 오프셋 | 크기 | 필드 | 값 / 규칙 |
|---|---|---|---|
| 0 | 4 | `magic` | ASCII `BBOD` |
| 4 | 2 | `formatVersion` | u16, 지금 `1`(구성 형식 판, §1) |
| 6 | 2 | `headerSize` | u16, 지금 `32`. 이후 버전에서 헤더가 커지면 reader가 건너뛴다 |
| 8 | 4 | `flags` | u32, 지금 `0`. 0이 아니면 거부 |
| 12 | 4 | `registryVersion` | u32. 이 행렬이 만들어진 레지스트리 버전 |
| 16 | 4 | `originCount` N | u32 |
| 20 | 4 | `candidateCount` M | u32 |
| 24 | 8 | `reserved` | u64, `0`이어야 한다 |

### 4.2 본문 (헤더 바로 뒤, 패딩 없음, 이 순서)

| 구간 | 크기 | 내용 |
|---|---|---|
| 출발역 코드 | 2·N | u16 `codeValue`, **엄격한 오름차순**(중복 없음), 값 < 32768 |
| 후보역 코드 | 2·M | 같은 규칙 |
| 시간 | 2·N·M | u16 초, 행 우선(row = 출발역 인덱스, col = 후보 인덱스). `0xFFFF` = 도달 불가 |
| 환승 | N·M | u8, 같은 배치. `0xFF` = 도달 불가 |

총 길이는 정확히 `headerSize + 2N + 2M + 2NM + NM`바이트다. 짧거나 길면 거부한다(잘림·이어붙임 방지).
시간의 최댓값은 `65534`초(약 18시간 11분)다. writer는 이를 넘으면 거부한다. 더 크게 필요하면 `formatVersion`을 올려 u32로 바꾼다.
환승의 최댓값은 `254`다.

코드 축은 od.bin 자체가 가지므로 **레지스트리의 순서와 무관하게 읽을 수 있고**, 출발역은 이진 탐색으로 인덱스를 찾는다. 후보 인덱스도 같다.

### 4.3 결정성과 해시 규칙

- 같은 입력이면 **바이트가 같아야 한다**(코드 정렬, 고정 헤더, 시간 기록·무작위 없음). 생성 시각은 manifest에만 둔다.
- 해시: **SHA-256**, 파일 전체 바이트에 대해, 소문자 16진수 64자. 정규화(줄바꿈·공백 변환)는 하지 않는다.
- 발행 파일 이름은 `<종류>.<해시 앞 16자>.<확장자>`(예: `od.19cc73e7f8df1451.bin`). 내용이 같으면 이름이 같고, 이름이 같으면 내용이 같으므로 `Cache-Control: immutable`로 내보낼 수 있다.

## 5. `manifest.json`

```json
{
  "schemaVersion": 1,
  "minClientSchema": 1,
  "dataVersion": "20261112.1",
  "generatedAt": "2026-11-12T00:00:00Z",
  "registryVersion": 1,
  "timeModel": "fixture-v1",
  "originCount": 18,
  "candidateCount": 6,
  "files": {
    "registry":   {"path": "versions/20261112.1/stations.9bf91ec4c8a5cb93.json", "sha256": "…64자…", "bytes": 4674},
    "candidates": {"path": "versions/20261112.1/candidates.27d2a047085a8741.json", "sha256": "…", "bytes": 137},
    "od":         {"path": "versions/20261112.1/od.19cc73e7f8df1451.bin", "sha256": "…", "bytes": 404}
  }
}
```

| 필드 | 규칙 |
|---|---|
| `schemaVersion` | manifest 세대(§1). `1` 또는 `2`. 구성 형식(레지스트리·후보 `schemaVersion`, od.bin `formatVersion`)은 두 세대 모두 `1` |
| `minClientSchema` | 이 데이터를 읽을 수 있는 클라이언트의 **최소 지원 세대**. 클라이언트가 지원하는 최댓값 < `minClientSchema`이면 데이터를 쓰지 말고 업데이트를 안내한다. `≤ schemaVersion`. 파이프라인은 세대 2에 `2`를 쓴다 |
| `dataVersion` | `YYYYMMDD.N`(N ≥ 1, 같은 날 N번째 발행). 정규식 `^[0-9]{8}\.[0-9]{1,3}$`. 방(room)이 이 값을 기록해 두 계산이 어긋나지 않게 한다 |
| `previousDataVersion` | 선택. 직전 정상 버전(롤백 안내용). 첫 발행이면 키를 생략한다 |
| `generatedAt` | UTC ISO-8601, `Z`로 끝남 |
| `registryVersion` | 위 레지스트리·후보·od.bin 헤더의 값과 모두 같아야 한다 |
| `timeModel` | 시간 행렬에 포함한 것의 식별자(예: 주행+환승 보행+평균 대기). 모델이 바뀌면 값이 바뀐다. 내용은 `data/` 문서에 둔다 |
| `originCount`, `candidateCount` | od.bin의 N, M과 같아야 한다 |
| `files.registry`, `files.candidates`, `files.od` | 필수. `path`는 manifest 기준 상대 경로(`..`·절대 경로 금지), `sha256`은 §4.3, `bytes`는 정확한 크기. `files.od`는 **기본 구분(평일 낮, `weekday-day`)** 의 행렬이다 |
| `files.seoPages` | 선택. 같은 모양 |
| `files.odSlots` | 세대 2에서 필수, 세대 1에는 없어야 한다. 키는 구분 id(§9)이고 기본 구분을 **뺀** 11개가 빠짐없이 있어야 한다. 값은 `files.od`와 같은 모양. 모든 구분 행렬은 `files.od`와 **같은 출발역·후보 축**이고 같은 `registryVersion`이다. 내용이 같은 구분(예: 토요일과 일요일·공휴일)은 한 파일을 함께 가리킬 수 있다 — 같은 `path`를 가리키는 항목은 `sha256`·`bytes`도 같아야 한다 |

**검증 순서** (서버가 새 버전을 받을 때, 실패하면 직전 정상 버전 유지):
① manifest 파싱·필드 검사 → ② `schemaVersion`/`minClientSchema` 지원 확인 → ③ 각 파일의 `bytes`와 `sha256` 대조 → ④ od.bin 헤더·길이·코드 오름차순 → ⑤ N, M, `registryVersion` 상호 일치 → ⑥ 후보 목록 ≡ od.bin 후보 축, 모든 od.bin 코드가 레지스트리에 존재 → ⑦ 구분 행렬마다 ③④와 `files.od`와 같은 축·`registryVersion` → ⑧ (서버만) 골든 샘플.
서버는 ①~⑥을 마치면 기동하고 ⑦은 뒤에서 한다(콜드스타트). ⑦이 끝나기 전에 온 구분 요청은 잠깐 기다리고, ⑦이 실패하면 그 서버는
기본 구분으로만 계산한다(응답의 `timeBasis`가 평일 낮이 되어 사용자에게 드러난다).
manifest 자체는 **발행의 마지막 단계에 한 번에 교체**한다(10.3).

**세대별 객체 이름.** 발행은 manifest를 두 개 쓴다. `manifest.v2.json`은 세대 2(구분 행렬 포함), `manifest.json`은 같은 dataVersion·같은 파일의
세대 1(`files.odSlots` 없음, `timeModel` = `weekday-offpeak-half-headway`)이다. 그래서 세대 2를 모르는 옛 서버(배포 틈의 옛 리비전, 되돌리기)도
계속 기동한다. 순서는 해시 파일 → `manifest.v2.json` → `manifest.json`(마지막). 세대 2를 아는 reader는 둘을 읽어 dataVersion이 같으면 세대 2를,
다르거나 세대 2가 없으면 세대 1을 쓴다(옛 스크립트로 되돌려 `manifest.json`만 바뀐 경우 지난 세대 2를 쓰지 않게). 세대 1만 있는 데이터를 발행할
때는 남은 `manifest.v2.json`을 지운다. dev 산출물(`data/artifacts/dev/`)도 같은 두 파일을 둔다.

## 6. 호환 규칙

- 필드 **추가**(JSON): `schemaVersion`을 올리지 않고 reader가 모르는 필드를 무시하는 것은 허용하지 않는다. 우리는 reader를 엄격하게 둔다(알 수 없는 키 = 오류). 새 필드가 필요하면 `schemaVersion`을 올린다.
- 형식 변경은 `schemaVersion` 증가 + `minClientSchema` 조정으로 구세대 클라이언트를 안전하게 막는다.
- od.bin의 헤더 확장은 `headerSize`로, 본문 형식 변경은 `formatVersion`으로 알린다.
- 이 폴더의 샘플(`contracts/fixtures/`)은 장난감 노선도(역 18개, 후보 6개)로 만든 것이며 실제 역·시간이 아니다.

## 7. 공유 URL 링크 코덱 (`/s`)

혼자 입력해 URL로 공유하는 흐름(서버 저장 없음)의 상태 표현이다. 웹(TypeScript), `shared/links`(Kotlin), 앱이 **각자 구현**하므로 아래 규칙과 테스트 벡터 [`golden/link-vectors.json`](golden/link-vectors.json)이 일치의 기준이다. 기준 구현은 `prototype/gen_link_vectors.py`(벡터 생성기), 새 구현은 벡터 파일의 `encode`/`decode` 항목을 모두 통과해야 한다.

형태: `/s?v=2&o=03v.130&m=f&t=weekday-day&n=<별칭>`. 정규형 쿼리는 `A-Za-z0-9-_.=&` 문자만 쓰므로 퍼센트 인코딩이 필요 없다(RFC 3986 쿼리의 unreserved 문자 + `=`, `&`). 방 링크 `/r/{roomId}`는 이 코덱의 대상이 아니다(토큰·개인 식별자는 어떤 URL에도 넣지 않는다).

| 파라미터 | 규칙 |
|---|---|
| `v` | URL 스키마 버전(데이터 버전이 아님). 지금 `2`. 구분이 생기기 전의 옛 링크 `1`도 읽는다(아래). 그 밖의 값은 `UNSUPPORTED_VERSION` |
| `o` | 출발역 코드(§2 정규형)를 `.`으로 연결, 입력 순서 = A, B, C, D. **2~4개**(`BAD_ORIGIN_COUNT`), 모든 코드가 유효(`BAD_STATION_CODE`). 같은 코드가 반복돼도 된다 |
| `m` | `f` 공평, `q` 빨리, `p<i>` 배려(`i`는 `o` 안의 0부터 시작하는 위치, 한 자리). 그 외는 `BAD_MODE`, 범위 밖은 `FAVOR_INDEX_OUT_OF_RANGE` |
| `t` | `v=2`에서 필수(없으면 `MISSING_PARAM`). 구분 id(§9, 예 `saturday-night`). 대소문자 구분, 목록에 없으면 `BAD_TIME_SLOT`. `v=1` 링크에는 `t`가 없고, 있어도 알 수 없는 키처럼 무시하며 **평일 낮(`weekday-day`)** 으로 읽는다 — 옛 공유 링크는 계속 같은 결과(평일 낮)다 |
| `n` | 선택. 별칭 목록: 각 별칭을 UTF-8로 인코딩해 **base64url(패딩 `=` 없음, `-`와 `_`)** 로 쓰고 `.`으로 잇는다(`.`은 base64url 알파벳에 없고 `o`와 같은 구분자다. `|`는 RFC 3986 쿼리에서 그대로 쓸 수 없어 쓰지 않는다). 세그먼트 수는 `o`의 개수와 같아야 하며 별칭이 없는 사람은 빈 세그먼트. 별칭은 **유니코드 코드포인트 20자 이하**(UTF-16 길이가 아님). 별칭이 하나도 없으면 `n`을 **생략**한다(`n=.`는 비정규라 `BAD_NICKNAMES`). 정규형이 아닌 base64(패딩, 표준 알파벳, 남는 비트가 0이 아님)와 잘못된 UTF-8도 `BAD_NICKNAMES` |

**인코더(정규형)**: 언제나 `v=2`이고 `t`를 늘 쓴다(평일 낮이어도). 파라미터 순서 `v, o, m, t, n`, 소문자 코드, 퍼센트 인코딩 없이 `.`을 그대로 쓴다.
**디코더**: 순서 무관, **알 수 없는 키는 무시**(유입 추적용 `utm_*` 등), 값은 먼저 퍼센트 디코딩한 뒤 해석한다(`%2E`도 받는다. 옛 구분자 `|`는 별칭 세그먼트에서 base64url 알파벳 위반이므로 `BAD_NICKNAMES`). 잘못된 퍼센트 이스케이프나 UTF-8은 `MALFORMED_QUERY`. 필수 키(`v`,`o`,`m`) 누락은 `MISSING_PARAM`, 같은 키가 두 번이면 `DUPLICATE_PARAM`. 오류는 하나만 보고하며 검사 순서는 위 표의 `v`→`o`→`m`→`t`→`n` 순이다.
**별칭이 없는 링크가 기본**이다. 화면의 사람 이름은 §8 규칙으로 서버가 만든다(별칭이 없으면 "{출발역}에서 오는 분"). 링크의 `o`에 폐기된(`deprecated`) 코드가 있으면 서버와 웹 역 인덱스가 `replacedBy`를 따라 정식 코드로 읽으므로 옛 링크도 열린다.

벡터 예시 (전체는 JSON):

| id | 쿼리 | 의미 |
|---|---|---|
| `fair_two` | `v=2&o=03v.130&m=f&t=weekday-day` | 두 사람, 공평, 평일 낮 |
| `saturday_night` | `v=2&o=03v.130&m=f&t=saturday-night` | 토요일 밤 |
| `favor_second_of_four` | `v=2&o=03v.130.225.31a&m=p1&t=weekday-day` | 네 사람, 두 번째 사람 배려 |
| `nicknames_korean` | `v=2&o=03v.130&m=f&t=weekday-day&n=66-87IiY.7KeA7Jew` | 별칭 "민수", "지연" |
| `legacy_v1_is_weekday_day` | `v=1&o=03v.130&m=f` | 옛 링크: 평일 낮 |
| `nickname_emoji_20_code_points` | `…&n=8J-ZgvCf…` | 이모지 20개 = 20자(UTF-16으로는 40) |
| `uppercase_code_rejected` | `v=1&o=03V.130&m=f` | `BAD_STATION_CODE` |
| `favor_index_out_of_range` | `v=1&o=03v.130&m=p2` | `FAVOR_INDEX_OUT_OF_RANGE` |
| `bad_time_slot` | `v=2&o=03v.130&m=f&t=sunday-dawn` | `BAD_TIME_SLOT` |

벡터 JSON 형식(2판): `encode[]`는 `{id, input:{origins, mode, favorIndex, nicknames, timeSlot}, expectedQuery}`, `decode[]`는 `{id, query, expected:{origins, mode, favorIndex, nicknames, timeSlot}}` 또는 `{id, query, expectedError}`. `nicknames`는 `null`(별칭 없음) 또는 길이가 `origins`와 같은 배열(빈 별칭은 `null`).

## 8. 참가자 표시 이름 (`label`, `shortLabel`)

화면과 추천 이유 문장에서 사람을 부르는 이름이다. **서버가 만들어** 응답의 `participants[].label`·`labelKind`·`shortLabel`에 넣고, 웹·앱은 다시 만들지 않고 그대로 쓴다. 구현은 `shared/app-logic`의 `ParticipantLabels` 한 곳이며(파이프라인의 SEO 문장도 같은 구현을 쓴다), 벡터 [`golden/display-labels.json`](golden/display-labels.json)이 기준이다.

참가자 목록의 순서(`/recommend`는 입력 순서, 방은 참여 순서)대로 한 사람씩 정한다.

| 순서 | 조건 | `label` | `labelKind` | `shortLabel` |
|---|---|---|---|---|
| 1 | 사람이 이름(별칭)을 넣었다(앞뒤 공백을 빼고 비어 있지 않음) | 그 이름(앞뒤 공백 제거, 나머지는 그대로. 이모지 포함). 같은 이름이면 입력 순서대로 ` 1`, ` 2`, …를 붙인다 | `name` | `label`과 같다 |
| 2 | 이름이 없고 출발역이 보인다 | `{출발역 이름}에서 오는 분`. 이 규칙을 쓰는 사람 중 같은 출발역 이름이 둘 이상이면 입력 순서대로 ` 1`, ` 2`, …를 붙인다 | `origin` | `{출발역 이름}`(번호는 같게, 예 `강남 2`) |
| 3 | 이름이 없고 출발역을 숨겼다(또는 출발역 이름을 모른다) | `참가자 {목록 안 순번}`(1부터) | `ordinal` | `label`과 같다 |

- **어디에 무엇을**: `label`은 문장(추천 이유, 극단 상황 문구)에, `shortLabel`은 좁은 칸(결과 카드의 시간 행, 배려할 사람을 고르는 알약, 미리보기 그림, 미리보기 설명·공유 문구의 시간 나열)에 쓴다. 입력한 것이 출발역이라 칸 안의 "홍대입구"는 맥락상 사람으로 읽힌다(V1, docs/setup/v1-notes.md).

- **번호 세기**: 2번 규칙의 번호는 2번 규칙을 쓰는 사람끼리만 센다. 이름을 넣은 사람과 숨긴 사람은 세지 않는다(숨긴 사람이 같은 역에서 온다는 사실이 번호로 드러나지 않게).
- **보는 사람과 무관**: 같은 방이면 누가 보든 같은 값이다. 출발역을 숨긴 사람은 본인이 볼 때도 `참가자 N`이다.
- **쓰지 않는 것**: 익명 사용자 ID, 참가자 ID, 토큰 같은 내부 식별자(여러 방에 걸쳐 같은 사람을 이어 볼 수 있게 되므로). "나/너/친구1" 같은 시점 표현. 보는 사람 표시 "(나)"는 클라이언트가 자기 화면에서만 붙인다.
- 이름 번호는 앞뒤 공백 제거 후 같은 이름끼리만 센다. 숨긴 사람도 이름을 넣었으면 포함하고, 출발역 번호와는 별도로 센다. 입력 화면의 "나/친구1" 같은 문구는 입력 칸 안내(placeholder)일 뿐 이름이 아니다.

벡터 JSON 형식(2판): `vectors[]`는 `{id, people:[{name, originName, hidden}], expected:[{label, kind, shortLabel}], note?}`. `name`이 `null`이면 이름 없음, `hidden=true`이면 `originName`을 알아도 쓰지 않는다.

## 9. 구분: 요일 유형 × 시간대 ("언제 만나요?")

시간 행렬은 구분마다 하나다. 배차가 요일·시간대마다 달라서 탑승·환승 대기(배차/2)가 바뀌기 때문이다. 주행·환승 보행 시간은 모든 구분에서
같다(평일 시간표로 추정). 정의 원본은 [`time-slots.json`](time-slots.json)이고 파이프라인(배차 창·원천 코드), 서버(약속 날짜·시각 →
구분, 표시 문구), 웹(입력 칩·지금 시각 기본값)이 같은 정의를 쓴다. 파일 안의 `vectors`로 서버(Kotlin)와 웹(TS)이 같은 답을 내는지 검사한다.

- **구분 id** = `{요일 유형}-{시간대}`. 요일 유형: `weekday`(평일) · `saturday`(토요일) · `holiday`(일요일·공휴일). 시간대: `morning`(아침,
  ~10시) · `day`(낮, 10~17시) · `evening`(저녁, 17~21시) · `night`(밤, 21시~). 12개. **기본 구분은 `weekday-day`**(평일 낮)이며 T2 이전의
  유일한 기준과 같은 값이다.
- **날짜·시각 → 구분**(방): 시각이 `[from, to)`에 들면 그 시간대(밤은 21:00~다음 날 03:00). 03:00 전의 시각은 **전날 운행일**의 밤이다.
  요일 유형은 운행일로 정한다: 공휴일이거나 일요일 → `holiday`, 토요일 → `saturday`, 그 밖 → `weekday`. 시각이 없으면 낮, 날짜가 없으면 평일.
- **시간대만 고른 방**(`meetingBand`, 시각 없음): 그 시간대이고 운행일은 날짜 그대로다(토요일 밤을 고르면 토요일 밤). 화면에 없는 시각을
  만들어 저장하지 않으려는 것이다. 시각이 있으면 시간대는 시각에서 나오고 서버는 시간대를 따로 저장하지 않는다(함께 온 값이 다르면 400).
- **공휴일**: [`holidays.json`](holidays.json)(관공서 공휴일과 대체공휴일, 출처 포함). 연 1회 갱신한다(우주항공청이 매년 6월 말 다음 해
  월력요항을 발표하면 그 해를 더하고 `coverage.to`를 늘린다. 임시공휴일은 국무회의 의결 뒤). 목록 범위 밖의 날짜는 일요일만 공휴일로 본다.
  서버 테스트는 범위가 끝나기 두 달 전부터 경고를 남긴다(벽시계로 CI를 깨뜨리지 않는다). 외부 키가 필요한 공휴일 API는 쓰지 않는다.
- **배차를 재는 창**(`headwayWindow`, 출발 시각, 양끝 포함): 아침 07~10시, 낮 10~16시(P2b의 평시 창 그대로라 평일 낮 행렬은 T2 전과 바이트가
  같다), 저녁 17~21시, 밤 21~24시. 근거와 측정은 docs/setup/t2-notes.md.
- **표시**: 결과 응답의 `timeBasis.label`("토요일 저녁")을 서버가 만들고 클라이언트는 그대로 쓴다(openapi `TimeBasis`).

