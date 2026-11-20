"""귀갓길 막차 표(#62)의 독립 오라클. 외부 의존성·네트워크 호출 없음.

파이프라인(Kotlin)과 따로 구현한 같은 규칙(contracts/data-format.md §10, docs/research/last-train-design-fable.md)으로 표를 다시
계산한다. 고정 입력(축, 노선 묶음 그래프, 역간 시간, 걷는 시간, 허용 노선)은 파이프라인이 쓴 build/last-train/problem.json에서
받고, 시간표 줄은 캐시에서 직접 읽는다. 쓰임은 두 가지다.

    # 실제 자료: 파이프라인의 lt.bin과 칸마다 대조한다(하나라도 다르면 종료 코드 1). 저장소 루트에서 실행한다.
    python3 -B prototype/last_train.py compare build/last-train/problem.json data/raw data/artifacts/dev/lt.bin

    # 장난감 픽스처(줄이 문제 파일 안에 있다): 기대 칸을 JSON으로 찍는다. 테스트가 이 출력과 커밋된 파일을 대조한다.
    python3 -B prototype/last_train.py expect pipeline/src/test/resources/last-train/toy.json
"""
import bisect
import collections
import heapq
import json
import struct
import sys
from pathlib import Path

CHAIN_FROM, BOARD_FROM, DAY_END = 19 * 3600, 20 * 3600, 27 * 3600
TOLERANCE, TERMINAL_EARLY, STITCH, ORIGIN_WINDOW = 90, 60, 45, 300
ALLOW_FLOOR, ALLOW_FACTOR, ALLOW_EXTRA = 600, 2, 300
DAYS = ("weekday", "saturday", "holiday")
UNKNOWN, DIRECT, MARGIN_TRANSFER, MARGIN_DIRECT = 0, 1, 2, 3
ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"


def seconds(value):
    t = str(value).strip().replace(":", "")
    if len(t) != 6 or not t.isdigit():
        return -1
    h, m, s = int(t[:2]), int(t[2:4]), int(t[4:])
    if h >= 27 or m >= 60 or s >= 60:
        return -1
    return ((h + 24 if h < 3 else h) * 60 + m) * 60 + s


def key_of(arrival, departure):
    return departure if departure >= 0 else arrival


class Problem:
    def __init__(self, data):
        self.homes, self.meetings = data["homes"], data["meetings"]
        self.graph = {}
        for group, edges in data["families"].items():
            adjacent = collections.defaultdict(set)
            for a, b in edges:
                adjacent[a].add(b)
                adjacent[b].add(a)
            self.graph[group] = adjacent
        self.stations = {sid: tuple(v) for sid, v in data["stations"].items()}  # sid -> (code, group)
        self.hops = {(a, b): s for a, b, s in data["hops"]}
        self.walks = {(c, a, b): s for c, a, b, s in data["walks"]}
        self.station_walks = data["stationWalks"]
        self.exact = {day: set(data["exact"].get(day, [])) for day in DAYS}
        self.allowed = data.get("allowed")
        self.distances = {}

    def closer(self, group, here, there, end):
        if end is None or end not in self.graph.get(group, {}):
            return False
        if (group, end) not in self.distances:
            seen, queue = {end: 0}, collections.deque([end])
            while queue:
                node = queue.popleft()
                for nxt in self.graph[group][node]:
                    if nxt not in seen:
                        seen[nxt] = seen[node] + 1
                        queue.append(nxt)
            self.distances[group, end] = seen
        d = self.distances[group, end]
        return here in d and there in d and d[there] < d[here]

    def allowance(self, code, origin, target):
        walk = self.walks.get((code, origin, target), self.station_walks.get(code, 0))
        return max(ALLOW_FLOOR, walk * ALLOW_FACTOR + ALLOW_EXTRA)


class Train:
    def __init__(self, group, end, stops):
        # stops: (code, arrival, departure, origin) in running order. A row is a stop a rider can leave at only when it
        # has an arrival, and one a rider can board at only when it has an arrival too or starts the run (origin).
        self.group, self.end, self.stops = group, end, stops

    @property
    def bound(self):
        return self.end or self.stops[-1][0]


