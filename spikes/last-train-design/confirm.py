"""Offline design experiment for issue #62 (no network calls). Run from the repository root:

    python3 spikes/last-train-design/confirm.py <raw cache dir>

It rebuilds night trains from the cached timetables and answers three design questions:
1. How well can trains be rebuilt without train IDs (chain matching of station rows)? Seoul S5 has train IDs, so
   the rebuilt chains are scored against them.
2. How many last-train cells are direct / transfer / unknown per day type when only rebuilt (two-sided confirmed)
   rides are used, and how far do they move from the unconfirmed spike model?
3. How far does a conservative transfer allowance move the "leave by" time?
"""
import argparse
import bisect
import collections
import heapq
import json
import statistics
import struct
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("raw", type=Path)
parser.add_argument("--days", default="1,2,3")
args = parser.parse_args()

NIGHT = 20 * 3600  # rides boarding from 20:00 of the service day
CHAIN_FROM = 19 * 3600  # rows used to rebuild trains
END = 27 * 3600
TOLERANCE = 90  # seconds around the expected time at the next station
INVALID = -1


def read(path):
    return json.loads(Path(path).read_bytes())


def seconds(value):
    t = str(value).strip().replace(":", "")
    if len(t) != 6 or not t.isdigit():
        return INVALID
    h, m, s = int(t[:2]), int(t[2:4]), int(t[4:])
    if h >= 27 or m >= 60 or s >= 60:
        return INVALID
    return ((h + 24 if h < 3 else h) * 60 + m) * 60 + s


def axis():
    raw = Path("data/artifacts/dev/od.bin").read_bytes()
    n, m = struct.unpack_from("<II", raw, 16)
    alphabet = "0123456789abcdefghjkmnpqrstvwxyz"
    codes = ["".join(alphabet[(v >> shift) & 31] for shift in (10, 5, 0))
             for v in struct.unpack_from(f"<{n+m}H", raw, 32)]
    times = struct.unpack_from(f"<{n*m}H", raw, 32 + 2 * (n + m))
    return codes[:n], codes[n:], times


homes, meetings, od_seconds = axis()
home_index = {c: i for i, c in enumerate(homes)}
stations = {s["code"]: s for s in read("data/registry/stations.json")["stations"] if s["code"] in home_index}
by_name = collections.defaultdict(list)
tago = {}
for code, s in stations.items():
    by_name[s["name"]].append(code)
    for key, value in s["sources"].items():
        if key.startswith("tago:"):
            tago[value] = code
services = read("data/config/metro-lines.json")["services"]
edges = {}
for e in read("data/config/tago-report.json")["edges"]:
    a, b = (e[k].split()[0] for k in ("from", "to"))
    edges[a, b] = e["forward"]["seconds"]
    edges[b, a] = e["reverse"]["seconds"]
neighbours = collections.defaultdict(set)
group_of = {}
for service in services.values():
    ids = [s.split()[0] for s in service["stations"]]
    for sid in ids:
        group_of.setdefault(sid, service["group"])
    for a, b in zip(ids, ids[1:]):
        if (a, b) in edges:
            neighbours[a].add(b)
            neighbours[b].add(a)


def plain(name):
    return name.split("(")[0].strip()


def seoul_code(row):
    name = {"이수": "총신대입구(이수)", "총신대입구": "총신대입구(이수)"}.get(row["STATION_NM"], row["STATION_NM"])
    line = 5 if name == "까치산" else int(row["LINE_NUM"][:2])
    return next(c for c in by_name[name] if f"kric:서울교통공사:{line}호선" in stations[c]["sources"])


class Train:
    """One rebuilt run: stops are (time used for ordering, physical code, arrival, departure)."""

    def __init__(self, group, end_name):
        self.group, self.end_name, self.stops = group, end_name, []


