"""실제 시간표의 일부를 막차 오라클용 고정 문제로 잘라 낸다(#92). 외부 의존성·네트워크 호출 없음.

장난감 픽스처(toy.json)는 규칙을 하나씩 겨누는 가짜 노선이다. 이 파일이 만드는 real-core.json은 4호선(서울교통공사 구간 + 코레일 과천·안산선
구간)과 2호선·7호선의 사당·이수 둘레를 실제 시간표에서 잘라 담은 것이라, 급행이 지나가기만 하는 줄·중간에서 시작하는 열차·번호 있는 구간과
번호 없는 구간을 잇는 직통 열차가 실제 모양으로 나온다. 파이프라인(Kotlin)과 오라클(last_train.py)이 같은 기대 칸을 내는지 CI가 본다.

    # build가 쓴 build/last-train/problem.json과 data/raw 캐시가 있는 저장소 루트에서(키 불필요):
    python3 -B prototype/gen_real_fixture.py build/last-train/problem.json data/raw pipeline/src/test/resources/last-train/real-core.json

자르는 규칙(바꾸면 기대 파일도 다시 만든다: real-core.expected.json, real-core.off.expected.json):
- 역: SEGMENTS가 고른 역. 노선 묶음 그래프와 TAGO 역 목록·역간 시간은 자르지 않는다(종착역 판정에 필요하다).
- 줄: 위 역의 줄 가운데 서비스일 22:00 이후의 것만(막차는 그 뒤에 있다). 열차는 고른 역에서의 줄만 남는다.
- 출처 조건: 서울교통공사 열차운행시각표(data.go.kr/15098251)는 이용허락범위 제한 없음, 서울 열린데이터광장 OA-101과 국토교통부 TAGO
  지하철정보(data.go.kr/15098554)도 2026-11-21에 이용허락범위 제한 없음으로 확인했다. 코레일 XLSX는 쓰지 않는다.
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
                 "around Sadang and Isu, rows from 22:00 on. Written by prototype/gen_real_fixture.py from the timetable caches "
                 "(S5 OA-101, S7 data.go.kr/15098251, S6 TAGO data.go.kr/15098554; all 이용허락범위 제한 없음, checked 2026-11-21). "
                 "The file turns rebuilding on, like toy.json. Expected cells: real-core.expected.json (rebuilding on) and real-core.off.expected.json (rebuilding off, the default), "
                 "written by prototype/last_train.py.",
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
    print(f"{out}: {len(text)} bytes, homes {len(out_data['homes'])}, meetings {len(meetings)}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
