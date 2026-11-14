# 개발 데이터: 환승역 정리와 SEO 사전계산 (P2c)

2026-11-14 검증. 실제 배차 키 수집은 실행하지 않았으며 기존 추정 배차를 그대로 사용한다.

## 환승역 전수 대조

원인은 기관별 원본의 환승 노선 ID가 서로 다른 namespace여서 `I4108`(코레일)과 `S1102`(서울교통공사) 같은 ID를 직접 비교해도 같은 환승역으로 연결되지 않았던 것이다. 기관 간 물리역 결합에 수도권의 정규화 이름+근접 좌표 규칙을 추가했다. 기존 레지스트리의 모든 코드를 보존하고, 서울교통공사 원본을 가진 기존 코드 → 오래된 addedIn → 코드 사전순으로 정식 코드를 고른다. 이 순서 덕분에 기존 계산 축의 코드가 모두 유지된다. 같은 source key의 원본 ID가 충돌하면 합치지 않고 실패한다.

`data/config/network-rules.json`의 physicalStations가 범위(위도 36.7~38.3, 경도 126.3~128.0), 850m 근접 기준, 구별/동일 역의 예외와 출처, 우선할 source prefix를 소유한다. 범위는 현재 S1의 수도권·연결 광역철도를 덮는 보수적 좌표 창이며 부산 등 전국 동명이역을 자동 병합하지 않는다. 범위 밖에서는 기존 원본 환승 ID의 결합 규칙만 유지한다. 거리는 기존 모델과 같은 평면 근사 `hypot(Δlat×111, Δlng×88)` km이며 실제 보행 거리로 해석하지 않는다.

수도권의 active 657개 전부를 대조했으며 복수 노선 역은 118개다. 각 역의 코드·노선·원본 수와 남은 동명이역은 재생성되는 [전수 대조 목록](config/physical-station-audit.json)에 기록한다. 다음 8개 중복을 정리했다:

| 역 | 옛 코드 → 정식 코드 | 근거 / S1 좌표 차이 |
|---|---|---|
| 공덕 | `194` → `nn9` | S1 동일 역명·44m, AREX 공식 환승 안내 |
| 디지털미디어시티 | `s4w` → `2ew` | S1 동일 역명·221m, AREX 공식 환승 안내 |
| 상봉 | `m04` → `8gc` | S1 동일 역명·121m, S4 7호선→경의중앙/경춘 환승 각 100m |
| 청량리 | `aht` → `mj0` | S1 동일 역명·269m, S4 1호선→경의중앙/경춘/수인분당 환승 |
| 왕십리 | `jh4` → `ct5` | S1 동일 역명·128m, 서울시 공식 노선도의 환승역 |
| 이촌 | `gsp` → `xnc` | S1 좌표 약905m 불일치; S4에 4호선→경의중앙 환승 78m/65초 명시, 동일 역 예외 |
| 지축 | `mtn` → `zc4` | S1 동일 역명·4m, 서울시 공식 노선도의 동일 3호선 경계역 |
| 홍대입구 | `ve5` → `ryf` | S1 동일 역명·35m, AREX 공식 환승 안내 |

