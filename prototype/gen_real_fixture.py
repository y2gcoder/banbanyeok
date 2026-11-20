"""실제 시간표의 일부를 막차 오라클용 고정 문제로 잘라 낸다(#92). 외부 의존성·네트워크 호출 없음.

장난감 픽스처(toy.json)는 규칙을 하나씩 겨누는 가짜 노선이다. 이 파일이 만드는 real-core.json은 4호선(서울교통공사 구간 + 코레일 과천·안산선
구간)과 2호선·7호선의 사당·이수 둘레를 실제 시간표에서 잘라 담은 것이라, 급행이 지나가기만 하는 줄·중간에서 시작하는 열차·번호 있는 구간과
번호 없는 구간을 잇는 직통 열차가 실제 모양으로 나온다. 파이프라인(Kotlin)과 오라클(last_train.py)이 같은 기대 칸을 내는지 CI가 본다.

    # build가 쓴 build/last-train/problem.json과 data/raw 캐시가 있는 저장소 루트에서(키 불필요):
    python3 -B prototype/gen_real_fixture.py build/last-train/problem.json data/raw pipeline/src/test/resources/last-train/real-core.json

자르는 규칙(바꾸면 기대 파일도 다시 만든다: real-core.expected.json, real-core.off.expected.json):
- 역: SEGMENTS가 고른 역. 노선 묶음 그래프와 TAGO 역 목록·역간 시간은 자르지 않는다(종착역 판정에 필요하다).
- 줄: 위 역의 줄 가운데 서비스일 22:00 이후의 것만(막차는 그 뒤에 있다). 열차는 고른 역에서의 줄만 남는다.
- 출처와 이용 조건(2026-11-21에 각 원문 페이지에서 직접 확인, 아래 SOURCES와 같은 내용이 픽스처의 "sources"와 data/ATTRIBUTION.md에 있다):
  시간표 줄은 S5(서울 열린데이터광장 OA-101)·S6(국토교통부 TAGO 지하철정보)·S7(서울교통공사 열차운행시각표), 그 밖의 입력 가운데 노선 묶음
  그래프의 서울교통공사 구간은 S3(역간거리 및 소요시간 OA-12034)에서(코레일 구간과 역간 시간 hops는 S6), 환승 걷는 시간(walks·stationWalks)은 S4(환승역거리 소요시간 OA-13290)에서, 역 코드·이름 연결은
  S1(국가철도공단 역사정보)에서 온다. 모두 이용허락범위 제한 없음이다. 수집 당시 영수증(source-manifest.json)에는 S3·S4·S5가 공공누리 제1유형으로
  적혀 있어 두 표기를 따로 적는다. 서울 열린데이터광장 자료는 "서울특별시 공공데이터"를 출처로 표시한다. 코레일 XLSX(공공누리 4유형)는 쓰지 않는다.
"""
import collections
import json
import sys
from pathlib import Path

import last_train as L

KEEP_FROM = 22 * 3600
# 4호선: 남태령 위쪽 서울교통공사 구간과 아래쪽 코레일 구간이 만나는 곳. 2·7호선: 사당·이수에서 갈아타는 곳 둘레.
SEGMENTS = {
    "4": ["평촌", "인덕원", "정부과천청사", "과천", "대공원", "경마공원", "선바위", "남태령", "사당", "총신대입구(이수)", "동작", "이촌"],
    "2": ["방배", "사당", "낙성대"],
    "7": ["내방", "총신대입구(이수)", "남성"],
}
MEETINGS = ["사당", "총신대입구(이수)", "동작", "인덕원", "방배"]

CHECKED = "2026-11-21"
# 시간표(rows)와 네트워크 입력(families·stations·hops·walks·stationWalks·homes)의 출처를 따로 적는다.
SOURCES = {
    "checked": CHECKED,
    "timetables": [
        {"id": "S5", "title": "서울교통공사_역코드로 지하철 열차 시간표 검색 (OA-101)", "provider": "서울교통공사 (서울특별시 공공데이터, 서울 열린데이터광장)",
         "url": "https://data.seoul.go.kr/dataList/OA-101/A/1/datasetView.do", "usedFor": "rows.*.numbered (train numbers)",
         "licenseNow": "이용허락범위 제한 없음", "licenseAtFetch": "공공누리 제1유형 (receipt)"},
        {"id": "S6", "title": "국토교통부_(TAGO)_지하철정보", "provider": "국토교통부",
         "url": "https://www.data.go.kr/data/15098554/openapi.do", "usedFor": "rows.*.unnumbered (no train numbers); hops (neighbouring-station times); families and stations of the Korail section",
         "licenseNow": "이용허락범위 제한 없음", "licenseAtFetch": "이용허락범위 제한 없음 (receipt)"},
        {"id": "S7", "title": "서울교통공사_서울 도시철도 열차운행시각표", "provider": "서울교통공사",
         "url": "https://www.data.go.kr/data/15098251/fileData.do", "usedFor": "rows.*.second (train codes)",
         "licenseNow": "이용허락범위 제한 없음", "licenseAtFetch": "이용허락범위 제한 없음 (receipt)"},
    ],
    "network": [
        {"id": "S3", "title": "서울교통공사_역간거리 (OA-12034)", "provider": "서울교통공사 (서울특별시 공공데이터, 서울 열린데이터광장)",
         "url": "https://data.seoul.go.kr/dataList/OA-12034/S/1/datasetView.do", "usedFor": "families (line graph of the Seoul Metro section, via the travel network)",
         "licenseNow": "이용허락범위 제한 없음", "licenseAtFetch": "공공누리 제1유형 (receipt)"},
        {"id": "S4", "title": "서울교통공사_환승역거리 소요시간 정보 (OA-13290)", "provider": "서울교통공사 (서울특별시 공공데이터, 서울 열린데이터광장)",
         "url": "https://data.seoul.go.kr/dataList/OA-13290/S/1/datasetView.do", "usedFor": "walks, stationWalks (transfer walking seconds)",
         "licenseNow": "이용허락범위 제한 없음", "licenseAtFetch": "공공누리 제1유형 (receipt)"},
        {"id": "S1", "title": "전국도시철도역사정보표준데이터", "provider": "국가철도공단",
         "url": "https://www.data.go.kr/data/15013205/standard.do", "usedFor": "homes, meetings, stations (station codes and names)",
         "licenseNow": "이용허락범위 제한 없음", "licenseAtFetch": "이용허락범위 제한 없음 (receipt)"},
    ],
    "notUsed": "코레일 XLSX (공공누리 4유형)",
}


