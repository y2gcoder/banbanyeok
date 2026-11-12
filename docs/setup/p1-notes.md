# P1 알고리즘 코어 작업 노트

작성 2026-11-12. 원본 규칙은 `docs/research/algorithm.md`, 시간 단위는 종합 문서와 데이터 계약에 따라 정수 초다.

## 공개 API

`shared/core/src/commonMain/kotlin/app/banbanyeok/core/Model.kt`에 공개 타입을 먼저 정의했다.

- `rank(RankInput): RankResult`는 플랫폼 API·I/O·전역 가변 상태 없는 순수 함수다.
- `RankInput`: `participants: List<String>`, `candidates: List<String>`, `times: List<List<Int?>>`, `transfers: List<List<Int?>>`, `mode: String = "fair"`, `toleranceSeconds: Int = 0`. 모드는 `fair`, `fast`, `favor:<participantId>`. 행=참가자, 열=후보. 도달 불가는 두 행렬의 같은 칸에 함께 null.
- `RankResult`: `status`(ok/no_common_candidate), `mode`, `participants`, `toleranceSeconds`, `baselineStationCode`, `favorCaps: Map<String, Long>?`, `recommendations: List<Candidate>`, `excluded: List<ExcludedCandidate>`.
- `Candidate`: `rank`, `stationCode`, `times: List<PersonalTime>`, `maxSeconds`, `spreadSeconds`, `totalSeconds: Long`, `favoredSeconds: Int?`, `reasonCode`. `PersonalTime`은 OpenAPI와 같은 `participantId`, `seconds`, `transfers`다.
- `ExcludedCandidate`: `stationCode`, `reasonCode`(UNREACHABLE/FAVOR_CAP_EXCEEDED). 제외 목록은 코드순이다.
- 후보 전체 순위를 반환한다. 상위 3개 자르기, stationName, dataVersion, 응답 participants의 개인정보 처리는 어댑터 몫이다. OpenAPI의 `candidates`에는 `recommendations`를 매핑하고, favor 모드를 `favor`와 대상 ID로 분리한다. 문구 대신 번역 가능한 reasonCode를 반환한다.
- times와 tolerance는 Int라 소수·NaN·무한대를 전달할 수 없다. 잘못된 참가자 수/중복/빈 ID, 후보 중복/빈 ID, 모드/대상, 음수, 행렬 크기, null 불일치는 IllegalArgumentException이다. 후보가 빈 것은 정상 no_common_candidate다. 후보 ID는 연구 골든의 임의 문자열도 허용하며 실제 3자 ASCII 역 코드 검증은 registry/어댑터 계층이 맡는다. 실제 역 코드 정렬은 ASCII 사전순이다.
- 합계와 favor 상한은 Int 덧셈 오버플로를 피하려고 Long이다. 입력 시간의 최댓값은 Int.MAX_VALUE까지 허용한다. 정수 초에서 홀수 기준시간의 상한은 내림한 `t + min(900, t / 2)`다. 정수 시간 후보에 대한 부등식은 반초를 유지했을 때와 동일하다.

## 구현

엄밀한 fair 기준역을 허용오차 없이 먼저 계산한다. fair=(최장, 차이, 합계, 코드), fast=(합계, 최장, 코드), favor=(우대자 시간, 최장, 차이, 합계, 코드)이며, favor에서는 다른 사람의 상한을 먼저 적용한다. 환승은 표시에만 쓰고 순위에 가산하지 않는다. 허용오차는 기준마다 현재 최솟값을 앵커로 고정한 포함 경계 밴드로 재귀 적용한다. 쌍별 허용오차 비교자는 사용하지 않는다.

## 검증