공식 근거: [AREX 일반열차 환승 안내](https://www.airportrailroad.com/train/normal/introduce), [서울교통공사 S4 환승거리](https://data.seoul.go.kr/dataList/OA-13290/S/1/datasetView.do), [서울시 공개 수도권 노선도](https://japanese.seoul.go.kr/wp-content/uploads/2025/08/cliamte-card-service-availability.pdf), S1 원본과 기존 출처는 [ATTRIBUTION](ATTRIBUTION.md). 좌표 원본은 임의 수정하지 않았다. 이촌의 원본 좌표 불일치는 남겨 두고 환승 사실만 명시적으로 보정한다.

남은 동일 이름은 별개 역인 신촌(2호선 `1qs`/경의중앙 `pxn`, 약700m)과 양평(5호선 `h1r`/경의중앙 `51c`, 약53km)뿐이다. 신촌은 서울시 노선도에 별도 표시돼 명시적 구별 예외로 보존하며 양평은 거리로 구분된다.

registryVersion 3→4, 총 코드 984개 유지, active 952→944 / deprecated 32→40. 퇴역한 코드는 deprecatedIn=4와 replacedBy를 기록했다. 옛 이름 aliases는 정식 코드에 합치며 **코드 별칭의 유일한 원천은 stations.json의 replacedBy**다. 별도 별칭 산출물은 없다. 모든 replacedBy 체인 40개가 순환 없이 active 코드에서 끝나는지도 게이트가 검사한다. 폐역 등 replacement 없는 deprecated 자체는 허용하되 다른 코드의 replacement 체인이 거기서 끝나면 실패한다.

**소비자 후속:** 웹 인덱스·서버는 옛 입력 코드를 replacedBy 체인을 따라 active 코드로 해석해야 한다. 이 작업은 코디네이터가 웹/P3 후속으로 배정한다. 이번 PR은 소비자 로직을 수정하지 않는다. 코디네이터 승인으로 기존 생성기를 실행해 `web/src/lib/stations/index.gen.json`만 동기화했다. 데이터 변경 시 이 인덱스 재생성이 필요하며, 파이프라인 build가 이를 자동 수행하게 할지는 결정이 필요하다.

## SEO 사전계산

[seo-hubs.csv](config/seo-hubs.csv)에 약속 출발지로 유용할 상권·대학가·업무·광역철도 환승 거점 30개와 각 선정 이유를 기록했다. **실제 검색/약속 빈도 통계 순위가 아닌 편집 선정**이다. 관측되지 않은 이용량을 인기 수치로 주장하지 않는다. 현재 그래프가 지원하는 서울교통공사 1~8호선 구간 안에서 도심·서북·서남·동북·동남 거점을 분산시켰으며, 동명이역 신촌은 계산 가능한 2호선 역만 고른다.

`build`/`all`이 [seo-pairs.json](artifacts/dev/seo-pairs.json)을 함께 쓴다. 30C2=435쌍, 각 fair 상위 3개(총 1,305개 결과), 원본 UTF-8 **330,303 bytes**(322.6 KiB), gzip(mtime=0) **28,085 bytes**다. 1 MiB 상한보다 작아 쌍 수를 줄이지 않았다. 전체 registry/candidates/od/seo 합계는 777,391 bytes(별도 manifest/glyphs 제외)다.

- a<b인 코드 사전순, 쌍 정렬·중복 없음. times/transfers의 순서는 항상 a,b다.
- 행렬의 정수 초·환승 값을 shared:core의 `rank(mode="fair", toleranceSeconds=0)`에 전달하고 상위 최대 3개를 쓴다. 별도의 웹 순위 구현은 없다.
- 이유는 shared:app-logic의 `ReasonGenerator`가 생성한다. PersonRef에는 사용자 별칭 대신 `역명 출발`을 넣고, 1위는 2위와, 대안은 1위와 비교한다. 개인/시점 정보 없이 역 이름을 기준으로 한 한국어 문장이다. 분 단위 표시는 공유 모듈의 기존 반올림 규칙이다.
- SEO의 dataVersion은 manifest와 같다. 기존 계약의 선택 필드 `manifest.files.seoPages`에 path=`seo-pairs.json`과 SHA-256·bytes를 기록한다. 형식 세대는 1로 유지한다. 역→코드 대체 정보는 SEO에 복제하지 않는다.
- `validate`는 SEO 해시·크기·manifest 버전뿐 아니라 현재 hub 목록/행렬로 순위와 이유를 다시 계산해 JSON 전체를 대조한다. SEO만 변경돼도 새 dataVersion을 발급하며 동일 입력 재실행은 manifest까지 보존한다.

## 재생성 및 검증

```sh
./gradlew :pipeline:check :pipeline:integrationTest
./gradlew :pipeline:run --args=all
```

단위 테스트 31개와 Postgres 통합 1개, ktlint/detekt를 통과했다. 독립 fixture 골든은 fair 순위·개인별 초·집계·정확한 한국어 이유를 검증하고, 실제 435쌍도 재계산 대조한다. 이름/좌표가 같은 기관 간 중복 병합, 코드/addedIn 보존, 우선 코드, 옛 이름, 반복 실행, 신촌 예외, 먼 동명이역, 범위 밖 동명이역, 순환/없는/퇴역 replacement를 검사한다. suppress/baseline·새 버전·공용 설정 변경은 없다.

재생성 결과 출발 코드 240개와 후보 코드 97개는 이전과 같다. OD는 registryVersion 헤더 4바이트를 제외한 **모든 바이트가 이전과 동일**하여 원래 소요시간·환승 수를 바꾸지 않았다. 후보 목록은 코드 집합/순서는 같고 registryVersion만 4로 갱신했다. 키 없는 all 성공, 두 번째 실행은 SEO까지 Artifacts unchanged를 확인했다. 실제 키 배차 갱신은 이번 범위 밖이며 실행하지 않았다.
