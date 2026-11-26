"""Busan direct last trains (#180): the calculation sources checked cell by cell against the operators' tables.

A cell is (day type, line, meeting station S, home station H). Its value comes only from a source we may compute
with: the numbered B1 trains for 부산 1~4호선 and the TAGO rows for 동해선. The operators' tables (H1 for 1~4호선,
K2 for 동해선) are only compared with, and their files are never committed: a cell whose operator value differs is
switched off by the Kotlin build. `checks` writes `data/config/busan-last-train-checks.csv` (the source's value and
the verdict of each cell, no operator value) and the H1 and K2 receipts.
"""

import argparse
import csv
import glob
import io
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from network_input import network_input
from sources import (MANIFEST, NS, REGISTRY, atomic_write, json_text, read_cached, read_json, sha256,
                     validated_timetables)
from timetable import DAY_SECONDS, station_name

ROOT = Path(__file__).resolve().parents[2]
CONFIG = "data/config/busan-last-train.json"
CANDIDATES = "data/config/busan-candidates.csv"
TAGO_CACHE = "data/raw/tago-busan"
HEADER = ["day", "line", "meeting", "home", "time", "destination", "check"]
VERDICTS = ("agree", "differs", "origin", "missing", "ambiguous")
MAX_SHEET_BYTES = 64 * 1024**2
H1_SHEET = re.compile(r"([1-4])호선 ([평토휴])\(")
H1_LINES = {"1": "S2601", "2": "S2602", "3": "S2603", "4": "L2604"}
H1_NUMBER = ("열차번호", "열번")


def service_seconds(seconds):
    return seconds + DAY_SECONDS if seconds < 3 * 3600 else seconds


def day_fraction(value):
    """An Excel time of day as service seconds, or None when the cell holds no time."""
    text = value.strip()
    if not re.fullmatch(r"0?\.[0-9]+|0|[0-9]+\.[0-9]*(?:[Ee][+-]?[0-9]+)?", text):
        return None
    fraction = float(text)
    if not 0 <= fraction < 1 + 3 / 24:
        raise ValueError(f"time {value!r} is not a time of the service day")
    seconds = round(fraction * DAY_SECONDS)
    return service_seconds(seconds) if seconds < DAY_SECONDS else seconds


def clock(seconds):
    return f"{seconds // 3600:02d}:{seconds // 60 % 60:02d}:{seconds % 60:02d}"


def xlsx_sheets(raw):
    """Every sheet of an XLSX file as rows of cell strings, by sheet name."""
    rel = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        def part(name):
            entry = archive.getinfo(name)
            if entry.file_size > MAX_SHEET_BYTES:
                raise ValueError(f"oversized XLSX part {name}")
            return ET.fromstring(archive.read(entry))

        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(t.text or "" for t in item.iter(NS + "t")) for item in part("xl/sharedStrings.xml")]
        targets = {r.get("Id"): r.get("Target") for r in part("xl/_rels/workbook.xml.rels")}
        sheets = {}
        for sheet in part("xl/workbook.xml").find(NS + "sheets"):
            target = targets[sheet.get(rel)].lstrip("/")
            rows = []
            for row in part(target if target.startswith("xl/") else "xl/" + target).iter(NS + "row"):
                cells = {}
                for cell in row.findall(NS + "c"):
                    value = cell.find(NS + "v")
                    if cell.get("t") == "inlineStr":
                        text = "".join(t.text or "" for t in cell.iter(NS + "t"))
                    elif value is None:
                        continue
                    elif cell.get("t") == "s":
                        text = shared[int(value.text)]
                    else:
                        text = value.text or ""
                    letters = re.match(r"[A-Z]+", cell.get("r")).group()
                    column = 0
                    for letter in letters:
                        column = column * 26 + ord(letter) - 64
                    cells[column - 1] = text
                if cells:
                    rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
            sheets[sheet.get("name")] = rows
    return sheets


def h1_trains(sheets, lines, unknown_allowed):
    """H1 trains by (line, H1 day): each a list of (code, seconds) in time order. One time per station (arrival)."""
    result = defaultdict(list)
    unknown = Counter()
    for name, rows in sheets.items():
        match = H1_SHEET.match(name)
        if not match:
            continue
        line, day = H1_LINES[match.group(1)], match.group(2)
        codes = lines[line]
        header = None
        for row in rows:
            if row and row[0].strip() in H1_NUMBER:
                header = [cell.strip() for cell in row]
                starts = [i for i, cell in enumerate(header) if cell in H1_NUMBER] + [len(header)]
                continue
            if header is None:
                continue
            # The up and down blocks sit side by side: each block is read on its own (#217 §6).
            for start, end in zip(starts, starts[1:]):
                if start >= len(row) or not row[start].strip().isdigit():
                    continue
                stops = []
                for station, value in zip(header[start + 1:end], row[start + 1:end]):
                    seconds = day_fraction(value)
                    if seconds is None:
                        continue
                    station = station_name(line, station)
                    if station not in codes:
                        unknown[line, station] += 1
                        continue
                    stops.append((codes[station], seconds))
                if len(stops) >= 2:
                    result[line, day].append(sorted(stops, key=lambda stop: stop[1]))
    extra = {f"{line} {station}" for line, station in unknown} - set(unknown_allowed)
    if extra:
        raise ValueError(f"H1: stations absent from M1: {sorted(extra)}")
    return result