def tago_rows(day):
    rows = collections.defaultdict(list)  # sid -> [(key time, arr, dep, end id, end name)]
    for path in sorted((args.raw / "tago/schedule").glob(f"*-0{day}-*-p*.json")):
        items = read(path)["response"]["body"]["items"]
        found = items.get("item", []) if items else []
        if isinstance(found, dict):
            found = [found]
        for row in found:
            sid = row["subwayStationId"]
            if sid not in tago:
                continue
            arr, dep = seconds(row.get("arrTime")), seconds(row.get("depTime"))
            # A single "0" or blanks mean "no value"; six zeros are a real midnight time.
            key = dep if dep >= 0 else arr
            if key < CHAIN_FROM:
                continue
            rows[sid].append((key, arr, dep, row.get("endSubwayStationId") or "", row.get("endSubwayStationNm") or ""))
    return {sid: sorted(set(found)) for sid, found in rows.items()}


def chain(rows, hop_seconds, adjacent, allowed):
    """Links each row to the row of the same train at the next station: same terminal, expected time ± tolerance.

    [allowed] says whether a neighbour lies on the terminal's side (line graph). Among allowed neighbours the one
    most rows of that (station, terminal) match wins, so a following train sitting at another neighbour at the
    expected time by coincidence is not linked.
    rows: station -> sorted [(key, arr, dep, end, end name)]. Returns {(station, row index): (next station, index)}.
    """
    by_end = {}
    for sid, found in rows.items():
        index = collections.defaultdict(list)
        for i, row in enumerate(found):
            index[row[3]].append((row[0], i))
        by_end[sid] = index

    def match(sid, dep, end, nxt):
        hop = hop_seconds.get((sid, nxt))
        candidates = by_end.get(nxt, {}).get(end)
        if hop is None or not candidates:
            return None
        expected, best = dep + hop, None
        at = bisect.bisect_left(candidates, (expected - TOLERANCE - 60, -1))
        while at < len(candidates) and candidates[at][0] <= expected + TOLERANCE:
            when, j = candidates[at]
            # The terminal row has an arrival only, which is earlier than the departure-based estimate.
            low = expected - TOLERANCE - (60 if rows[nxt][j][2] < 0 else 0)
            if when >= low and (best is None or abs(when - expected) < best[0]):
                best = (abs(when - expected), nxt, j)
            at += 1
        return best

    found_matches = {}
    votes = collections.defaultdict(collections.Counter)
    for sid, found in sorted(rows.items()):
        for i, (key, arr, dep, end, _name) in enumerate(found):
            if dep < 0 or not end:
                continue
            options = [nxt for nxt in sorted(adjacent[sid]) if allowed(sid, end, nxt)]
            matches = [m for m in (match(sid, dep, end, nxt) for nxt in options) if m]
            found_matches[sid, i] = matches
            for _gap, nxt, _j in matches:
                votes[sid, end][nxt] += 1
    forward, taken = {}, {}
    for (sid, i), matches in found_matches.items():
        end = rows[sid][i][3]
        side = max(sorted(votes[sid, end]), key=lambda n: votes[sid, end][n], default=None)
        best = next((m for m in matches if m[1] == side), None)
        if best is None:
            continue
        target = (best[1], best[2])
        if target in taken and taken[target][0] <= best[0]:
            continue
        if target in taken:
            del forward[taken[target][1]]
        taken[target] = (best[0], (sid, i))
        forward[sid, i] = target
    return forward


class Family:
    """Physical-station graph per line family, across both sources. A terminal's side is the neighbour that is
    strictly closer to it. A terminal that cannot be placed on the graph links nothing (fails to the safe side)."""

    def __init__(self):
        self.graph = collections.defaultdict(lambda: collections.defaultdict(set))
        self.distances = {}

    def add(self, group, a, b):
        if a != b:
            self.graph[group][a].add(b)
            self.graph[group][b].add(a)

    def distance(self, group, end):
        if (group, end) not in self.distances:
            seen, queue = {end: 0}, collections.deque([end])
            while queue:
                node = queue.popleft()
                for nxt in self.graph[group][node]:
                    if nxt not in seen:
                        seen[nxt] = seen[node] + 1
                        queue.append(nxt)
            self.distances[group, end] = seen
        return self.distances[group, end]

    def closer(self, group, here, there, end):
        if end is None or end not in self.graph[group]:
            return False
        d = self.distance(group, end)
        return here in d and there in d and d[there] < d[here]

    def named(self, group, name):
        options = [c for c in by_name.get(name, []) + by_name.get(plain(name), []) if c in self.graph[group]]
        return options[0] if options else None


