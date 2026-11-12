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