def k2_trains(sheets, codes):
    """K2 trains by K2 day (평일, 휴일): each a list of (code, arrival, departure) in running order."""
    result = defaultdict(list)
    for name, rows in sheets.items():
        day = name.split()[0]
        if len(rows) < 6 or rows[3][0].strip() != "열차번호":
            raise ValueError(f"K2 {name}: unexpected layout")
        numbers = [cell.strip() for cell in rows[3][1:]]
        stations = []
        i = 4
        while i < len(rows):
            station = station_name("I26K6", rows[i][0])
            departure = rows[i + 1] if i + 1 < len(rows) and not rows[i + 1][0].strip() else None
            if station not in codes:
                raise ValueError(f"K2 {name}: station {station!r} absent from M1")
            stations.append((codes[station], rows[i][1:], departure[1:] if departure else []))
            i += 2 if departure else 1
        for column, number in enumerate(numbers):
            if not number:
                continue
            stops = []
            for code, arrivals, departures in stations:
                arrival = day_fraction(arrivals[column]) if column < len(arrivals) else None
                departure = day_fraction(departures[column]) if column < len(departures) else None
                if arrival is not None or departure is not None:
                    stops.append((code, arrival, departure))
            if len(stops) >= 2:
                result[day].append(stops)
    return result


def latest(candidates):
    """The latest boarding among (board, value) pairs; 'ambiguous' when trains boarding together disagree."""
    if not candidates:
        return None
    board = max(board for board, _ in candidates)
    values = {value for b, value in candidates if b == board}
    return values.pop() if len(values) == 1 else "ambiguous"


def numbered_directs(trains, board_at, value_at):
    """(S, H) → the value of the train boarding latest at S that stops at H later, from trains of stops."""
    pairs = defaultdict(list)
    for stops in trains:
        for i, stop in enumerate(stops[:-1]):
            board = board_at(stop)
            if board is None:
                continue
            value = value_at(stops, i)
            for home in stops[i + 1:]:
                pairs[stop[0], home[0]].append((board, value))
    return {pair: latest(candidates) for pair, candidates in pairs.items()}


def b1_directs(trains):
    """B1 (network input) trains: value (arrival at S, or departure where S has none; terminus; S is its first stop)."""
    def value(stops, i):
        _, arrival, departure = stops[i]
        return arrival if arrival is not None else departure, stops[-1][0], i == 0

    return numbered_directs(trains, lambda stop: stop[2], value)


def h1_directs(trains):
    return numbered_directs(trains, lambda stop: stop[1],
                            lambda stops, i: (stops[i][1], stops[-1][0], i == 0))


def k2_directs(trains):
    return numbered_directs(trains, lambda stop: stop[2],
                            lambda stops, i: (stops[i][2], stops[-1][0], i == 0))


def tago_directs(rows, order):
    """TAGO rows at each station (departure, terminus code): the latest one whose terminus is at or beyond H."""
    position = {code: i for i, code in enumerate(order)}
    result = {}
    for meeting, departures in rows.items():
        for home in order:
            if home == meeting:
                continue
            forward = position[home] > position[meeting]
            reach = [(departure, (departure, end, False)) for departure, end in departures
                     if (position[end] >= position[home] if forward else position[end] <= position[home])]
            if reach:
                result[meeting, home] = latest(reach)
    return result


def tago_rows(root, prefix, day, order_names):
    """TAGO departures of one line and day by M1 code: {code: {(departure seconds, terminus code)}}."""
    def key(name):
        return re.sub(r"[.· ]", "", name.split("(")[0])

    stations = {}
    for page in sorted(glob.glob(str(root / TAGO_CACHE / "stations" / "*.json"))):
        items = json.loads(Path(page).read_text(encoding="utf-8"))["response"]["body"]["items"]["item"]
        for item in items if isinstance(items, list) else [items]:
            if item["subwayStationId"].startswith(prefix):
                stations[item["subwayStationId"]] = order_names[key(item["subwayStationName"])]
    if set(stations.values()) != set(order_names.values()):
        raise ValueError(f"TAGO {prefix}: stations differ from M1")
    rows = defaultdict(set)
    for page in sorted(glob.glob(str(root / TAGO_CACHE / "schedule" / f"{prefix.lower()}*-{day}-*.json"))):
        items = json.loads(Path(page).read_text(encoding="utf-8"))["response"]["body"].get("items") or {}
        items = items.get("item", []) if isinstance(items, dict) else []
        for item in items if isinstance(items, list) else [items]:
            departure = item.get("depTime") or ""
            if not re.fullmatch(r"[0-9]{6}", departure):
                continue
            seconds = int(departure[:2]) * 3600 + int(departure[2:4]) * 60 + int(departure[4:])
            end = stations.get(item.get("endSubwayStationId") or "")
            if end is None:
                continue
            rows[stations[item["subwayStationId"]]].add((service_seconds(seconds % DAY_SECONDS), end))
    return rows


