"""반반지수 시안(#202)의 등급 분포표를 만든다. 버리는 조사 스크립트다.

dev 산출물(data/artifacts/dev/od.bin, 평일 낮)로 출발역 조합을 뽑고, 공평 순위(최장, 차이, 합계, 코드; 초 단위, 동점 폭 0)로
1위를 다시 계산한 뒤 안마다 등급을 매긴다. 규칙은 web/src/lib/result/banban-index.ts와 같아야 한다.

    python3 prototype/banban_index.py                       # 표(마크다운)
    python3 prototype/banban_index.py --fact-cases 30000    # 사실 문장 안의 무작위 입력과 기대 문장(JSONL, 웹 규칙 대조용)
    python3 prototype/banban_index.py --layer-cases 30000   # 두 층·막대 안의 무작위 입력과 기대 문장(JSONL, 웹 규칙 대조용)
    python3 prototype/banban_index.py --check-server http://localhost:PORT   # 1위가 로컬 서버 /v1/recommend와 같은지
"""

from __future__ import annotations

import argparse
import json
import math
import random
import struct
import time
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "data" / "artifacts" / "dev"
BASE32 = "0123456789abcdefghjkmnpqrstvwxyz"
UNREACHABLE = 0xFFFF
SAMPLES = 2000
SEED = 202

EVEN, NEAR, BEST_HERE, TILTED = "딱 반반", "거의 반반", "이 조합에선 가장 반반", "조금 기울었어요"
GRADES = (EVEN, NEAR, BEST_HERE, TILTED)
# 그룹 최선과 비교할 때 볼 후보: 1위보다 가장 오래 걸리는 시간이 이만큼(분)까지 긴 곳.
FLOOR_WINDOW = 10
# 1위의 값이 그 후보들 중 가장 좋은 값보다 이만큼(분) 이내면 '이 조합에선 가장 반반'.
FLOOR_SLACK = 2


def code_of(value: int) -> str:
    return "".join(BASE32[(value >> shift) & 31] for shift in (10, 5, 0))


def load_od() -> tuple[list[str], list[str], list[int]]:
    raw = (ARTIFACTS / "od.bin").read_bytes()
    magic, _, header, _, _, n, m, _ = struct.unpack("<4sHHIIIIQ", raw[:32])
    assert magic == b"BBOD"
    at = header
    origins = struct.unpack(f"<{n}H", raw[at : at + 2 * n])
    at += 2 * n
    candidates = struct.unpack(f"<{m}H", raw[at : at + 2 * m])
    at += 2 * m
    seconds = list(struct.unpack(f"<{n * m}H", raw[at : at + 2 * n * m]))
    return [code_of(v) for v in origins], [code_of(v) for v in candidates], seconds


def display_minutes(seconds: int) -> int:
    return (seconds + 30) // 60


def spread(minutes: list[int]) -> int:
    return max(minutes) - min(minutes)


def top_two_gap(minutes: list[int]) -> int:
    ordered = sorted(minutes, reverse=True)
    return ordered[0] - ordered[1]


def ratio(minutes: list[int]) -> float:
    """화면의 백분율(반올림, JS Math.round와 같은 half-up)로 등급을 정한다."""
    return 1.0 if max(minutes) == 0 else math.floor(min(minutes) / max(minutes) * 100 + 0.5) / 100


# 안마다 (값, 딱 반반 문턱, 거의 반반 문턱, 작을수록 좋은지).
PLANS = {
    "A 차이": (spread, 2, 6, True),
    "B 가장 오래 걸리는 두 사람": (top_two_gap, 2, 6, True),
    "C 최단/최장 비율": (ratio, 0.9, 0.75, False),
}


def grade(plan: str, top: list[int], others: list[list[int]]) -> str:
    measure, even, near, lower_better = PLANS[plan]
    value = measure(top)
    good = (lambda v, t: v <= t) if lower_better else (lambda v, t: v >= t)
    if good(value, even):
        return EVEN
    if good(value, near):
        return NEAR
    window = [measure(o) for o in others if max(o) <= max(top) + FLOOR_WINDOW]
    best = min([value, *window]) if lower_better else max([value, *window])
    slack = FLOOR_SLACK if lower_better else FLOOR_SLACK / max(1, max(top))
    close = value <= best + slack if lower_better else value >= best - slack
    return BEST_HERE if close else TILTED


# 사실 문장 안(bbi=fact|factcap): 화면에 보이는 분(걸리는 시간)의 차이(최장 − 최단)가 두 사람 2분, 세 사람 이상 6분 안이면 한 문장, 아니면 문장 없음.
FACT_PAIR = 2
FACT_GROUP = 6


