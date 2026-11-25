"""반반지수 시안(#202)의 등급 분포표를 만든다. 버리는 조사 스크립트다.

dev 산출물(data/artifacts/dev/od.bin, 평일 낮)로 출발역 조합을 뽑고, 공평 순위(최장, 차이, 합계, 코드; 초 단위, 동점 폭 0)로
1위를 다시 계산한 뒤 안마다 등급을 매긴다. 규칙은 web/src/lib/result/banban-index.ts와 같아야 한다.

    python3 prototype/banban_index.py                       # 표(마크다운)
    python3 prototype/banban_index.py --check-server http://localhost:PORT   # 1위가 로컬 서버 /v1/recommend와 같은지
"""

from __future__ import annotations

import argparse
import json
import math
import random
import struct
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
    return 1.0 if max(minutes) == 0 else min(minutes) / max(minutes)


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
        "",
        "| 인원 | 조합 | 지금 '완벽한 반반' | " + " | ".join(f"{p} (전체)" for p in PLANS) + " | B (3곳) |",
        "|---|---|---|" + "---|" * (len(PLANS) + 1),
    ]
    examples: list[str] = []
    for n in (2, 3, 4):
        for kind in KINDS:
            pick = sampler(data, kind, rng)
            counts = {p: Counter() for p in PLANS}
            visible = Counter()
            title = 0
            total = 0
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
                visible[grade("B 가장 오래 걸리는 두 사람", top, others[:2])] += 1
                title += even_title(top)
                if kind == "한 명만 멀리(30km 밖)" and len(examples) < 6 and top_two_gap(top) >= 10:
                    names = [data.station[data.origins[i]]["name"] for i in people]
                    meet = data.station[rows[0][3]]["name"]
                    examples.append(f"- {n}명 {' · '.join(names)} → {meet} {top}분")

            def cell(c: Counter) -> str:
                return " / ".join(str(round(100 * c[g] / total)) for g in GRADES)

            out.append(
                f"| {n} | {kind} | {round(100 * title / total)} | "
                + " | ".join(cell(counts[p]) for p in PLANS)
                + f" | {cell(visible)} |"
            )
    out += ["", "B가 낮은 등급을 받은 '한 명만 멀리' 조합 예:", *examples]
    return "\n".join(out)


def check_server(base: str, count: int) -> None:
    data = Data()
    rng = random.Random(SEED + 1)
    same = 0
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
        first = result["candidates"][0]
        server_minutes = [display_minutes(t["seconds"]) for t in first["times"]]
        ok = first["stationCode"] == rows[0][3] and server_minutes == rows[0][4]
        same += ok
        if not ok:
            print("다름", [data.origins[p] for p in people], first["stationCode"], rows[0][3])
    print(f"서버 1위와 같음: {same}/{count}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-server")
    parser.add_argument("--count", type=int, default=60)
    args = parser.parse_args()
    if args.check_server:
        check_server(args.check_server.rstrip("/"), args.count)
    else:
        print(table())


if __name__ == "__main__":
    main()
