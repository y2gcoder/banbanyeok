"""Busan source diagnostics, independent of the published artifact pipeline."""

from collections import defaultdict
from statistics import median

from timetable import BGL, DAY_SECONDS, DONGHAE, METRO_LINES, station_name

M1_LINES = {
    **{("부산교통공사", f"{number}호선"): line for line, number in METRO_LINES.items()},
    ("코레일", "동해"): DONGHAE,
    ("부산김해경전철주식회사", "부산김해경전철"): BGL,
}


def join_regions(rows, registry):
    return {code: "busan" for _, code in join_stations(rows, registry).values()}


def join_stations(rows, registry):
    """Join M1 line/station names to stable registry codes, retaining the M1 line order."""
    expected = {}
    for station in registry["stations"]:
        if station["status"] != "active":
            continue
        for namespace, source in station["sources"].items():
            if not namespace.startswith("kric:"):
                continue
            _, line, _ = source.rsplit(":", 2)
            if line in M1_LINES.values():
                key = line, station_name(line, station["name"])
                if key in expected:
                    raise ValueError(f"ambiguous registry station {key}")
                expected[key] = station["code"]

    if not expected:
        raise ValueError("M1: no active Busan registry stations")
    matched = set()
    result = {}
    unmatched = []
    for region_code, region, operator, name, order, station in rows:
        line = M1_LINES.get((operator, name))
        if line is None and region != "부산":
            continue
        if (region_code, region) != ("02", "부산"):
            raise ValueError(f"M1: unexpected region for {operator} {name} {station}: {region_code} {region}")
        key = line, station_name(line, station)
        if key in matched:
            raise ValueError(f"M1: duplicate station {name} {station}")
        matched.add(key)
        if key in expected:
            result[key] = (int(order), expected[key])
        else:
            unmatched.append(f"{operator} {name} {station}")

    missing = [f"{expected[key]} {key[0]} {key[1]}" for key in sorted(expected.keys() - matched)]
    if unmatched or missing:
        raise ValueError(f"M1 join incomplete: registry-only {missing}, M1-only {unmatched}")
    return result


def stats(values):
    return {
        "median_seconds": median(values) if values else None,
        "min_seconds": min(values) if values else None,
        "max_seconds": max(values) if values else None,
    }


def compare_runtime(trains, b2_rows, *, aliases):
    """Reproduce §2.1 with raw names, or include the two 2호선 pairs resolved by the alias."""
    by_line = defaultdict(list)
    operator_lines = {number: line for line, number in METRO_LINES.items()}
    for _, number, station_id, name, duration, *_ in b2_rows:
        minutes, seconds = duration.split(":")
        if not (len(minutes) == len(seconds) == 2 and 0 <= int(seconds) < 60 and int(minutes) >= 0):
            raise ValueError(f"B2: invalid MM:SS {duration!r}")
        line = operator_lines[number]
        by_line[line].append((int(station_id), station_name(line, name) if aliases else name,
                              int(minutes) * 60 + int(seconds)))

    arrival, departure = defaultdict(list), defaultdict(list)
    for train in trains:
        if train.day != "weekday":
            continue
        for a, b in zip(train.stops, train.stops[1:]):
            key = train.line, a.name if aliases else a.raw_name, b.name if aliases else b.raw_name
            if a.departure is not None and b.arrival is not None:
                arrival[key].append((b.arrival - a.departure) % DAY_SECONDS)
            if a.departure is not None and b.departure is not None:
                departure[key].append((b.departure - a.departure) % DAY_SECONDS)

    result = {}
    for line, stops in sorted(by_line.items()):
        ids = [station_id for station_id, *_ in stops]
        if ids != sorted(set(ids)):
            raise ValueError(f"B2: station IDs not increasing for {line}")
        pairs = [(line, a[1], b[1], b[2]) for a, b in zip(stops, stops[1:])]
        result[line] = {}
        for kind, samples in (("arrival", arrival), ("departure", departure)):
            values = [median(samples[l, a, b]) - baseline for l, a, b, baseline in pairs if (l, a, b) in samples]
            result[line][kind] = {"pairs": len(values), **stats(values)}
    return result


def departures(trains):
    return {
        (*train.key, stop.name): stop.departure
        for train in trains if train.line in METRO_LINES
        for stop in train.stops if stop.departure is not None
    }


def compare_departures(b1, k1):
    a, b = departures(b1), departures(k1)
    result = {}
    for line in METRO_LINES:
        left = {key for key in a if key[0] == line}
        right = {key for key in b if key[0] == line}
        # Nearest signed clock delta keeps a midnight crossing from looking like a 24-hour difference.
        values = [(a[key] - b[key] + DAY_SECONDS // 2) % DAY_SECONDS - DAY_SECONDS // 2 for key in left & right]
        if values or left or right:
            result[line] = {
                "matched_departures": len(values),
                "equal_departures": values.count(0),
                "b1_only": len(left - right),
                "k1_only": len(right - left),
                "delta_b1_minus_k1": stats(values),
            }
    return result
