# W2 작업 노트 — 참가자 표시 이름 규칙 + 웹·서버 실제 연결

검증일: 2026-11-14. main(P2c #10, P5 #12, T1 #13 병합 후) 위에서 작업했다.

## 1. 무엇이 문제였나

웹은 이름이 없으면 "나/친구1", 서버 문장은 "A/B"를 써서 서로 어긋났고, 받은 링크에서 보는 사람이 바뀌면 "나"가 다른 사람을
가리켰다. 사용자·코디네이터가 확정한 규칙을 Kotlin 한 곳(`shared/app-logic` `ParticipantLabels`)에 구현하고, 서버가 응답에
넣은 `label`을 웹이 그대로 쓰게 했다. 규칙 원문: contracts/data-format.md §8, 벡터: contracts/golden/display-labels.json(16개).

| 순서 | 조건 | label | labelKind |
|---|---|---|---|
| 1 | 이름(별칭)을 넣었다 | 그 이름(앞뒤 공백 제거) | `name` |
| 2 | 이름 없음, 출발역이 보임 | "{출발역}에서 오는 분", 같은 역 여럿이면 입력 순서대로 " 1", " 2" | `origin` |
| 3 | 이름 없음, 출발역 숨김 | "참가자 {방 안 순번}" | `ordinal` |

## 2. 해석해서 정한 것 (규칙을 바꾸지 않는 범위)

- **"출발역을 숨긴 방의 참가자"는 참가자 단위로 읽었다.** 숨김은 참가자별 설정(`hidden`)이라, 숨긴 사람만 "참가자 N"이고 같은 방의 숨기지 않은 사람은 2번 규칙을 쓴다. 숨긴 사람의 출발역은 어디에도 드러나지 않는다.
- **같은 역 번호는 2번 규칙을 쓰는 사람끼리만 센다.** 숨긴 사람을 세면 "강남에서 오는 분 1"만 보여도 숨긴 사람이 강남에서 온다는 게 드러난다. 이름을 넣은 사람도 세지 않는다.
- **같은 역은 "역 이름"으로 판단한다.** 코드가 달라도 이름이 같은 역(예: 신촌 2호선/경의중앙)은 화면에서 구별이 안 되므로 번호를 붙인다.
- **본인이 숨겼어도 본인에게 "참가자 N"이다.** label은 보는 사람과 무관하게 같은 값이다(문장과 응답이 항상 일치).
- 출발역 이름을 모르는 경우(레지스트리에 없음)는 숨김과 같이 3번 규칙.
- `/recommend`는 입력 순서, 방은 참여 순서. 참가자가 나가면 순번이 다시 매겨진다.

## 3. 변경

**계약** — `Participant.label`·`labelKind`(필수 응답 필드 추가, 요청은 그대로). `/recommend` `nicknames` 설명(넣은 사람만, 아무도 없으면 생략), `Candidate.reason` 설명(A/B 규칙 삭제 → label과 같은 이름), 폐기 코드 처리 설명. data-format §3(replacedBy 소비 규칙), §7(화면 이름 문구 정정), §8(신설).

**shared/app-logic** — `ParticipantLabels`/`ParticipantLabel`/`LabelKind` 추가, `DisplayNames` 삭제. `PersonRef`에 `originName`(숨긴 사람은 null) 추가. `ReasonGenerator`·`SituationAdvisor`가 label을 쓴다. 벡터 테스트(`DisplayLabelVectorsTest`)는 contract-test-data 플러그인으로 golden 파일을 읽는다.

**server** — `SentenceNames`(A/B, "민수(A)") 삭제. `RecommendationService`가 label을 만들어 `Recommendation.labels`로 돌려주고 문장도 같은 입력으로 만든다(결과 응답의 label = 문장의 이름). 방 조회·수정 응답은 방 전체로 label을 계산한다(PUT 참가자 응답도 방을 다시 읽어 순번이 맞다). 숨긴 참가자는 출발역 코드·이름을 문장 입력에 넘기지 않는다.

**폐기된 역 코드(P2c 후속)** — `StationDirectory.canonical`이 replacedBy 사슬을 active 코드까지 따라간다(레지스트리 크기만큼만). `/recommend`는 계산 전에 바꾸고 응답에도 정식 코드를 싣는다. 방은 `StationCatalog.canonical`로 저장 전에 바꾸고, 이미 저장된 옛 코드도 결과 계산·조회 때 바꾼다. 웹 역 인덱스에 `replaced`(40개: 옛 코드 → 정식 코드)를 넣어 `stationByCode`가 옛 코드도 찾는다(기억해 둔 "나" 역 포함).

**pipeline(호출부만)** — SEO 이유 문장이 "역명 출발" 대신 이름 없이 출발역만 넘겨 "{역}에서 오는 분"을 쓴다. `./gradlew :pipeline:run --args=all`로 `seo-pairs.json`·`manifest.json`(dataVersion 20261114.3)을 재생성했다. 레지스트리·후보·OD는 바뀌지 않았다.

**web** — `/recommend`에 사람이 넣은 이름만 보낸다(없는 사람 null, 아무도 없으면 생략). 쿼리 키에 별칭 포함. 결과·받은 링크·공유 문구·안내·P5의 링크 미리보기(`/s` 메타데이터, `/s/og`)가 서버 label만 쓴다. `lib/display/names.ts`(나/친구1 규칙) 삭제. 입력 화면의 "나/친구1"은 입력 칸 안내 문구(`INPUT_PLACEHOLDERS`)로만 남았다. "(나)"는 받은 링크에서 고른 사람에게만 붙는다. 이름이 "{역}에서 오는 분"이면 아래 줄에 출발역을 되풀이하지 않는다. 첫 결과 전에는 "나는 누구?"를 그리지 않는다(이름을 모르므로). 받은 링크 제목은 첫 사람 label이 이름일 때만 "{이름}이 고른", 아니면 "친구가 보낸"(보는 사람 화면 문구라 허용).

- OG 이미지: 글꼴에 없는 글자만 남은 이름(이모지 별칭)은 "참가자 N"으로 그린다(전에는 "나/친구1").
- 가짜 서버(`web/mock`)는 규칙을 흉내 내지 않는다: 이름이 있으면 그 이름, 없으면 "참가자 N". 웹은 label을 그대로 쓰므로 화면 동작은 같다.
- 방 API: 웹에는 아직 방 흐름이 없어 보낼 곳이 없다. 서버 방 API는 이미 별칭을 받고 label을 돌려준다.

## 4. 문장 스냅샷 변경 이유

| 스냅샷 | 전 | 후 | 이유 |
|---|---|---|---|
| ReasonSnapshotTest 별칭 없는 공평 1위 | "가장 오래 걸리는 친구1도 38분" | "가장 오래 걸리는 홍대입구에서 오는 분도 38분" | 규칙 2. 시점 표현 제거 |
| 4명 공평 1위 | "…친구3도 1시간 5분" | "…사당에서 오는 분도 1시간 5분" | 같은 이유 |
| 4명 빨리 1위 | "…친구2는 45분" | "…잠실에서 오는 분은 45분" | 같은 이유(조사도 "분"의 받침으로 "은") |
| 추가: 같은 역 둘 | — | "…강남에서 오는 분 2도 38분" | 번호 규칙 |
| 추가: 숨긴 사람 배려 | — | "참가자 2는 15분, 환승 없이 와요. 강남에서 오는 분은 …" | 규칙 3 |
| SituationAdvisor 버튼 | "친구1 쪽으로 보기" | "홍대입구에서 오는 분 쪽으로 보기" | 규칙 2 |
| 서버 RecommendationService | "A", "민수(A)" | origin label, 같은 별칭은 그대로 | 확정 규칙 1·2 |
| SEO 435쌍 | "신촌 출발도 13분" | "신촌에서 오는 분도 13분" | SEO도 같은 규칙 |

## 5. 실제 연결 검증

`mise run dev`(db → migrate → seed → server + web)로 웹이 로컬 Ktor에 붙은 상태에서 Playwright로 확인했다(`web/e2e-real/real-server.spec.ts`, `pnpm e2e:real`).

- 이름 없는 2인(강남·홍대입구): 결과 카드 "강남에서 오는 분 16분 / 홍대입구에서 오는 분 19분", 문장 "가장 오래 걸리는 홍대입구에서 오는 분도 19분이에요…", (나) 없음 → [스크린샷](w2-screens/1-result-no-names.png)
- 링크 복사 → 새 페이지로 받은 링크 → "나는 누구?"에서 "홍대입구에서 오는 분" 선택: 그 줄만 "(나)", 맨 위로, "내 길찾기" → [스크린샷](w2-screens/2-received-pick-friend.png). 다른 사람으로 바꾸면 "(나)"도 옮겨 간다.
- 옛 링크 `/s?v=1&o=194.ve5&m=f`(공덕·홍대입구의 폐기 코드)가 열리고 "공덕에서 오는 분"으로 보인다.
- `n`에 이름 하나 + 같은 역 둘: "민수 / 홍대입구에서 오는 분 / 강남에서 오는 분".

```text
$ REAL_WEB_URL=http://localhost:<WEB_PORT> pnpm e2e:real     # mise run dev(next dev) 대상
  3 passed (2.9s)
$ (CI와 같은 순서: db·migrate → server → next build/start) REAL_WEB_URL=http://127.0.0.1:<WEB_PORT> pnpm e2e:real
  3 passed (3.4s)
```

주의: `next dev`는 127.0.0.1로 열면 개발용 자원을 막아 수화되지 않는다(입력이 반응하지 않음). dev 대상은 `localhost`로 연다. 프로덕션 빌드(`next start`)는 둘 다 된다.

**CI 잡 `e2e-real`** 을 추가했다(Kotlin 또는 웹 변경 시, 다른 잡과 병렬). compose Postgres → Liquibase → `:server:app:run` → 웹 프로덕션 빌드·시작 → Playwright. PR #15 CI 실측 **2분 39초**(같은 실행의 lint 2분 1초, web 1분 29초와 병렬)로 5분 기준 안이라 유지했다.

## 6. 검증 명령

| 명령 | 결과 |
|---|---|
| `./gradlew check` | 성공(ktlint·detekt 2.0 타입 분석·Konsist·경고=오류). 단위 테스트 306개 실패 0 |
| `./gradlew integrationTest` | 성공(server:app 3, server:room 17 등) |
| `./gradlew :pipeline:run --args=all` | 성공, SEO 333,673 bytes, 그래프 게이트·해시·append-only 통과 |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | 통과 / 통과 / 24 파일 217 테스트 |
| `pnpm check:contracts` | 통과(API 타입·역 인덱스·OG 글꼴 재생성 후 diff 없음. 글꼴은 바뀌지 않음) |
| `pnpm e2e`(가짜 서버) | 7개 통과 |
| `pnpm e2e:real`(실제 서버) | 3개 통과 |
| `actionlint` | 출력 없음 |

새 의존성·버전 변경 없음. suppress·baseline 추가 없음.

## 7. 관찰

- `./gradlew :pipeline:run --args=all`은 `data/config/source-dates.json`을 한 줄 JSON으로, `source-manifest.json`을 다시 쓴다(내용 같음, 형식만 다름). 이 PR에는 넣지 않았다(파이프라인 소유).
- 앱(Android/iOS)도 이름 규칙을 다시 만들지 말고 서버 label을 쓰면 된다. 무상태 계산을 앱 안에서 할 경우에만 `ParticipantLabels`를 직접 호출한다.

## 8. 결정 필요

1. **같은 별칭이 둘 이상일 때.** 확정 규칙대로 그대로 둔다("민수", "민수"). 전에는 서버가 "민수(A)"로 구별했다. 문장이 모호해질 수 있다("가장 오래 걸리는 민수도"). 구별이 필요하면 규칙 4번째 줄(예: " 1", " 2")을 추가할지 정해야 한다.
2. **이름과 label이 우연히 겹칠 때**(누군가 별칭을 "참가자 2"나 "강남에서 오는 분"으로 넣음). 막지 않았다.
3. **`e2e-real` CI 잡**: 실측 2분 39초로 유지했다. 브랜치 보호의 `ci-ok`가 이 잡을 포함한다.
