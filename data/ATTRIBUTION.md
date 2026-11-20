# 데이터 출처

`data/samples/`는 조사용 표본이며 서비스 데이터가 아닙니다. 수집일 2026-11-12.

| 파일 | 출처 | 라이선스 |
|---|---|---|
| `kric-stations.sample.csv`, `kric-inspection.json` | 국가철도공단, 전국도시철도역사정보 (https://data.kric.go.kr/rips/M_01_01/detail.do?id=32) | 공공데이터포털 표기: 이용허락범위 제한 없음 |
| `seoul-runtime.sample.csv` | 서울교통공사 역간거리 및 소요시간 (서울 열린데이터광장 OA-12034) | 공공누리 제1유형 (출처표시) |
| `seoul-transfer.sample.csv` | 서울교통공사 환승역거리 소요시간 (OA-13290) | 공공누리 제1유형 (출처표시) |
| `seoul-stations.sample.json` | 서울시 지하철역 정보 검색 (OA-121) | 공공누리 제1유형 (출처표시) |
| `seoul-timetable-sample.json` | 서울시 역코드로 지하철역별 열차 시간표 정보 검색 (OA-101) | 공공누리 제1유형 (출처표시) |
| `seoul-route.sample.json` | 서울교통공사 최단경로이동정보 (OA-22724) | 공공누리 제1유형 (출처표시) |

외부 경로 API(ODsay, TMAP, 카카오) 결과와 KTDB 원본은 이 저장소에 커밋하지 않습니다.

## P2 개발용 그래프·레지스트리·행렬

수집 영수증(원본 URL, POST 본문, 수신 UTC 시각, SHA-256, Content-Type, 라이선스)은
`data/config/source-manifest.json`에 보관합니다. 원본은 git에서 제외한 `data/raw/`에만 있습니다.

| 파생 산출물 | 출처·가공 | 이용 조건 |
|---|---|---|
| `data/registry/stations.json`, `data/artifacts/dev/stations.json`, `og-glyphs.txt`의 역명 | 국가철도공단 전국도시철도역사정보 S1, https://data.kric.go.kr/rips/M_01_01/detail.do?id=32 및 https://www.data.go.kr/data/15013205/standard.do · 기관/노선 ID·좌표·환승노선으로 물리역 통합, 개명 정규화. 까치산 2호선은 S3/S4로 보완 | 공공데이터포털 표기 이용허락범위 제한 없음. 원자료의 권리를 코드 AGPL과 혼동하지 않습니다 |
| `data/artifacts/dev/od.bin` | 서울교통공사 역간거리·소요시간 S3 (OA-12034), 환승역거리 소요시간 S4 (OA-13290). https://data.seoul.go.kr/dataList/OA-12034/S/1/datasetView.do 및 https://data.seoul.go.kr/dataList/OA-13290/S/1/datasetView.do · 지선/단방향 순환을 반영하고 자체 추정 배차 대기 추가, 다익스트라로 계산 | 공공누리 제1유형(출처표시). 변경·가공된 평시 추정치이며 공식 시간표·실시간 안내가 아닙니다 |
| `data/registry/candidates.json`, `candidate-review.json`, `data/config/candidate-places.csv` | 자체 선정 만남 후보 초안 97개. 외부 장소 평가·지도 리뷰를 수집하지 않음 | 저장소 코드와 동일한 AGPL-3.0. 전부 사람 검토 전 |
| `data/config/validation-report.json`의 경로 비교 | 서울교통공사 최단경로이동정보 S7 공개 sample 호출 (OA-22724), https://data.seoul.go.kr/dataList/OA-22724/A/1/datasetView.do | 공공누리 제1유형. 비교 차이만 보관하며 API 원문·경로 구간·응답 절대 시간은 파생 행렬에 사용/저장하지 않습니다 |

`headways.json`의 6/8분 배차는 개발용 가정이며 외부 시간표에서 가져온 값이 아닙니다.
당고개→불암산 개명은 S1의 서울교통공사 역번호 0409와 S3의 4호선 위치 및
[서울시 역명 개정 고시를 인용한 조달 문서](https://www.g2b.go.kr/fs/fsc/fsca/fileUpload.do?k00=a2MMYzianzwExorC2swMQwxC2swNQwwC2syNgwvZGF0YS9BdHRhY2hmaWxlcy9wbnBlLzIwMjUvMDQvMTUvNzQzZjlkN2UwMDZmNDAzMGIwYjFkMmQ2OTAwYmYyNTAucGRmC2szMQwxLuqzvOyXheyngOyLnOyEnCjqs7XthrUpLnBkZgtrMjEMNWVhYzA2ZTktZTk2OC00N2M3LTk3MDYtN2I1ZmM3MTA4NzgwLDE%3D)를 함께 확인했습니다.

## D1 수도권 전 노선 (TAGO)

| 파생 산출물 | 출처·가공 | 이용 조건 |
|---|---|---|
| `od.bin`의 서울교통공사 S3 밖 주행·배차, `data/config/tago-report.json` | 국토교통부 TAGO 지하철정보 S6 (https://www.data.go.kr/data/15098554/openapi.do) `GetKwrdFndSubwaySttnList`·`GetSubwaySttnAcctoSchdulList` 평일 역별 시간표. 열차 ID 없이 인접역 출발·도착 시각을 맞춰 소요시간을 추정하고, 평시 출발 간격의 절반을 대기로 더함 | 공공데이터포털 표기 이용허락범위 제한 없음. 원 응답은 `data/raw/tago/`(git 제외)에만 두고 영수증(S6 다이제스트)은 `source-manifest.json`에 둔다. 가공된 평시 추정치이며 공식 시간표가 아니다 |
| `stations.json`의 `tago:*` 출처 ID·별칭(서해구청) | 같은 S6 역 목록 | 같은 조건 |
| 운정중앙·킨텍스·동탄(GTX-A), 양원(경의중앙선) 좌표 | Wikidata P625 (Q125895818, Q125695849, Q23954759, Q482940), https://www.wikidata.org | CC0 1.0 |
| `data/config/official-times.csv`, `official-comparison.json` | 신분당선 공식 소요 시각표 (https://shinbundang.co.kr/index.jsp?open_main=1&open_sub1=4&open_sub2=2&pageID=%2Fdxline%2Fdxline3_2.jsp), 2026-11-15 손으로 옮겨 적음 | 대조용 사실값(분·초)만 기록. 그래프 간선의 원천으로 쓰지 않는다 |

## 귀갓길 막차 (#62)

| 파생 산출물 | 출처·가공 | 이용 조건 |
|---|---|---|
| `lt.bin`의 서울교통공사 1~8호선 운영 구간 | 서울시 역코드로 지하철역별 열차 시간표 정보 검색 S5 (서울 열린데이터광장 OA-101, 서울교통공사). 평일·토요일·휴일 역별 시간표를 열차 번호로 묶어 역 쌍마다 마지막 열차를 구함 | 공공누리 제1유형 (출처표시). 원 응답은 `data/raw/seoul/`(git 제외), 영수증은 `source-manifest.json`의 S5 |
| `lt.bin`의 신분당선 직행 칸(운영사 표본과 대조한 칸만) | 국토교통부 TAGO 지하철정보 S6 (https://www.data.go.kr/data/15098554/openapi.do) 평일·휴일 역별 시간표. 열차 ID가 없어 줄을 이어 만든 열차는 운영사 표본과 칸마다 대조하는 데만 쓰고, 표본과 분·행선지가 같은 칸만 낸다. 그 밖의 TAGO 노선은 막차 표에 쓰지 않는다 | 공공데이터포털 표기 이용허락범위 제한 없음. 원 응답은 `data/raw/tago/`(git 제외), 영수증은 S6 |
| `lt.bin`의 9호선과 1·3·4·7·8호선의 서울교통공사 밖 구간(열차코드로 묶은 열차), 서울 1~8호선 직행 확정의 대조, `data/config/last-train-official.csv`의 1~8호선 표본, `last-train-ceilings.csv` | 서울교통공사_서울 도시철도 열차운행시각표 S7 (https://www.data.go.kr/data/15098251/fileData.do, 파일 기준일 2026-09-01, 수정일 2026-09-14). 열차코드가 있는 1~9호선 전 구간 시간표 | 공공데이터포털 표기 이용허락범위 제한 없음. 원 파일은 `data/raw/seoulmetro-timetable.csv`(git 제외), 영수증은 S7 |
| `data/config/last-train-official.csv`의 신분당선·공항철도 표본 | 신분당선 역별 시간표(https://www.shinbundang.co.kr/dxline/dxline_time_gy.jsp), 공항철도 역별 시간표(https://www.airportrailroad.com/train/normal/info/010/0), 2026-11-20 손으로 옮겨 적음 | 대조용 사실값(시각·행선지)만 기록. 표의 원천으로 쓰지 않는다 |
| `pipeline/src/test/resources/last-train/real-core*.json`(막차 오라클 대조용 실제 시간표 일부, #92) | 4호선·2호선·7호선의 사당·이수 둘레 역만, 서비스일 22:00 이후 줄만 잘라 담음(`prototype/gen_real_fixture.py`). 서울교통공사 열차운행시각표 S7(data.go.kr/15098251), 서울 열린데이터광장 OA-101 S5(https://data.seoul.go.kr/dataList/OA-101/A/1/datasetView.do), 국토교통부 TAGO 지하철정보 S6(https://www.data.go.kr/data/15098554/openapi.do). 세 곳 모두 2026-11-21에 이용 조건 페이지에서 이용허락범위 제한 없음으로 확인. 코레일 XLSX(공공누리 4유형)는 쓰지 않음 | 공공데이터포털·열린데이터광장 표기 이용허락범위 제한 없음(S5 영수증에는 공공누리 제1유형으로 적혀 있어 출처표시는 그대로 한다). 원 응답의 일부이며 공식 시간표가 아니다 |
