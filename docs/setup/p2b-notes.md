# P2b — 오프라인 계산과 시간표 배차

검증일: 2026-11-14. 키 없는 구현·검증을 먼저 제출한다. 실제 키 실행은 1Password 데스크톱 승인 시간 초과로 수행하지 못했으며, 코디네이터가 사용자 승인 아래 후속 실행하기로 했다. 아직 `headways.json`은 기존 6/8분 추정값이다.

## 구조와 재현성

- 파일/네트워크 경계: `Main`, `PipelineInput.readInput`, `Sources.fetch/verifyRaw`, `SeoulApi`, `RegistryBaseline`, `HeadwayComparison`.
- 순수 단계: 바이트/문자열 파서 → `NetworkRules` 정규화 → `RegistryBuilder` → `NetworkBuilder` → `matrixCosts` → `graphGate`. 파일, 프로세스, 네트워크 없이 입력 값만으로 테스트한다.
- HTTP는 `PipelineHttp`, 시간은 `java.time.Clock`, 코드 공급은 `CodeSource`로 주입한다. JDK HTTP 구현은 키가 포함될 수 있는 URI/HTTP 예외의 원인과 메시지를 전달하지 않고 고정 오류만 내보낸다. 응답 본문과 요청 URL도 로그에 출력하지 않는다.
- 코드 계약은 유지한다. 기존 코드/addedIn을 유지하며 active→deprecated만 허용한다. 새 코드는 계약대로 SecureRandom 미사용값 추출이므로 **최초 발급은 비결정적**이고 레지스트리에 영구 저장된다. 같은 레지스트리+원본을 재실행하면 새 난수를 사용하지 않으며 동일 코드/registryVersion이다. 테스트는 코드 공급을 고정해 최초 발급도 재현한다. 코드 공간 소진은 즉시 실패한다.
- build/validate는 네트워크를 호출하지 않는다. `all`은 원본이 있으면 재사용하고 없으면 공개 S1/S3/S4만 fetch한다. 시간표 키 없이도 동작하며 S7은 `spotcheck`에서만 호출한다.
- 동일 계산 결과는 기존 manifest를 보존한다. manifest의 시각/일일 revision은 실제 내용 변경 시만 갱신한다. BBOD/registry/candidates는 계약의 동일 입력→동일 바이트 조건을 유지한다.
- `network-rules.json`에 이름 예외, 지선 전역·분기점, 운행계통, 공통 간선 복제, 단방향 순환, 원본 노선 보정, 분기 검증 쌍을 모았다. 까치산의 2호선 상태는 S1 5호선 물리역과 S3/S4 근거를 사용한다.
- JSON 생성/읽기는 kotlinx.serialization JSON 트리를 사용한다. shared:schema의 엄격한 계약 코덱도 그대로 사용한다. 문자열을 연결해 JSON을 생성하거나 정규식으로 JSON을 파싱하지 않는다.

## 시간표 수집·계산

