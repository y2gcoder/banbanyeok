"""Fetch public Busan sources, record provenance, and reproduce offline diagnostics."""

import argparse
import csv
import hashlib
import io
import json
import re
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from comparison import compare_departures, compare_runtime, join_regions
from network_input import network_input
from timetable import BUSAN_LINES, METRO_LINES, day_types, parse_b1, parse_k1

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = "data/config/source-manifest.json"
REGISTRY = "data/registry/stations.json"
MAX_DOWNLOAD = 30 * 1024 * 1024
CELL_ROW_SUFFIX = re.compile(r"[0-9]+$")
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
TIMETABLE_HEADER = (
    "열차번호 노선번호 노선명 운행구간기점명 운행구간종점명 운행유형 요일구분 "
    "운행구간정거장 정거장도착시각 정거장출발시각 운행속도 운영기관전화번호 데이터기준일자"
).split()
K1_JUNE_30_SHA256 = "218f76dd53c4b9e1f248a8e07ab6879763495958714ee377761944e40cd94bc4"
K1_HEADER = TIMETABLE_HEADER[:9] + ["정가장출발시각"] + TIMETABLE_HEADER[10:]


@dataclass(frozen=True)
class Source:
    id: str
    portal_id: str
    url: str
    header: list
    effective_date: str = ""

    @property
    def file(self):
        return f"data/raw/busan/{self.id}.{'xlsx' if self.id == 'K1' else 'csv'}"


def portal_file(file_id):
    return f"https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_{file_id}&fileDetailSn=1"


SOURCES = (
    Source("B1", "15082980", portal_file("000000003680384"), TIMETABLE_HEADER),
    Source("B2", "3033564", portal_file("000000003113886"),
           "연번 호선 역번호 역명 소요시간(분) 역간거리(km) 호선별누계(km)".split(), "2025-03-25"),
    Source("K1", "15093878", "https://data.kric.go.kr/rips/dataset/download.file?type=filedata&id=900&operation=1",
           K1_HEADER),
    Source("M1", "15122916", portal_file("000000003561913"),
           "권역 권역명 철도운영기관명 노선명 순번 역명".split(), "2025-12-11"),
)


def csv_rows(raw):
    encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
    try:
        text = raw.decode(encoding)
    except UnicodeDecodeError:
        if encoding != "utf-8-sig":
            raise
        text = raw.decode("cp949")
    return csv.reader(io.StringIO(text, newline=""), strict=True)


def xml_items(archive, name, parent, child, limit):
    """Read only the specified XLSX part, dropping XML rows as they are consumed."""
    entry = archive.getinfo(name)
    if entry.file_size > limit:
        raise ValueError(f"K1: oversized XLSX part {name}")
    with archive.open(entry) as data:
        stack = []
        for event, element in ET.iterparse(data, events=("start", "end")):
            if event == "start":
                stack.append(element)
                continue
            if len(stack) > 1 and stack[-2].tag == NS + parent and element.tag == NS + child:
                yield element
                stack[-2].remove(element)
            stack.pop()


def cell_value(cell, shared):
    value = cell.findtext(NS + "v", "")
    if cell.get("t") == "s":
        index = int(value)
        if not 0 <= index < len(shared):
            raise ValueError("K1: invalid shared string index")
        return shared[index]
    if cell.get("t") == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(NS + "t"))
    return value