family = Family()
for service in services.values():
    ids = [s.split()[0] for s in service["stations"]]
    for a, b in zip(ids, ids[1:]):
        if (a, b) in edges and a in tago and b in tago:
            family.add(service["group"], tago[a], tago[b])


def tago_trains(rows):
    def allowed(sid, end, nxt):
        group = group_of[sid]
        return family.closer(group, tago[sid], tago[nxt], tago.get(end))

    forward = chain(rows, edges, neighbours, allowed)
    heads = set(forward) - set(forward.values())
    trains = []
    for start in sorted(heads):
        sid, i = start
        train = Train(group_of[sid], plain(rows[sid][i][4]))
        node = start
        while node is not None:
            sid, i = node
            key, arr, dep, _end, _name = rows[sid][i]
            train.stops.append((key, tago[sid], arr, dep, sid))
            node = forward.get(node)
        trains.append(train)
    linked = set(forward) | set(forward.values())
    lonely = sum(1 for sid, found in rows.items() for i, r in enumerate(found) if (sid, i) not in linked and r[0] >= NIGHT)
    broken, moving = collections.Counter(), collections.Counter()
    for sid, found in rows.items():
        for i, r in enumerate(found):
            if r[0] >= NIGHT and r[2] >= 0 and r[3] and r[3] != sid:
                moving[group_of[sid]] += 1
                broken[group_of[sid]] += (sid, i) not in forward
    print("  departures without a next-station match by line family:",
          {g: f"{broken[g]}/{moving[g]}" for g in sorted(moving)})
    total = sum(1 for found in rows.values() for r in found if r[0] >= NIGHT)
    return trains, lonely, total


def seoul_rows(day):
    for path in sorted((args.raw / "seoul/timetable").glob(f"*-{day}-*-p*.json")):
        found = read(path).get("SearchSTNTimeTableByIDService", {}).get("row", [])
        if not found:
            continue
        code = seoul_code(found[0])
        for r in found:
            arr, dep = [seconds(r[k]) if r[k] != "00:00:00" else INVALID for k in ("ARRIVETIME", "LEFTTIME")]
            if max(arr, dep) >= CHAIN_FROM:
                yield code, r, arr, dep


def seoul_trains(day):
    runs = {}
    for code, r, arr, dep in seoul_rows(day):
        key = tuple(r[k] for k in ("LINE_NUM", "INOUT_TAG", "TRAIN_NO", "ORIGINSTATION", "DESTSTATION"))
        train = runs.setdefault(key, Train(str(int(r["LINE_NUM"][:2])), plain(r["SUBWAYENAME"])))
        train.stops.append((max(arr, dep), code, arr, dep, r["STATION_CD"]))
    for train in runs.values():
        train.stops.sort()
    return runs


def stitch(seoul, rebuilt):
    """Joins a rebuilt TAGO chain to the Seoul train it continues as: same line family, same terminal name, same
    physical station, departures within 45 s. Through trains (Jinjeop, Ilsan, Ansan lines) cross the data sources."""
    at = collections.defaultdict(list)
    for train in seoul:
        for key, code, _arr, dep, _sid in train.stops:
            if dep >= 0:
                at[train.group, code, train.end_name].append((dep, train))
    for found in at.values():
        found.sort(key=lambda x: x[0])
    joined, merged = [], {}
    for chain_train in rebuilt:
        partner = None
        for key, code, _arr, dep, _sid in (chain_train.stops[0], chain_train.stops[-1]):
            options = at.get((chain_train.group, code, chain_train.end_name), [])
            i = bisect.bisect_left(options, (dep - 45,), key=lambda x: (x[0],))
            if dep >= 0 and i < len(options) and options[i][0] <= dep + 45:
                partner = options[i][1]
                break
        if partner is None:
            joined.append(chain_train)
            continue
        # Several chains can belong to one Seoul train (one on each side of the Seoul section, or broken pieces).
        whole = merged.get(id(partner))
        if whole is None:
            whole = merged[id(partner)] = Train(partner.group, partner.end_name)
            whole.stops = list(partner.stops)
        seen = {s[1] for s in whole.stops}
        whole.stops = sorted(whole.stops + [s for s in chain_train.stops if s[1] not in seen])
    return joined + list(merged.values()) + [t for t in seoul if id(t) not in merged], len(merged)