공식 [S5 API](https://data.seoul.go.kr/dataList/OA-101/A/1/datasetView.do)는 역별 시각표이며 실제 도착시각과 다를 수 있다. 출처: 서울교통공사/서울 열린데이터광장, 공공누리 1유형. 시간표 적용 개정일은 응답에 없으므로 fetched_at을 적용일로 주장하지 않는다.

`refresh`는 S2 역코드를 페이지 단위로 받고 현재 S3 범위 역명+노선에 한정해 평일(1), 양방향(1/2)의 S5 전체 페이지를 받는다. 날짜별 캐시가 `data/raw/timetable-YYYY-MM-DD/`에만 생기며 gitignore 대상이다. 같은 날 캐시를 지우면 다시 수집한다. sample의 5행을 전체 시간표로 취급하지 않는다. API 오류·누락 페이지·잘못된 응답은 실패하며 INFO-200 빈 응답만 허용한다.

계산은 일반열차(`EXPRESS_YN=G`)에 한정한다. 역·방향·BRANCH_LINE별 중복 열차/출발시각을 제거하고 평일 10:00:00~16:00:00(양끝 포함) 출발시각의 연속 차이 평균을 구한다. 00~02시는 서비스일의 24~26시와 같이 처리하며 이 평시 창에서는 제외한다. 2회 미만 출발은 집계하지 않는다. 노선·방향별 값은 역/패턴별 평균의 중앙값(짝수면 상위 중앙값), 정적 그래프에 적용하는 노선 배차는 양방향 대표값의 산술평균(정수 반올림)이다. 출발·환승 대기는 배차/2(정수 나눗셈)이다.

`headways.json`에 관측별 간격 수·출발 수, 방향별 값·관측 수, 출처 URL, 수집시각, 시간창·계산식을 남긴다. 양방향을 확보한 노선만 estimated=false로 대체하고 나머지는 기존 추정값을 보존한다. 기존 모델의 노선 배차 60~1800초 유효 범위를 적용한다. 추정값이 한 노선이라도 남으면 전역 estimated=true다.

**모델 한계:** 그래프는 역×운행계통이며 방향별 승강장 상태를 분리하지 않는다. 방향별 관측값은 보존하되 그래프에는 양방향 평균을 적용한다. 지선도 관측 BRANCH_LINE별로 계산하지만 현재 적용 배차는 노선 대표값으로 공유한다. 정밀 방향/행선지/지선 배차 및 급행·막차 계산은 후속 모델 결정이 필요하다. 전체 수도권 커버리지 확대는 이번 범위가 아니다.

## 실행 및 코디네이터 후속

키 없는 검증:

```sh
./gradlew :pipeline:check :pipeline:integrationTest
./gradlew :pipeline:run --args=all
./gradlew :pipeline:run --args=spotcheck # 선택, S7 공개 sample 네트워크 대조
```

코디네이터가 이 worktree에서 사용자 1Password 승인 아래 실행할 **명령 한 줄**:

```sh
op run --env-file=.env.tpl -- ./gradlew :pipeline:run --args=refresh
```

`refresh`는 키 누락 시 분명한 메시지와 비정상 종료 코드로 실패한다. `build/all`은 키가 필요 없다. `mise run dev:pipeline -- refresh`도 동일 CLI 경로지만 승인 재시도는 코디네이터가 수행한다.

변경 파일: `data/config/headways.json`, `data/config/headway-comparison.json`, `data/config/{validation,coverage}-report.json`, `data/artifacts/dev/{od.bin,manifest.json}` 및 이 문서 하단 자동 비교 표. 원본·레지스트리에 변화가 있으면 그 산출물도 갱신된다. 명령 자체에서 build→validate를 실행하여 해시·계약·전체 OD 셀을 검증한다. headways의 observations/directions와 노선 estimated 플래그, 아래 10쌍의 전후 초·변화, validation-report의 passed=true를 확인하고 변경 파일을 후속 커밋한다. 키나 원본 응답은 커밋하지 않는다.

## 검증 결과

- `./gradlew :pipeline:check :pipeline:integrationTest :pipeline:run --args=all`: 성공. detekt/ktlint 통과, pipeline 단위 23개(기존 8+추가 15) 및 실제 Postgres 통합 테스트 통과.
- 메모리 fixture의 그래프·전체 OD 골든, 분기 승차/환승, 단방향 순환, 최단시간 동률 환승 수, append-only/퇴역 복구 금지/중복 코드 충돌, CSV/XML/JSON 경계, 녹화 S5 응답, 시간창·중복·방향·지선 분리·자정·빈 응답·키 누락·URI 오류 가림을 검사한다.
- 키 없는 all에서 registryVersion 3, 전체 984코드, 출발 240역, 후보 97역, 도달률 100%, 상태 삼각/물리역 상한 게이트 통과. 기존 산출물을 재계산했고 stations/candidates/od 바이트는 이전과 동일하다. 실제 배차 전후 변화는 키 실행 후 자동 기록한다.
- pipeline detekt baseline 파일 삭제. 승인된 공용 변경은 `.editorconfig`의 pipeline 긴 줄 예외 제거와 quality 플러그인의 pipeline baseline 설정 4줄 제거뿐이다. 새 suppress/baseline/검사 예외는 없다.
- 새로운 버전은 도입하지 않았다. 기존 카탈로그의 kotlinx.serialization 1.12.0(2026-10-19 안정판, 7일 이상)을 pipeline의 직접 의존성으로 재사용했다. [공식 release](https://github.com/Kotlin/kotlinx.serialization/releases/tag/v1.12.0), [JSON tree 공식 문서](https://github.com/Kotlin/kotlinx.serialization/blob/master/docs/json.md).

## 결정 필요

키 실행 후 실제 시간표 관측 커버리지/추정 잔존 노선 및 대표값을 검토한다. 방향·지선별 상태 확장은 별도 범위로 결정한다. 후보역 97개와 기존 물리역 통합/범위 밖 active 검토는 P2에서 이어지는 운영 경계다. S7은 정답 원천으로 사용하지 않는다.

## 배차 갱신 비교 (자동 생성)

실제 키 실행 대기. `refresh` 성공 시 대표 10쌍(서울역→청량리, 강남→홍대입구, 성수→신설동, 신도림→까치산, 강동→마천, 강동→하남검단산, 응암→연신내, 사당→잠실, 광화문→왕십리, 답십리→역삼)의 갱신 전/후/변화를 이 절에 자동으로 기록한다.