def xlsx_rows(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared = ["".join(node.text or "" for node in item.iter(NS + "t"))
                      for item in xml_items(archive, "xl/sharedStrings.xml", "sst", "si", 20 * 1024**2)]
        columns = {chr(ord("A") + i): i for i in range(len(K1_HEADER))}
        for row in xml_items(archive, "xl/worksheets/sheet1.xml", "sheetData", "row", 200 * 1024**2):
            values = [""] * len(columns)
            for cell in row.findall(NS + "c"):
                column = CELL_ROW_SUFFIX.sub("", cell.attrib["r"])
                if column not in columns:
                    if cell.find(NS + "v") is not None or cell.find(NS + "is") is not None:
                        raise ValueError(f"K1: unexpected XLSX column {column}")
                    continue
                values[columns[column]] = cell_value(cell, shared).strip()
            if any(values):
                yield values


def read_source(source, raw):
    if len(raw) > MAX_DOWNLOAD:
        raise ValueError(f"{source.id}: download exceeds size limit")
    records = xlsx_rows(raw) if source.id == "K1" else csv_rows(raw)
    with_header = iter(records)
    header = next(with_header, [])
    if header != source.header:
        raise ValueError(f"{source.id}: unexpected header {header!r}")

    rows = []
    total = 0
    for number, row in enumerate(with_header, 2):
        if not row or not any(row):
            continue
        if len(row) != len(header):
            raise ValueError(f"{source.id}: wrong width on row {number}")
        total += 1
        if source.id != "K1" or row[1] in BUSAN_LINES:
            rows.append([value.strip() for value in row])
    if not rows:
        raise ValueError(f"{source.id}: no scoped rows")
    return rows, total


def source_date(value):
    if re.fullmatch(r"[0-9]{5}", value):
        return (date(1899, 12, 30) + timedelta(days=int(value))).isoformat()
    if re.fullmatch(r"[0-9]{8}", value):
        return datetime.strptime(value, "%Y%m%d").date().isoformat()
    return date.fromisoformat(value).isoformat()


def source_dates(source, rows):
    if source.effective_date:
        return source.effective_date, {}
    lines = defaultdict(set)
    for row in rows:
        lines[row[1]].add(source_date(row[12]))
    dates = {line: sorted(values) for line, values in sorted(lines.items())}
    unique = set().union(*lines.values())
    return (next(iter(unique)) if len(unique) == 1 else "mixed; see effective_dates_by_line"), dates


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def json_text(value):
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def atomic_write(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = tempfile.NamedTemporaryFile(dir=path.parent, delete=False)
    temporary = Path(staged.name)
    try:
        with staged:
            staged.write(raw)
        if path.exists():
            temporary.chmod(path.stat().st_mode & 0o777)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def download(source):
    with urllib.request.urlopen(source.url, timeout=90) as response:
        content_type = response.headers.get_content_type()
        if content_type not in {"application/octet-stream", "application/vnd.ms-excel", "text/csv",
                                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}:
            raise ValueError(f"{source.id}: unexpected Content-Type {content_type}")
        return response.read(MAX_DOWNLOAD + 1), content_type


def fetch(root):
    cached = {}
    rows_by_id = {}
    receipts = {}
    for source in SOURCES:
        raw, content_type = download(source)
        rows, count = read_source(source, raw)
        effective_date, dates_by_line = source_dates(source, rows)
        receipt = {
            "id": source.id,
            "file": source.file,
            "source_url": source.url,
            "request_body": None,
            "fetched_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "effective_date": effective_date,
            "estimated": False,
            "sha256": sha256(raw),
            "bytes": len(raw),
            "content_type": content_type,
            "rows": count,
            "license": f"이용허락범위 제한 없음 (data.go.kr/{source.portal_id})",
        }
        if dates_by_line:
            receipt["effective_dates_by_line"] = dates_by_line
        if source.id == "K1":
            receipt["busan_rows"] = len(rows)
            if receipt["sha256"] == K1_JUNE_30_SHA256:
                receipt["edition_note"] = (
                    "수집한 KRIC 판(_20260630)과 포털 판(_20260625)이 다름. "
                    "이용조건은 공공데이터포털 표기를 따름."
                )
        cached[source.file] = raw
        rows_by_id[source.id] = rows
        receipts[source.id] = receipt

    # Validate every scoped source and the M1 join before replacing any previous input.
    report = diagnose(root, rows_by_id)
    manifest_path = root / MANIFEST
    existing = read_json(manifest_path)
    previous = {receipt["id"]: receipt for receipt in existing}
    for key, receipt in receipts.items():
        old = previous.get(key)
        if old and all(old.get(field) == value for field, value in receipt.items() if field not in {"fetched_at", "edition_note"}):
            receipt["fetched_at"] = old["fetched_at"]
    for file, raw in cached.items():
        atomic_write(root / file, raw)
    combined = [receipt for receipt in existing if receipt["id"] not in receipts] + list(receipts.values())
    atomic_write(manifest_path, json_text(combined).encode())
    return report


def read_cached(root):
    receipts = {receipt["id"]: receipt for receipt in read_json(root / MANIFEST)}
    result = {}
    for source in SOURCES:
        raw = (root / source.file).read_bytes()
        if sha256(raw) != receipts.get(source.id, {}).get("sha256"):
            raise ValueError(f"{source.id}: SHA-256 does not match the source receipt")
        result[source.id], _ = read_source(source, raw)
    return result


def timetable_report(timetable):
    counts = defaultdict(Counter)
    for train in timetable.trains:
        counts[train.line][train.day] += 1
    return {"trains": dict(counts), "defect_count": len(timetable.defects), "defects": timetable.defects}


def validate_timetable(source, timetable, lines, *, max_defects):
    defects = len(timetable.defects)
    if defects > max_defects:
        raise ValueError(f"{source}: {defects} defective trains exceed limit of {max_defects}")
    expected = {(line, day) for line in lines for day in day_types(line).values()}
    observed = {(train.line, train.day) for train in timetable.trains}
    missing = sorted(expected - observed)
    if missing:
        pairs = ", ".join(f"{line}/{day}" for line, day in missing)
        raise ValueError(f"{source}: no valid trains for {pairs}")


def diagnose(root, rows):
    b1, k1 = validated_timetables(rows)
    regions = join_regions(rows["M1"], read_json(root / REGISTRY))
    return {
        "b1": timetable_report(b1),
        "k1": timetable_report(k1),
        "m1_registry_stations": len(regions),
        "m1_regions_by_station_code": regions,
        "b1_b2_research_2_1": compare_runtime(b1.trains, rows["B2"], aliases=False),
        "b1_b2_with_aliases": compare_runtime(b1.trains, rows["B2"], aliases=True),
        "b1_k1_departures": compare_departures(b1.trains, k1.trains),
    }


def validated_timetables(rows):
    b1 = parse_b1(rows["B1"])
    validate_timetable("B1", b1, METRO_LINES, max_defects=6)
    k1 = parse_k1(rows["K1"])
    validate_timetable("K1", k1, BUSAN_LINES, max_defects=0)
    return b1, k1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("fetch", "report", "network-input"))
    args = parser.parse_args()
    try:
        if args.command == "fetch":
            result = fetch(ROOT)
        elif args.command == "report":
            result = diagnose(ROOT, read_cached(ROOT))
        else:
            rows = read_cached(ROOT)
            result = network_input(rows["M1"], read_json(ROOT / REGISTRY), *validated_timetables(rows))
    except (OSError, ValueError, KeyError, ET.ParseError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Busan sources: {error}\n")
    output = json.dumps(result, ensure_ascii=False) + "\n" if args.command == "network-input" else json_text(result)
    print(output, end="")


if __name__ == "__main__":
    main()