def stop_order(stop):
    return key_of(stop[1], stop[2]), stop[0]


def chain_links(rows, neighbours, hops, allowed):
    """rows: station -> sorted distinct [(arrival, departure, end)]. Returns {(station, i): (next, j)}."""
    by_end = {}
    for station, found in rows.items():
        index = collections.defaultdict(list)
        for i, (arrival, departure, end) in enumerate(found):
            index[end].append((key_of(arrival, departure), i))
        by_end[station] = index

    def match(station, departure, end, nxt):
        hop, candidates = hops.get((station, nxt)), by_end.get(nxt, {}).get(end)
        if hop is None or not candidates:
            return None
        expected, best = departure + hop, None
        at = bisect.bisect_left(candidates, (expected - TOLERANCE - TERMINAL_EARLY, -1))
        while at < len(candidates) and candidates[at][0] <= expected + TOLERANCE:
            when, j = candidates[at]
            low = expected - TOLERANCE - (TERMINAL_EARLY if rows[nxt][j][1] < 0 else 0)
            if when >= low and (best is None or abs(when - expected) < best[0]):
                best = (abs(when - expected), nxt, j)
            at += 1
        return best

    found, votes = {}, collections.defaultdict(collections.Counter)
    for station in sorted(rows):
        for i, (arrival, departure, end) in enumerate(rows[station]):
            if departure < 0:
                continue
            options = [n for n in sorted(neighbours.get(station, ())) if allowed(station, end, n)]
            matches = [m for m in (match(station, departure, end, n) for n in options) if m]
            found[station, i] = matches
            for _gap, nxt, _j in matches:
                votes[station, end][nxt] += 1
    forward, taken = {}, {}
    for (station, i), matches in found.items():
        tally = votes[station, rows[station][i][2]]
        side = max(sorted(tally), key=lambda n: tally[n], default=None)
        best = next((m for m in matches if m[1] == side), None)
        if best is None:
            continue
        target = (best[1], best[2])
        if target in taken and taken[target][0] <= best[0]:
            continue
        if target in taken:
            del forward[taken[target][1]]
        taken[target] = (best[0], (station, i))
        forward[station, i] = target
    return forward, by_end


def rides(origin, target):
    boards = origin[2] >= 0 and (origin[1] >= 0 or origin[3])
    return boards and target[1] >= 0 and origin[2] >= BOARD_FROM and origin[0] != target[0] and origin[2] < target[1]


def clean_rows(rows):
    out = {}
    for station, found in rows.items():
        kept = {(a, d, e) for a, d, e in found if e and CHAIN_FROM <= key_of(a, d) < DAY_END}
        out[station] = sorted(kept, key=lambda r: (key_of(r[0], r[1]), r[0], r[1], r[2]))
    return out


def unnumbered_trains(problem, rows):
    rows = clean_rows({s: r for s, r in rows.items() if s in problem.stations})
    neighbours = collections.defaultdict(list)
    for a, b in problem.hops:
        neighbours[a].append(b)

    def allowed(station, end, nxt):
        if nxt not in problem.stations:
            return False
        code, group = problem.stations[station]
        end_code = problem.stations[end][0] if end in problem.stations else None
        return problem.closer(group, code, problem.stations[nxt][0], end_code)

    forward, by_end = chain_links(rows, neighbours, problem.hops, allowed)
    previous = collections.defaultdict(list)
    for a, b in problem.hops:
        previous[b].append(a)

    def starts_run(station, i):
        _arrival, departure, end = rows[station][i]
        for before in previous[station]:
            if not allowed(before, end, station):
                continue
            expected = departure - problem.hops[before, station]
            for when, j in by_end.get(before, {}).get(end, ()):
                if rows[before][j][1] >= 0 and abs(when - expected) <= ORIGIN_WINDOW:
                    return False
        return True

    trains = []
    for head in sorted(set(forward) - set(forward.values())):
        node, stops = head, []
        while node is not None:
            station, i = node
            arrival, departure, _end = rows[station][i]
            origin = node == head and arrival < 0 and starts_run(station, i)
            stops.append((problem.stations[station][0], arrival, departure, origin))
            node = forward.get(node)
        end = rows[head[0]][head[1]][2]
        trains.append(Train(problem.stations[head[0]][1], problem.stations[end][0] if end in problem.stations else None, stops))
    return trains


