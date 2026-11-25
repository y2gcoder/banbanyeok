"""Normalize the Busan timetables for offline validation and comparison."""

import re
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

METRO_LINES = {"S2601": "1", "S2602": "2", "S2603": "3", "L2604": "4"}
DONGHAE = "I26K6"
BGL = "L48B1"
BUSAN_LINES = {*METRO_LINES, DONGHAE, BGL}
DAY_SECONDS = 24 * 60 * 60
CLOCK_TIME = re.compile(r"([01][0-9]|2[0-4]):([0-5][0-9])")
DONGHAE_ALIASES = {
    "거제해": "거제해맞이",
    "부교대": "교대",
    "부산원": "부산원동",
    "신해운": "신해운대",
    "오시리": "오시리아",
}


def station_name(line, value):
    name = value.partition("(")[0].strip().replace("·", ".")
    if line == "S2601" and name == "부산역":
        return "부산"
    if line == "S2602" and name == "국제금융.부산은행":
        return "국제금융센터.부산은행"
    if line == DONGHAE:
        return DONGHAE_ALIASES.get(name, name)
    return name


def day_type(line, value):
    if line == DONGHAE:
        days = {"평일": "weekday", "휴일": "holiday-unspecified"}
    elif line == BGL:
        days = {"평일+토요일+공휴일": "all-days"}
    else:
        days = {"평일": "weekday", "토요일": "saturday"}
        days.update({"일요일": "sunday"} if line == "L2604" else {"공휴일": "holiday"})
    if value not in days:
        raise ValueError(f"unsupported day {value!r}")
    return days[value]


def seconds(value):
    if value in ("", ":"):
        return None
    if match := CLOCK_TIME.fullmatch(value):
        hours, minutes = map(int, match.groups())
        return (hours * 3600 + minutes * 60) % DAY_SECONDS
    raise ValueError(f"invalid HH:MM {value!r}")


def excel_seconds(value):
    if value in ("", ":") or ":" in value:
        return seconds(value)
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?(?:[Ee][+-]?[0-9]+)?", value):
        raise ValueError(f"invalid Excel time {value!r}")
    fraction = Decimal(value)
    if not 0 <= fraction < 1:
        raise ValueError(f"invalid Excel time {value!r}")
    return round(fraction * DAY_SECONDS) % DAY_SECONDS


@dataclass(frozen=True)
class Stop:
    name: str
    raw_name: str
    arrival: Optional[int]
    departure: Optional[int]


@dataclass(frozen=True)
class Train:
    line: str
    day: str
    number: str
    stops: tuple

    @property
    def key(self):
        return self.line, self.day, self.number


@dataclass
class Timetable:
    trains: list = field(default_factory=list)
    defects: list = field(default_factory=list)

    def add(self, row, parse):
        number, line, _, _, _, _, raw_day = row[:7]
        try:
            day = day_type(line, raw_day)
            if not number:
                raise ValueError("missing train number")
            stops = parse(line)
            validate_stops(stops)
            self.trains.append(Train(line, day, number, tuple(stops)))
        except ValueError as error:
            self.defects.append({"line": line, "day": raw_day, "train": number, "reason": str(error)})

    def reject_duplicates(self):
        groups = defaultdict(list)
        for train in self.trains:
            groups[train.key].append(train)
        self.trains = []
        for (line, day, number), trains in groups.items():
            if len(trains) == 1:
                self.trains.append(trains[0])
            else:
                self.defects.append({"line": line, "day": day, "train": number, "reason": "duplicate train"})


def numbered(value):
    result = {}
    for item in value.split("+") if value else ():
        prefix, sep, text = item.partition("-")
        if not sep or not prefix.isascii() or not prefix.isdecimal():
            raise ValueError(f"invalid stop ordinal {prefix!r}")
        ordinal = int(prefix)
        if ordinal <= 0 or ordinal in result:
            raise ValueError(f"invalid or duplicate stop ordinal {ordinal}")
        result[ordinal] = text
    return result


def wide_stops(row, line, *, strict):
    names, arrivals, departures = (numbered(value) for value in row[7:10])
    if list(names) != list(range(1, len(names) + 1)):
        raise ValueError("station ordinals must be consecutive and start at 1")
    if strict and (names.keys() != arrivals.keys() or names.keys() != departures.keys()):
        raise ValueError(f"station/arrival/departure counts or ordinals differ ({len(names)}/{len(arrivals)}/{len(departures)})")
    if (arrivals.keys() | departures.keys()) - names.keys():
        raise ValueError("time ordinal has no station")
    stops = [
        Stop(station_name(line, name), name, seconds(arrivals.get(i, "")), seconds(departures.get(i, "")))
        for i, name in names.items()
    ]
    if strict and any(a.departure is None or b.arrival is None for a, b in zip(stops, stops[1:])):
        raise ValueError("missing segment departure or arrival")
    return stops


def validate_stops(stops):
    if len(stops) < 2 or any(not stop.name for stop in stops):
        raise ValueError("missing stations")
    if len({stop.name for stop in stops}) != len(stops):
        raise ValueError("repeated station")
    for stop in stops[1:-1]:
        if stop.arrival is not None and stop.departure is not None:
            if (stop.departure - stop.arrival) % DAY_SECONDS > 3600:
                raise ValueError(f"implausible dwell at {stop.name}")
    for a, b in zip(stops, stops[1:]):
        end = b.arrival if b.arrival is not None else b.departure
        if a.departure is not None and end is not None and (end - a.departure) % DAY_SECONDS > 3600:
            raise ValueError(f"implausible running time {a.name} → {b.name}")


def parse_b1(rows):
    result = Timetable()
    for row in rows:
        if row[1] not in METRO_LINES:
            raise ValueError(f"B1: unsupported line {row[1]!r}")
        result.add(row, lambda line: wide_stops(row, line, strict=True))
    result.reject_duplicates()
    return result


def donghae_stops(rows):
    stops = [
        Stop(station_name(DONGHAE, row[7]), row[7], excel_seconds(row[8]), excel_seconds(row[9]))
        for row in rows
    ]
    start, end = (station_name(DONGHAE, value) for value in rows[0][3:5])
    if any(row[3:5] != rows[0][3:5] for row in rows) or (stops[0].name, stops[-1].name) != (start, end):
        raise ValueError("Donghae stop order disagrees with endpoints")
    return stops


def parse_k1(rows):
    result = Timetable()
    donghae = defaultdict(list)
    for row in rows:
        if row[1] == DONGHAE:
            donghae[row[6], row[0]].append(row)
        elif row[1] in BUSAN_LINES:
            result.add(row, lambda line: wide_stops(row, line, strict=False))
    for stops in donghae.values():
        result.add(stops[0], lambda _: donghae_stops(stops))
    result.reject_duplicates()
    return result