- `banbanyeok.contract-test-data` 컨벤션을 core 빌드에 적용해 schema와 같은 ContractFiles 생성 방식을 재사용했다. 외부 의존성이나 schema 수정은 없다.
- `GoldenRankingTest`: 16/16 전체 순위 스냅샷 일치. 입력·기대 시간과 허용오차에 ×60을 적용하고 순위, 참가자 시간/환승, max/spread/total/favored, reasonCode, status, baseline, caps, 제외 목록을 모두 비교한다.
- `RankingPropertiesTest`: 시드 고정 생성 데이터로 후보 순열 900건, 참가자 순열 900건(사람별 매핑 정규화), 엄밀한 fair/fast의 모든 개인 시간이 엄격히 감소할 때 순위 비하락 최대 2000건, favor 상한/기준역 유지 1000건 및 tolerance=0인 500건에서 우대자의 1위 시간 ≤ 엄밀한 fair 기준역에서의 우대자 시간. 순열과 상한 검증은 0초/180초 허용오차를 모두 포함한다.
- 추가 경계: 빈 후보/도달 불가, 입력 오류 17종, 홀수 초 상한과 상한 경계/허용오차 비적용, Int 초 최댓값의 합계·상한, 최소 앵커 밴드와 ASCII 코드 동점. favor와 양수 허용오차의 단조성 반례 2건도 회귀 테스트로 고정했다.
- `./gradlew :shared:core:check --console=plain`: 최종 통과, commonMain 순수성 포함. core 테스트 14개(기존 placeholder 1개 포함), 실패 0.
- `./gradlew build --console=plain`: 최종 전체 통과(67 actionable tasks). 중간에는 반례 테스트의 분→초 변환 누락 및 밴드 테스트 기대값 오류로 실패했으며 수정 후 통과했다. 한 중간 전체 빌드는 다른 작업자의 pipeline 테스트 컴파일 오류도 있었고, 최종 빌드에서 해소됐다.
- 최초 골든 테스트 실행은 rank 미구현으로 컴파일 실패하는 것을 확인한 후 구현했다.

## JVM 대략 성능

JDK 25, N=4/M=100, 고정 시드, 허용오차 0초. 모드별 1000회 워밍업 후 1000회 개별 계산의 `measureNanoTime` 측정값이다. `RankingTimingTest`가 출력하며 시간 제한 assertion은 없다.

| 모드 | 1회 중앙값 | p95 |
|---|---:|---:|
| fair | 63.166 µs | 85.667 µs |
| fast | 59.083 µs | 77.958 µs |
| favor:p0 | 53.542 µs | 101.458 µs |

JMH 측정이 아니고 같은 작업 트리에서 병렬 개발 중의 로컬 대략치다. favor는 상한 필터 후 후보 수가 줄어든다. 직전 실행들에서도 중앙값 약 27~122 µs 범위였다.

## 알려진 비단조성(명세상 의도)

코디네이터 승인에 따라 원본 알고리즘을 유지하고 시간 단조성 속성은 tolerance=0의 fair/fast에서 모든 개인 시간이 엄격히 감소하는 경우로 한정했다. favor는 기준역 변화가 상한을 바꾸며, 양수 tolerance는 재귀 밴드 기준점이 바뀌므로 비단조성이 명세상 정상이다. 아래 반례는 회귀 테스트로 유지한다.

favor의 대체 속성은 (1) 상한 위반 0, (2) tolerance=0에서 우대자의 1위 시간 ≤ 엄밀한 fair 기준역에서의 우대자 시간, (3) 엄밀한 fair 기준역이 항상 후보에 남음이다. (2)는 algorithm.md에서 명시한 대로 양수 tolerance에는 보장하지 않는다.
- favor 반례(분): 후보 a,b,c,d에 A=[14,29,42,24], B=[51,49,34,55]. b의 시간을 [29,49]→[22,37]로 모두 줄이면 fair 기준역이 c→b로 바뀌고 상한이 느슨해져 a가 재진입한다. b는 favor:A에서 1위→2위가 된다. 테스트에서는 ×60 변환했다.
- 밴드 반례(초, tolerance=3): A=[4,55,17,32], B=[48,34,52,49]. b만 [55,34]→[54,11]로 줄여도 fair 순위가 3위→4위가 된다. 최대 시간은 낮아지지만 재귀 밴드에서 spread가 커진다. 시간이 감소해도 일부 개인 시간이 그대로인 약한 감소라면 엄밀한 fair에서도 spread 증가로 단조성을 보장할 수 없다.
## 결정 필요

추가 결정 필요 없음. 코디네이터가 원본 알고리즘 유지와 위 속성 검증 범위를 승인했다. 기존 제품 결정인 0초 기본 허용오차와 900초/50% favor 상한을 그대로 구현했다.