def numbered_trains(stops):
    """stops: (group, train id, code, arrival, departure, end code or None)."""
    runs = collections.defaultdict(set)
    meta = {}
    for group, train, code, arrival, departure, end in stops:
        if CHAIN_FROM <= key_of(arrival, departure) < DAY_END:
            runs[train].add((code, arrival, departure))
            meta.setdefault(train, (group, end))
    trains = []
    for t in sorted(runs):
        stops = sorted(runs[t], key=stop_order)
        trains.append(Train(meta[t][0], meta[t][1], [(*stop, i == 0) for i, stop in enumerate(stops)]))
    return trains


def stitch(numbered, chains):
    at = collections.defaultdict(list)
    for index, train in enumerate(numbered):
        if train.end is None:
            continue
        for code, _arrival, departure, _origin in train.stops:
            if departure >= 0:
                at[train.group, code, train.end].append((departure, index))
    for found in at.values():
        found.sort()
    alone, merged = [], {}
    for chain in chains:
        partner = None
        for code, _arrival, departure, _origin in (chain.stops[0], chain.stops[-1]):
            options = at.get((chain.group, code, chain.end), []) if chain.end is not None and departure >= 0 else []
            i = bisect.bisect_left(options, (departure - STITCH, -1))
            if i < len(options) and options[i][0] <= departure + STITCH:
                partner = options[i][1]
                break
        if partner is None:
            alone.append(chain)
            continue
        whole = merged.setdefault(partner, list(numbered[partner].stops))
        seen = {s[0] for s in whole}
        whole.extend(s for s in chain.stops if s[0] not in seen)
    joined = [Train(numbered[i].group, numbered[i].end, sorted(stops, key=stop_order)) for i, stops in sorted(merged.items())]
    return alone + joined + [t for i, t in enumerate(numbered) if i not in merged]


def direct_matrix(trains, homes, meetings):
    best = {}
    for train in trains:
        for to, target in enumerate(train.stops):
            if target[0] not in homes:
                continue
            for origin in train.stops[:to]:
                if origin[0] in meetings and rides(origin, target):
                    found = (origin[2], train.bound, train.group)
                    old = best.get((target[0], origin[0]))
                    if old is None or found[0] > old[0] or (found[0] == old[0] and found < old):
                        best[target[0], origin[0]] = found
    return best


def backward(problem, trains, arrivals, states_at, home):
    """Latest departure towards [home] per (station, family), by label setting from the largest value down."""
    best, scanned, reached, waiting = {}, collections.Counter(), collections.Counter(), collections.defaultdict(list)
    queue = []

    def board(t, origin_index, target_index):
        train = trains[t]
        origin, target = train.stops[origin_index], train.stops[target_index]
        if origin[2] < BOARD_FROM or origin[0] == home or not (origin[1] >= 0 or origin[3]):
            return True
        if origin_index >= target_index or not rides(origin, target):
            return False
        state = (origin[0], train.group)
        if origin[2] > best.get(state, -1):
            best[state] = origin[2]
            heapq.heappush(queue, (-origin[2], state))
        return True

    def scan(state, deadline):
        found = arrivals.get(state, [])
        while scanned[state] < len(found) and found[scanned[state]][0] <= deadline:
            _when, t, stop = found[scanned[state]]
            scanned[state] += 1
            waiting[t] = [i for i in waiting[t] if not board(t, i, stop)]
            for earlier in range(reached[t], stop):
                if not board(t, earlier, stop):
                    waiting[t].append(earlier)
            reached[t] = max(reached[t], stop)

    for group in states_at.get(home, ()):
        scan((home, group), DAY_END)
    while queue:
        negative, state = heapq.heappop(queue)
        if best[state] != -negative:
            continue
        code, group = state
        for origin in states_at[code]:
            scan((code, origin), -negative - problem.allowance(code, origin, group))
    return best