def format_minutes(minutes: int) -> str:
    hours, rest = divmod(minutes, 60)
    if hours == 0:
        return f"{rest}분"
    return f"{hours}시간" if rest == 0 else f"{hours}시간 {rest}분"


def fact_sentence(plan: str, top: list[int]) -> str | None:
    """web/src/lib/result/banban-index.ts factSentence와 같다. plan은 'fact'(실제 차이) 또는 'factcap'(여러 명은 문턱)."""
    pair = len(top) == 2
    limit = FACT_PAIR if pair else FACT_GROUP
    gap = spread(top)
    if gap > limit:
        return None
    who = "두 사람 " if pair else "모두 "
    if gap == 0:
        return f"걸리는 시간이 {who}같아요"
    shown = limit if plan == "factcap" and not pair else gap
    return f"걸리는 시간이 {who}{format_minutes(shown)}{' 차이예요' if pair else ' 차이 안이에요'}"


def layer_sentences(plan: str, top: list[int]) -> dict:
    """web/src/lib/result/banban-index.ts의 두 층(layer|layerwhy)과 막대(bars). 기본 층은 늘, 강조 층은 사실 문장(fact) 규칙일 때만."""
    emphasis = fact_sentence("fact", top)
    if plan == "bars":
        return {"emphasis": emphasis}
    if plan == "layer":
        base = f"가장 오래 걸리는 사람도 {format_minutes(max(top))}이에요"
    else:
        base = "가장 오래 걸리는 사람 기준으로 가장 가까운 역이에요"
    return {"base": base, "emphasis": emphasis}


# 지도 한가운데 비교 문장(#68, server MapMiddle.kt): 출발역 좌표 평균점에서 가장 가까운, 모두가 갈 수 있는 후보가 1위와 다르고
# 그 역의 최장(표시 분)이 1위보다 5분 이상 길 때만 보인다.
MIDDLE_MIN_EXTRA = 5


def even_title(top: list[int]) -> bool:
    """지금 있는 '완벽한 반반'(map-middle.ts evenTitle): 2명 1분 이하, 3~4명 2분 이하."""
    return spread(top) <= (1 if len(top) <= 2 else 2)


def haversine_km(a: dict, b: dict) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lng"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


class Data:
    def __init__(self) -> None:
        self.origins, self.candidates, self.seconds = load_od()
        stations = json.loads((ARTIFACTS / "stations.json").read_text())["stations"]
        self.station = {s["code"]: s for s in stations}

    def ranked(self, people: list[int]) -> list[tuple[int, int, int, str, list[int]]]:
        """공평 순위 전체: (최장 초, 차이 초, 합계 초, 코드, 사람별 표시 분)."""
        m = len(self.candidates)
        rows = []
        for c, code in enumerate(self.candidates):
            cell = [self.seconds[p * m + c] for p in people]
            if UNREACHABLE in cell:
                continue
            rows.append((max(cell), max(cell) - min(cell), sum(cell), code, [display_minutes(s) for s in cell]))
        rows.sort()
        return rows

    def map_middle_shows(self, people: list[int], top_code: str, top_max_seconds: int) -> bool:
        """server MapMiddlePicker.pick과 같은 조건. 거리는 평균 위도의 cos로 경도를 눌러 잰 평면 거리, 같으면 역 코드가 앞선 쪽."""
        points = [self.station[self.origins[p]] for p in people]
        n = len(points)
        lats = [round(pt["lat"] * 1_000_000) for pt in points]
        lngs = [round(pt["lng"] * 1_000_000) for pt in points]
        squeeze = math.cos(sum(lats) / n / 1_000_000 * math.pi / 180)
        m = len(self.candidates)
        best = None
        for c, code in enumerate(self.candidates):
            cell = [self.seconds[p * m + c] for p in people]
            station = self.station.get(code)
            if UNREACHABLE in cell or station is None:
                continue
            d_lat = n * round(station["lat"] * 1_000_000) - sum(lats)
            d_lng = (n * round(station["lng"] * 1_000_000) - sum(lngs)) * squeeze
            key = (d_lat * d_lat + d_lng * d_lng, code)
            if best is None or key < best[0]:
                best = (key, code, max(cell))
        if best is None or best[1] == top_code:
            return False
        return display_minutes(best[2]) - display_minutes(top_max_seconds) >= MIDDLE_MIN_EXTRA

    def km(self, a: int, b: int) -> float:
        return haversine_km(self.station[self.origins[a]], self.station[self.origins[b]])