def main(problem_path, raw, out):
    data = L.read_json(problem_path)
    problem = L.Problem(data)
    registry = L.read_json("data/registry/stations.json")["stations"]
    names = {s["code"]: s["name"] for s in registry}
    codes = collections.defaultdict(set)
    for code, name in names.items():
        codes[name].add(code)
    keep = {family: {c for name in members for c in codes[name] if c in problem.graph[family]}
            for family, members in SEGMENTS.items()}
    kept_codes = set().union(*keep.values())
    families = sorted(keep)
    stations = {sid: v for sid, v in data["stations"].items() if v[1] in families}
    hops = [row for row in data["hops"] if row[0] in stations and row[1] in stations]
    walks = [row for row in data["walks"] if row[0] in kept_codes and row[1] in families and row[2] in families]
    station_walks = {c: s for c, s in data["stationWalks"].items() if c in kept_codes}
    meetings = sorted({c for name in MEETINGS for c in codes[name] if c in kept_codes})
    out_data = {
        "about": "Real timetable excerpt (#92): line 4 (Seoul Metro section + Korail Gwacheon/Ansan line) and the lines 2 and 7 stations "
                 "around Sadang and Isu, rows from 22:00 on. Written by prototype/gen_real_fixture.py from the timetable caches and the "
                 "travel network's fixed inputs; \"sources\" lists where each part comes from and its terms (all 이용허락범위 제한 없음, "
                 "checked 2026-11-21). The file turns rebuilding on, like toy.json. Expected cells: real-core.expected.json (rebuilding on) and "
                 "real-core.off.expected.json (rebuilding off, the default), written by prototype/last_train.py.",
        "sources": SOURCES,
        "homes": sorted(kept_codes),
        "meetings": meetings,
        "families": {f: data["families"][f] for f in families},
        "stations": stations,
        "hops": hops,
        "sourceMargin": data["sourceMargin"],
        "walks": walks,
        "stationWalks": station_walks,
        "exact": data["exact"],
        "exactNumbered": data["exactNumbered"],
        "rebuild": True,
        "proven": {},
        "rows": {},
    }
    for day in L.DAYS:
        rows = L.cache_rows(problem, Path(raw), registry, day)
        unnumbered = {}
        for sid, found in sorted(rows["unnumbered"].items()):
            if stations.get(sid, (None,))[0] in kept_codes:
                late = sorted(r for r in found if L.key_of(r[0], r[1]) >= KEEP_FROM)
                if late:
                    unnumbered[sid] = [list(r) for r in late]
        numbered = [r for r in rows["numbered"] if r[2] in kept_codes and r[0] in families and L.key_of(r[3], r[4]) >= KEEP_FROM]
        second = [r for r in rows["second"] if r[2] in kept_codes and r[0] in families and L.key_of(r[3], r[4]) >= KEEP_FROM]
        out_data["rows"][day] = {
            "unnumbered": unnumbered,
            "numbered": [[g, t, c, a, d, e or ""] for g, t, c, a, d, e in sorted(numbered, key=lambda r: (r[1], r[3], r[4], r[2]))],
            "second": [[g, t, c, a, d, e or ""] for g, t, c, a, d, e in sorted(second, key=lambda r: (r[1], r[3], r[4], r[2]))],
        }
    def dump(value):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    lines = ["{"]
    for key, value in out_data.items():
        if key != "rows":
            lines.append(f' "{key}": {dump(value)},')
    lines.append(' "rows": {')
    blocks = []
    for day, rows in out_data["rows"].items():
        block = [f'  "{day}": {{', f'   "unnumbered": {dump(rows["unnumbered"])},']
        for name in ("numbered", "second"):
            block.append(f'   "{name}": [')
            block.append(",\n".join("    " + dump(r) for r in rows[name]))
            block.append("   ]" + ("," if name == "numbered" else ""))
        block.append("  }")
        blocks.append("\n".join(block))
    lines.append(",\n".join(blocks))
    lines.append(" }")
    lines.append("}")
    text = "\n".join(lines) + "\n"
    json.loads(text)
    Path(out).write_text(text, encoding="utf-8")
    print(f"{out}: {Path(out).stat().st_size} bytes, homes {len(out_data['homes'])}, meetings {len(meetings)}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