def rides_of(trains):
    rides = collections.defaultdict(set)
    for train in trains:
        previous = []
        for _key, code, arr, dep, _sid in train.stops:
            reach = arr if arr >= 0 else dep  # no arrival published: the departure is the conservative arrival
            for origin, left in previous:
                if origin != code and left < reach:
                    rides[origin, code].add((reach, left))
            if dep >= NIGHT:
                previous.append((code, dep))
    return rides


def spike_rides(day):
    """The unconfirmed spike model for TAGO lines: every departure is assumed to stop at every station up to its
    terminal, travel times are summed median edges (copied from spikes/last-train/measure.py at ad3c0d0)."""
    rides = collections.defaultdict(set)
    schedules = collections.defaultdict(set)
    for sid, found in tago_rows(day).items():
        for _key, _arr, dep, end, _name in found:
            if dep >= NIGHT and end:
                schedules[sid].add((dep, end))
    for route in services.values():
        ids = [s.split()[0] for s in route["stations"]]
        pos = {sid: i for i, sid in enumerate(ids)}
        for i, sid in enumerate(ids):
            for dep, end in schedules[sid]:
                if end not in pos or i == pos[end]:
                    continue
                sign = 1 if pos[end] > i else -1
                arrival = dep
                for j in range(i + sign, pos[end] + sign, sign):
                    edge = ids[j - sign], ids[j]
                    if edge not in edges or ids[j] not in tago:
                        break
                    arrival += edges[edge]
                    rides[tago[sid], tago[ids[j]]].add((arrival, dep))
    return rides


def graph_of(rides):
    graph = collections.defaultdict(list)
    for (a, b), events in rides.items():
        times, latest = [], []
        for arrival, dep in sorted(events):
            if not latest or latest[-1] < dep:
                times.append(arrival)
                latest.append(dep)
        graph[b].append((a, times, latest))
    return graph


def reverse(graph, home, walk):
    best = {home: (END, 0)}
    queue = [(-END, 0, home)]
    while queue:
        neg, count, node = heapq.heappop(queue)
        if best[node] != (-neg, count):
            continue
        deadline = -neg - (walk if count else 0)
        for origin, arrival, departures in graph[node]:
            idx = bisect.bisect_right(arrival, deadline) - 1
            if idx < 0:
                continue
            dep = departures[idx]
            old, legs = best.get(origin, (-1, 0))
            if dep > old or (dep == old and count + 1 < legs):
                best[origin] = dep, count + 1
                heapq.heappush(queue, (-dep, count + 1, origin))
    return best


def matrix(graph, walk):
    out = {}
    for h in homes:
        result = reverse(graph, h, walk)
        for s in meetings:
            if s != h and s in result:
                out[h, s] = result[s]
    return out


def direct_matrix(rides):
    return {(h, s): max(dep for _arr, dep in events) for (s, h), events in rides.items()
            if s in meeting_set and h in home_index and s != h}


def quantiles(values):
    if not values:
        return "n=0"
    values = sorted(values)
    pick = lambda q: values[min(len(values) - 1, int(q * len(values)))]
    return f"n={len(values)} min={values[0]} p50={pick(.5)} p90={pick(.9)} p99={pick(.99)} max={values[-1]}"


def clock(sec):
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}"


meeting_set = set(meetings)
meeting_index = {c: i for i, c in enumerate(meetings)}
cells = len(homes) * len(meetings) - len(meetings)