def sampler(data: Data, kind: str, rng: random.Random):
    n_origins = len(data.origins)

    def pick(n: int) -> list[int] | None:
        if kind == "고르게":
            return rng.sample(range(n_origins), n)
        center = rng.randrange(n_origins)
        near = [i for i in range(n_origins) if data.km(i, center) <= 8]
        if kind == "가까이(8km 안)":
            return rng.sample(near, n) if len(near) >= n else None
        far = [i for i in range(n_origins) if data.km(i, center) >= 30]
        if len(near) < n - 1 or not far:
            return None
        return [*rng.sample(near, n - 1), rng.choice(far)]

    return pick


KINDS = ("고르게", "가까이(8km 안)", "한 명만 멀리(30km 밖)")


def table() -> str:
    data = Data()
    rng = random.Random(SEED)
    out = [
        f"dev 산출물 {len(data.origins)}개 출발역 × {len(data.candidates)}개 후보(평일 낮), 조합마다 {SAMPLES}개, seed {SEED}.",
        "칸은 1위 카드에 붙는 등급의 비율(%): 딱 반반 / 거의 반반 / 이 조합에선 가장 반반 / 조금 기울었어요.",
        "'전체'는 모든 후보로 그룹 최선을 본 값(서버가 계산할 때), '3곳'은 응답에 오는 1~3위만 본 값(이 시안의 웹 계산)이다.",
        "딱 반반·거의 반반 비율은 둘이 같고, 낮은 두 등급의 나뉨만 다르다.",
        "",
        "| 인원 | 조합 | 지금 '완벽한 반반' | " + " | ".join(f"{p} (전체 / 3곳)" for p in PLANS) + " |",
        "|---|---|---|" + "---|" * len(PLANS),
    ]
    examples: list[str] = []
    fact_rows: list[str] = []
    middle_rows: list[str] = []
    for n in (2, 3, 4):
        for kind in KINDS:
            pick = sampler(data, kind, rng)
            counts = {p: Counter() for p in PLANS}
            visible = {p: Counter() for p in PLANS}
            title = 0
            total = 0
            gaps: Counter = Counter()
            middle = 0
            middle_and_emphasis = 0
            emphasis = 0
            while total < SAMPLES:
                people = pick(n)
                if people is None:
                    continue
                rows = data.ranked(people)
                if not rows:
                    continue
                total += 1
                top, others = rows[0][4], [r[4] for r in rows[1:]]
                for p in PLANS:
                    counts[p][grade(p, top, others)] += 1
                for p in PLANS:
                    visible[p][grade(p, top, others[:2])] += 1
                title += even_title(top)
                gaps[spread(top)] += 1
                shows = data.map_middle_shows(people, rows[0][3], rows[0][0])
                has_emphasis = fact_sentence("fact", top) is not None
                middle += shows
                emphasis += has_emphasis
                middle_and_emphasis += shows and has_emphasis
                if n >= 3 and kind == "한 명만 멀리(30km 밖)" and len(examples) < 6 and top_two_gap(top) >= 10:
                    names = [data.station[data.origins[i]]["name"] for i in people]
                    meet = data.station[rows[0][3]]["name"]
                    examples.append(f"- {n}명 {' · '.join(names)} → {meet} {top}분")

            def cell(c: Counter) -> str:
                return " / ".join(str(round(100 * c[g] / total)) for g in GRADES)

            b = counts["B 가장 오래 걸리는 두 사람"]
            limit = FACT_PAIR if n == 2 else FACT_GROUP

            def within(k: int) -> int:
                return round(100 * sum(v for g, v in gaps.items() if g <= k) / total)

            steps = (1, 2, 3, 4) if n == 2 else (2, 4, 6, 8, 10)
            fact_rows.append(
                f"| {n} | {kind} | {round(100 * (b[EVEN] + b[NEAR]) / total)} | {round(100 * b[EVEN] / total)} | "
                f"**{within(limit)}** | " + " / ".join(str(within(k)) for k in steps) + " |"
            )
            middle_rows.append(
                f"| {n} | {kind} | 100 | {round(100 * emphasis / total)} | **{round(100 * middle / total)}** | "
                f"{round(100 * middle_and_emphasis / total)} |"
            )
            out.append(
                f"| {n} | {kind} | {round(100 * title / total)} | "
                + " | ".join(f"{cell(counts[p])}<br>{cell(visible[p])}" for p in PLANS)
                + " |"
            )
    out += ["", "B가 낮은 등급을 받은 3~4명 '한 명만 멀리' 조합 예:", *examples]
    out += [
        "",
        "사실 문장 안(같은 표본): 1위 카드에 문장이 붙는 비율(%). 문장은 1위 시간만 보므로 '전체'와 '3곳'이 같다.",
        "마지막 칸은 표시 분 차이(최장 − 최단)가 그 분 이하인 비율로, 문턱을 바꿀 때의 붙는 비율이다(2명 1/2/3/4분, 3명 이상 2/4/6/8/10분).",
        "",
        "| 인원 | 조합 | B '딱+거의' | B '딱' | fact 문장 붙음 (2명 2분 · 3명+ 6분) | 문턱을 바꾸면 |",
        "|---|---|---|---|---|---|",
        *fact_rows,
    ]
    out += [
        "",
        "두 층 안(같은 표본): 공평 1위 카드에 붙는 비율(%). 기본 층은 늘, 강조 층은 fact 규칙(2명 2분 · 3명+ 6분)일 때만 붙는다.",
        "'지도 한가운데 문장'은 서버 규칙(MapMiddle.kt: 평균점에서 가장 가까운 후보가 1위와 다르고 최장이 5분 이상 김)으로 다시 계산했다.",
        "숨긴 참가자는 없다고 본다(있으면 둘 다 꺼진다).",
        "",
        "| 인원 | 조합 | 기본 층 | 강조 층 | 지도 한가운데 문장 | 강조 층과 지도 문장이 함께 |",
        "|---|---|---|---|---|---|",
        *middle_rows,
    ]
    return "\n".join(out)