def day_cells(problem, day, trains):
    arrivals = collections.defaultdict(list)
    states_at = collections.defaultdict(list)
    for t, train in enumerate(trains):
        for i, stop in enumerate(train.stops):
            state = (stop[0], train.group)
            if train.group not in states_at[stop[0]]:
                states_at[stop[0]].append(train.group)
            if stop[1] >= 0:
                arrivals[state].append((stop[1], t, i))
    for found in arrivals.values():
        found.sort()
    homes, meetings = set(problem.homes), set(problem.meetings)
    direct = direct_matrix(trains, homes, meetings)
    cells = {}
    for home in problem.homes:
        best = backward(problem, trains, arrivals, states_at, home)
        for meeting in problem.meetings:
            if meeting == home:
                continue
            latest = max((best.get((meeting, g), -1) for g in states_at.get(meeting, ())), default=-1)
            if latest < 0:
                continue
            minute, single = latest // 60, direct.get((home, meeting))
            if single is None:
                cells[home, meeting] = (MARGIN_TRANSFER, minute, None)
                continue
            direct_minute, confirmed = single[0] // 60, single[2] in problem.exact[day]
            shown = direct_minute if confirmed else direct_minute - direct_minute % 10
            if minute - minute % 10 > shown:
                cells[home, meeting] = (MARGIN_TRANSFER, minute, None)
            else:
                cells[home, meeting] = (DIRECT if confirmed else MARGIN_DIRECT, direct_minute, single[1])
    return cells


def trains_of(problem, rows):
    return stitch(numbered_trains(rows["numbered"]), unnumbered_trains(problem, rows["unnumbered"]))


# ---- rows from the raw caches (real data) ----

def read_json(path):
    return json.loads(Path(path).read_bytes())


def cache_rows(problem, raw, registry, day):
    """Reads one day type's rows from the timetable caches, restricted to the allowed lines."""
    number = DAYS.index(day) + 1
    allowed = problem.allowed[day]
    unnumbered = collections.defaultdict(list)
    for path in sorted((raw / "tago/schedule").glob(f"*-0{number}-*-p*.json")):
        items = read_json(path)["response"]["body"]["items"]
        found = items.get("item", []) if items else []
        for row in [found] if isinstance(found, dict) else found:
            station = row["subwayStationId"]
            if station in problem.stations and problem.stations[station][1] in allowed["tagoGroups"]:
                unnumbered[station].append((seconds(row.get("arrTime")), seconds(row.get("depTime")), row.get("endSubwayStationId") or ""))
    stations = {s["code"]: s for s in registry if s["status"] == "active" and s["code"] in set(problem.homes)}
    by_name = collections.defaultdict(list)
    for code in sorted(stations):
        by_name[stations[code]["name"]].append(code)
        by_name[stations[code]["name"].split("(")[0].strip()].append(code)
    alias = {"이수": "총신대입구(이수)", "총신대입구": "총신대입구(이수)", "당고개": "불암산", "서울": "서울역"}

    def station_code(name, line):
        name = alias.get(name.split("(")[0].strip().removesuffix("역"), name.split("(")[0].strip().removesuffix("역"))
        source = 5 if (name, line) == ("까치산", "2") else line
        return next(c for c in by_name[name] if f"kric:서울교통공사:{source}호선" in stations[c]["sources"])

    def terminal(name, line):
        plain = name.split("(")[0].strip()
        options = by_name.get(name, []) + by_name.get(alias.get(plain.removesuffix("역"), plain), []) + by_name.get(plain, [])
        return next((c for c in options if c in problem.graph.get(line, {})), None)

    numbered = []
    for path in sorted((raw / "seoul/timetable").glob(f"*-{number}-*-p*.json")):
        for r in read_json(path).get("SearchSTNTimeTableByIDService", {}).get("row", []):
            line = str(int("".join(ch for ch in r["LINE_NUM"] if ch.isdigit())))
            if line not in allowed["seoulLines"]:
                continue
            arrival, departure = (seconds(r[k]) if r[k] != "00:00:00" else -1 for k in ("ARRIVETIME", "LEFTTIME"))
            train = "|".join(r[k] for k in ("LINE_NUM", "INOUT_TAG", "TRAIN_NO", "ORIGINSTATION", "DESTSTATION"))
            numbered.append((line, train, station_code(r["STATION_NM"], line), arrival, departure, terminal(r["SUBWAYENAME"], line)))
    return {"unnumbered": unnumbered, "numbered": numbered}