def hidden_id_check(day):
    """Scores chain matching on Seoul S5 with the train numbers hidden. Hop times are the median of true hops, which
    stands in for the D1 edge estimator (validated separately against S3)."""
    truth = seoul_trains(day)
    rows = collections.defaultdict(list)
    owner = {}
    hops = collections.defaultdict(list)
    adjacent = collections.defaultdict(set)
    for key, train in truth.items():
        for (_k1, _c1, _a1, d1, s1), (k2, _c2, a2, d2, s2) in zip(train.stops, train.stops[1:]):
            if d1 >= 0:
                hops[s1, s2].append((d2 if d2 >= 0 else a2) - d1)
                adjacent[s1].add(s2)
    # A pair seen only a few times is a train with missing rows in between, not a real neighbour.
    busiest = collections.Counter()
    for (a, _b), v in hops.items():
        busiest[a] = max(busiest[a], len(v))
    hop = {pair: statistics.median(v) for pair, v in hops.items() if len(v) >= max(3, busiest[pair[0]] // 10)}
    adjacent = collections.defaultdict(set)
    for a, b in hop:
        adjacent[a].add(b)
    code_of, group_at = {}, {}
    for key, train in truth.items():
        group = str(int(key[0][:2]))
        end_code = family.named(group, train.end_name)
        for k, code, arr, dep, sid in train.stops:
            # Line 2 is a loop: both directions share a terminal name, so its direction tag joins the key. No line
            # without train IDs (TAGO) is a loop.
            row = (k, arr, dep, (key[0], end_code, key[1] if key[0] == "02호선" else ""), train.end_name)
            rows[sid].append(row)
            owner[sid, row] = key
            code_of[sid], group_at[sid] = code, group
    rows = {sid: sorted(set(found), key=lambda r: (r[0], r[1], r[2], str(r[3]))) for sid, found in rows.items()}

    def allowed(sid, end, nxt):
        if end[0] == "02호선":
            return True  # loop: the shorter way round is not always the train's way; real data has train IDs here
        return family.closer(group_at[sid], code_of[sid], code_of[nxt], end[1])

    forward = chain(rows, hop, adjacent, allowed)
    good = bad = 0
    wrong_by_line = collections.Counter()
    for (sid, i), (nxt, j) in forward.items():
        a, b = owner.get((sid, rows[sid][i])), owner.get((nxt, rows[nxt][j]))
        if rows[sid][i][0] < NIGHT:
            continue
        good += a == b
        bad += a != b
        if a != b:
            wrong_by_line[a[0]] += 1
    print("  wrong links by line:", dict(wrong_by_line))
    true_links = sum(1 for t in truth.values() for s1, s2 in zip(t.stops, t.stops[1:]) if s1[3] >= NIGHT)
    # Last direct departure per pair: rebuilt chains against true trains.
    rebuilt = []
    for start in sorted(set(forward) - set(forward.values())):
        train, node = Train("", ""), start
        while node is not None:
            sid, i = node
            k, arr, dep, _e, _n = rows[sid][i]
            train.stops.append((k, sid, arr, dep, sid))
            node = forward.get(node)
        rebuilt.append(train)
    for t in truth.values():
        t.stops = [(k, sid, arr, dep, sid) for k, _code, arr, dep, sid in t.stops]
    want = {pair: max(d for _a, d in ev) for pair, ev in rides_of(truth.values()).items()}
    got = {pair: max(d for _a, d in ev) for pair, ev in rides_of(rebuilt).items()}
    loop = {sid for sid, g in group_at.items() if g == "2"}
    for label, keep in (("lines 1,3-8", lambda p: p[0] not in loop), ("line 2 (loop)", lambda p: p[0] in loop)):
        late = [(got[p] - want[p]) // 60 for p in got if keep(p) and p in want and got[p] > want[p]]
        phantom = [p for p in got if keep(p) and p not in want]
        early = [(want[p] - got[p]) // 60 for p in want if keep(p) and p in got and got[p] < want[p]]
        missing = [p for p in want if keep(p) and p not in got]
        total = sum(1 for p in want if keep(p))
        print(f"hidden-id day {day} {label}: pairs {total}, same {sum(1 for p in want if keep(p) and got.get(p) == want[p])},"
              f" late {len(late)} ({quantiles(late)}), phantom {len(phantom)},"
              f" early {len(early)} ({quantiles(early)}), missing {len(missing)}")
    print(f"hidden-id day {day}: links right {good}, wrong {bad}, true {true_links}")


# Seoul lines join the family graph from their own trains (all day types). The pipeline would use its curated
# network instead; here a pair seen rarely is treated as a train with missing rows, not a real neighbour.
pair_counts = collections.Counter()
for d in (1, 2, 3):
    for train in seoul_trains(d).values():
        for s1, s2 in zip(train.stops, train.stops[1:]):
            pair_counts[train.group, s1[1], s2[1]] += 1
busy = collections.Counter()
for (group, a, _b), n in pair_counts.items():
    busy[group, a] = max(busy[group, a], n)
for (group, a, b), n in pair_counts.items():
    # 30%: a real branch (Gangdong on line 5) splits roughly in half; trains with missing rows stay far below.
    if n >= max(3, busy[group, a] * 3 // 10):
        family.add(group, a, b)

for day in (int(d) for d in args.days.split(",")):
    hidden_id_check(day)
    rows = tago_rows(day)
    rebuilt, lonely, total = tago_trains(rows)
    seoul = list(seoul_trains(day).values())
    trains, joins = stitch(seoul, rebuilt)
    print(f"day {day}: TAGO stations with rows {len(rows)}, night rows {total}, unlinked {lonely},"
          f" chains {len(rebuilt)}, Seoul trains {len(seoul)}, stitched {joins}")
    confirmed = rides_of(trains)
    loose = spike_rides(day)
    for (a, b), events in rides_of(seoul).items():
        loose[a, b] |= events
    direct = direct_matrix(confirmed)
    loose_direct = direct_matrix(loose)
    both = [k for k in direct if k in loose_direct]
    print(f"  direct cells: confirmed {len(direct)}, spike {len(loose_direct)}, only confirmed"
          f" {len(direct) - len(both)}, only spike {len(loose_direct) - len(both)}")
    later = [(loose_direct[k] - direct[k]) // 60 for k in both if loose_direct[k] > direct[k]]
    earlier = [(direct[k] - loose_direct[k]) // 60 for k in both if loose_direct[k] < direct[k]]
    print(f"  spike later than confirmed (min): {quantiles(later)}")
    print(f"  spike earlier than confirmed (min): {quantiles(earlier)}")
    graph = graph_of(confirmed)
    optimistic = matrix(graph_of(loose), 360)
    models = {walk: matrix(graph, walk) for walk in (360, 600, 900)}
    safe = models[600]
    kinds = collections.Counter()
    near = collections.Counter()
    for h in homes:
        for s in meetings:
            if s == h:
                continue
            d, x = direct.get((h, s)), safe.get((h, s), (None,))[0]
            kind = "none" if d is None and x is None else "direct" if x is None or (d is not None and d >= x) else "transfer"
            kinds[kind] += 1
            if od_seconds[home_index[h] * len(meetings) + meeting_index[s]] <= 3600:
                near[kind] += 1
    print(f"  cells of {cells}: {dict(kinds)}; within 60 min by od.bin: {dict(near)}")
    for walk, model in models.items():
        common = [k for k in model if k in optimistic]
        shift = [(optimistic[k][0] - model[k][0]) // 60 for k in common]
        late = sum(1 for k in common if model[k][0] > optimistic[k][0])
        print(f"  walk {walk}s confirmed vs spike 360s: cells {len(model)}, common {len(common)},"
              f" confirmed later in {late}; spike minus confirmed (min) {quantiles(shift)}")
    gap = [(models[360][k][0] - models[900][k][0]) // 60 for k in models[900] if models[900][k][1] > 1]
    print(f"  transfer cells, 360 s minus 900 s (min): {quantiles(gap)}")
    for s_name, h_name in (("강남", "광교"), ("신사", "정자"), ("당산", "언주"), ("봉은사", "개화"), ("부천", "판교"),
                           ("노원", "전대·에버랜드"), ("수원", "킨텍스"), ("시청", "동탄"), ("합정", "왕십리")):
        s = next(c for c in by_name[s_name] if c in meeting_set)
        h = by_name[h_name][0]
        d = direct.get((h, s))
        print("  sample", s_name, h_name, "direct", clock(d) if d else "-",
              *(f"walk{w}={clock(m[h, s][0])}/{m[h, s][1] - 1}" if (h, s) in m else f"walk{w}=-" for w, m in models.items()),
              "spike", clock(optimistic[h, s][0]) if (h, s) in optimistic else "-")
    sys.stdout.flush()