def verdict(source, operator, compare_minute):
    if source is None or operator is None:
        return "missing"
    if "ambiguous" in (source, operator):
        return "ambiguous"
    if compare_minute and (source[2] or operator[2]):
        return "origin"
    same_time = source[0] // 60 == operator[0] // 60 if compare_minute else source[0] == operator[0]
    return "agree" if same_time and source[1] == operator[1] else "differs"


def check_rows(config, lines, candidates, h1, tago, k2):
    """One row per configured (day, line, S ∈ candidates on the line, H on the line, H ≠ S)."""
    rows = []
    for line, rule in sorted(config["lines"].items()):
        stations = [station["code"] for station in lines[line]["stations"]]
        numbered = config["operatorTables"][rule["check"]]["source"] == "B1"
        for day, sources in rule["days"].items():
            if numbered:
                source = b1_directs([train["stops"] for train in lines[line]["trains"]
                                     if train["day"] == sources["source"]])
                source = {(stations[s], stations[h]): value if value == "ambiguous" else
                          (value[0], stations[value[1]], value[2]) for (s, h), value in source.items()}
                operator = h1_directs(h1[line, sources["check"]])
            else:
                source = tago_directs(tago[sources["source"]], stations)
                operator = k2_directs(k2[sources["check"]])
            for meeting in sorted(set(stations) & candidates):
                for home in sorted(set(stations) - {meeting}):
                    value = source.get((meeting, home))
                    result = verdict(value, operator.get((meeting, home)), numbered)
                    known = value not in (None, "ambiguous")
                    rows.append([day, line, meeting, home, clock(value[0]) if known else "",
                                 value[1] if known else "", result])
    return rows


def csv_text(rows):
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(HEADER)
    writer.writerows(rows)
    return out.getvalue()


def candidate_codes(root):
    with open(root / CANDIDATES, encoding="utf-8", newline="") as file:
        return {row["code"] for row in csv.DictReader(file)}


def operator_file(root, table, rule):
    raw = (root / rule["file"]).read_bytes()
    if sha256(raw) != rule["sha256"]:
        raise ValueError(f"{table}: {rule['file']} is not the reviewed file (SHA-256 differs); "
                         f"a person must review the new file and update {CONFIG}")
    return raw


def checks(root):
    config = read_json(root / CONFIG)
    rows = read_cached(root)
    lines = network_input(rows["M1"], read_json(root / REGISTRY), *validated_timetables(rows))["lines"]
    codes = {line: {station["name"]: station["code"] for station in data["stations"]} for line, data in lines.items()}
    tables = config["operatorTables"]
    raws = {table: operator_file(root, table, rule) for table, rule in tables.items()}
    h1 = h1_trains(xlsx_sheets(raws["H1"]), codes, tables["H1"]["unmappedStations"])
    k2 = k2_trains(xlsx_sheets(raws["K2"]), codes["I26K6"])
    donghae = {re.sub(r"[.· ]", "", station["name"]): station["code"] for station in lines["I26K6"]["stations"]}
    tago = {day: tago_rows(root, "MTRKRK6", day, donghae)
            for day in {sources["source"] for sources in config["lines"]["I26K6"]["days"].values()}}
    result = check_rows(config, lines, candidate_codes(root), h1, tago, k2)
    text = csv_text(result)
    receipts = {receipt["id"]: receipt for receipt in read_json(root / MANIFEST)}
    new = [{
        "id": table,
        "file": rule["file"],
        "source_url": rule["url"],
        "request_body": None,
        "fetched_at": rule["reviewedOn"],
        "effective_date": rule["effectiveFrom"],
        "estimated": False,
        "sha256": rule["sha256"],
        "bytes": len(raws[table]),
        "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "rows": sum(1 for row in result if row[1] in rule["lines"]),
        "license": rule["license"],
        "use": "check-only; not committed, not a calculation input",
        "checks_file": config["checks"],
        "checks_sha256": sha256(text.encode()),
        "checked_against": {rule["source"]: receipts[rule["source"]]["sha256"]},
    } for table, rule in sorted(tables.items())]
    manifest = [receipt for receipt in read_json(root / MANIFEST) if receipt["id"] not in tables] + new
    atomic_write(root / config["checks"], text.encode())
    atomic_write(root / MANIFEST, json_text(manifest).encode())
    return summary(result)


def summary(rows):
    counts = defaultdict(Counter)
    for day, line, _, _, _, _, result in rows:
        counts[f"{line} {day}"][result] += 1
    return {key: dict(sorted(value.items())) for key, value in sorted(counts.items())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("checks",))
    parser.parse_args()
    try:
        result = checks(ROOT)
    except (OSError, ValueError, KeyError, ET.ParseError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Busan last trains: {error}\n")
    print(json_text(result), end="")


if __name__ == "__main__":
    main()