def embedded_rows(data, day):
    rows = data["rows"].get(day)
    if rows is None:
        return {"unnumbered": {}, "numbered": []}
    return {
        "unnumbered": {s: [tuple(r) for r in found] for s, found in rows["unnumbered"].items()},
        "numbered": [(g, t, c, a, d, e or None) for g, t, c, a, d, e in rows["numbered"]],
    }


def code_text(value):
    return "".join(ALPHABET[(value >> shift) & 31] for shift in (10, 5, 0))


def read_table(path):
    raw = Path(path).read_bytes()
    assert raw[:4] == b"BBLT", "not an lt.bin"
    version, header = struct.unpack_from("<HH", raw, 4)
    n, m = struct.unpack_from("<II", raw, 16)
    assert version == 1 and len(raw) == header + 2 * n + 2 * m + 15 * n * m
    codes = [code_text(v) for v in struct.unpack_from(f"<{n + m}H", raw, header)]
    homes, meetings = codes[:n], codes[n:]
    at, table = header + 2 * (n + m), {}
    for day in DAYS:
        minutes = struct.unpack_from(f"<{n * m}H", raw, at)
        kinds = struct.unpack_from(f"<{n * m}B", raw, at + 2 * n * m)
        bounds = struct.unpack_from(f"<{n * m}H", raw, at + 3 * n * m)
        at += 5 * n * m
        table[day] = {
            (homes[i // m], meetings[i % m]): (kinds[i], minutes[i], code_text(bounds[i]) if bounds[i] != 0xFFFF else None)
            for i in range(n * m) if kinds[i] != UNKNOWN
        }
    return homes, meetings, table


def compare(problem_path, raw, table_path):
    data = read_json(problem_path)
    problem = Problem(data)
    homes, meetings, table = read_table(table_path)
    assert homes == problem.homes and meetings == problem.meetings, "axes differ"
    registry = read_json("data/registry/stations.json")["stations"]
    different = 0
    for day in DAYS:
        trains = trains_of(problem, cache_rows(problem, Path(raw), registry, day))
        cells = day_cells(problem, day, trains)
        keys = set(cells) | set(table[day])
        wrong = [k for k in sorted(keys) if cells.get(k) != table[day].get(k)]
        kinds = collections.Counter(c[0] for c in cells.values())
        print(f"{day}: trains {len(trains)}, cells {len(cells)} (direct {kinds[DIRECT]}, margin-transfer"
              f" {kinds[MARGIN_TRANSFER]}, margin-direct {kinds[MARGIN_DIRECT]}), different from lt.bin {len(wrong)}")
        for k in wrong[:10]:
            print("   ", k, "oracle", cells.get(k), "lt.bin", table[day].get(k))
        different += len(wrong)
    print("SAME" if different == 0 else f"DIFFERENT: {different} cells")
    return 1 if different else 0


def expect(problem_path):
    data = read_json(problem_path)
    problem = Problem(data)
    out = {}
    for day in DAYS:
        cells = day_cells(problem, day, trains_of(problem, embedded_rows(data, day)))
        out[day] = [[home, meeting, *cell] for (home, meeting), cell in sorted(cells.items())]
    return out


def render(expected):
    return json.dumps(expected, ensure_ascii=False, indent=1) + "\n"


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "compare":
        sys.exit(compare(*sys.argv[2:]))
    if len(sys.argv) == 3 and sys.argv[1] == "expect":
        print(render(expect(sys.argv[2])), end="")
        sys.exit(0)
    sys.exit(__doc__)