def fact_cases(count: int) -> None:
    """웹 규칙 대조용 무작위 입력. 작은 차이가 자주 나오게 기준 분에 0~12분을 더한다."""
    rng = random.Random(SEED + 2)
    for _ in range(count):
        n = rng.choice((2, 3, 4))
        base = rng.randrange(0, 130)
        top = [base + rng.randrange(0, rng.choice((3, 8, 13))) for _ in range(n)]
        plan = rng.choice(("fact", "factcap"))
        print(json.dumps({"plan": plan, "top": top, "sentence": fact_sentence(plan, top)}, ensure_ascii=False))


def layer_cases(count: int) -> None:
    """웹 규칙 대조용 무작위 입력(두 층·막대). 1시간이 넘는 최장과 작은 차이가 함께 나오게 한다."""
    rng = random.Random(SEED + 3)
    for _ in range(count):
        n = rng.choice((2, 3, 4))
        base = rng.randrange(0, 150)
        top = [base + rng.randrange(0, rng.choice((3, 8, 13, 40))) for _ in range(n)]
        plan = rng.choice(("layer", "layerwhy", "bars"))
        print(json.dumps({"plan": plan, "top": top, **layer_sentences(plan, top)}, ensure_ascii=False))


def check_server(base: str, count: int, pause: float) -> None:
    data = Data()
    rng = random.Random(SEED + 1)
    same = 0
    middle_same = 0
    middle_shown = 0
    for i in range(count):
        n = 2 + i % 3
        people = rng.sample(range(len(data.origins)), n)
        rows = data.ranked(people)
        if not rows:
            continue
        body = json.dumps({"origins": [data.origins[p] for p in people], "mode": "fair"}).encode()
        request = urllib.request.Request(
            f"{base}/v1/recommend", data=body, headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(request) as response:
            result = json.load(response)
        time.sleep(pause)
        first = result["candidates"][0]
        server_minutes = [display_minutes(t["seconds"]) for t in first["times"]]
        ok = first["stationCode"] == rows[0][3] and server_minutes == rows[0][4]
        same += ok
        if not ok:
            print("다름", [data.origins[p] for p in people], first["stationCode"], rows[0][3])
        mine = data.map_middle_shows(people, rows[0][3], rows[0][0])
        middle_same += mine == ("mapMiddle" in result)
        middle_shown += "mapMiddle" in result
        if mine != ("mapMiddle" in result):
            print("지도 한가운데 다름", [data.origins[p] for p in people], mine, result.get("mapMiddle"))
    print(f"서버 1위와 같음: {same}/{count}")
    print(f"지도 한가운데 문장 유무가 서버와 같음: {middle_same}/{count} (서버가 문장을 준 조합 {middle_shown})")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-server")
    parser.add_argument("--count", type=int, default=60)
    parser.add_argument("--pause", type=float, default=0.0, help="요청 사이 초(로컬 요청 제한 안에서 많이 볼 때)")
    parser.add_argument("--fact-cases", type=int)
    parser.add_argument("--layer-cases", type=int)
    args = parser.parse_args()
    if args.fact_cases:
        fact_cases(args.fact_cases)
    elif args.layer_cases:
        layer_cases(args.layer_cases)
    elif args.check_server:
        check_server(args.check_server.rstrip("/"), args.count, args.pause)
    else:
        print(table())


if __name__ == "__main__":
    main()
