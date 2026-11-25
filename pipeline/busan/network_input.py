"""Prepare source-verified M1 station order and numbered trains for the Kotlin graph."""

from collections import defaultdict

from comparison import join_stations
from timetable import BGL, BUSAN_LINES, DAY_SECONDS, DONGHAE


def ordered_stations(joined):
    lines = defaultdict(list)
    for (line, name), (order, code) in joined.items():
        lines[line].append((order, name, code))
    result = {}
    for line, entries in sorted(lines.items()):
        entries.sort()
        if [order for order, _, _ in entries] != list(range(1, len(entries) + 1)):
            raise ValueError(f"M1: {line} station order has duplicates or gaps")
        if len({code for _, _, code in entries}) != len(entries):
            raise ValueError(f"M1: {line} reuses a registry code")
        result[line] = [(name, code) for _, name, code in entries]
    return result


def service_seconds(value):
    return value + DAY_SECONDS if value is not None and value < 3 * 3600 else value


def train_record(train, index):
    missing = [stop.name for stop in train.stops if stop.name not in index]
    if missing:
        raise ValueError(f"{train.line} train {train.number}: stations absent from M1: {missing}")
    positions = [index[stop.name] for stop in train.stops]
    steps = {b - a for a, b in zip(positions, positions[1:])}
    if steps not in ({1}, {-1}):
        raise ValueError(f"{train.line} train {train.number}: non-adjacent or reversed stops")
    return {
        "number": train.number,
        "day": train.day,
        "stops": [[i, service_seconds(s.arrival), service_seconds(s.departure)]
                  for i, s in zip(positions, train.stops)],
    }


def network_input(m1, registry, b1, k1):
    ordered = ordered_stations(join_stations(m1, registry))
    if ordered.keys() != BUSAN_LINES:
        raise ValueError(f"M1: expected all six Busan lines, found {list(ordered)}")
    trains = defaultdict(list)
    for train in b1.trains:
        trains[train.line].append(train)
    for train in k1.trains:
        if train.line in (BGL, DONGHAE):
            trains[train.line].append(train)

    lines = {}
    for line, stations in ordered.items():
        indexes = {name: i for i, (name, _) in enumerate(stations)}
        lines[line] = {
            "stations": [{"code": code, "name": name} for name, code in stations],
            "trains": [train_record(train, indexes) for train in sorted(trains[line], key=lambda train: train.key)],
        }
    return {"region": "busan", "lines": lines}
