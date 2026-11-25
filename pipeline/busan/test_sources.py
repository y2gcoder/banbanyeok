import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape

from comparison import compare_departures, compare_runtime, join_regions
from sources import K1_HEADER, MANIFEST, SOURCES, fetch, read_cached, read_source, validate_timetable
from timetable import parse_b1, parse_k1


class BusanSourcesTest(unittest.TestCase):
    def test_b1_quarantines_bad_trains_and_keeps_sunday_distinct(self):
        rows = [
            ["4001", "L2604", "", "", "", "", "일요일",
             "001-미남+002-안평", "001-:+002-00:02", "001-23:59+002-:", "", "", "20260722"],
            ["2001", "S2602", "", "", "", "", "평일",
             "001-전포+002-국제금융.부산은행", "001-:", "001-05:00+002-:", "", "", "20260722"],
            ["1001", "S2601", "", "", "", "", "공휴일",
             "001-노포+002-범어사+003-남산", "001-:+002-06:18+003-06:21",
             "001-06:13+002-06:01+003-:", "", "", "20260722"],
        ]
        result = parse_b1(rows)
        self.assertEqual(result.trains[0].day, "sunday")
        self.assertEqual(result.trains[0].stops[1].arrival, 120)
        self.assertEqual({defect["train"] for defect in result.defects}, {"2001", "1001"})

    def test_train_identity_schema_errors_fail_instead_of_being_quarantined(self):
        for parse, line in ((parse_b1, "S2601"), (parse_k1, "I26K6")):
            for number, day, error in (
                ("1001", ("휴일" if line == "S2601" else "일요일"), "unsupported day"),
                ("", "평일", "missing train number"),
            ):
                with self.subTest(parse=parse.__name__, number=number, day=day):
                    row = [number, line, "", "", "", "", day, "", "", "", "", "", "20260722"]
                    with self.assertRaisesRegex(ValueError, error):
                        parse([row])

    def test_timetable_gate_rejects_excess_defects_and_missing_days(self):
        rows = [
            [str(i + 1), "S2601", "", "", "", "", day, "001-노포+002-범어사",
             "001-:+002-05:02", "001-05:00+002-:", "", "", "20260722"]
            for i, day in enumerate(("평일", "토요일", "공휴일"))
        ]
        invalids = [
            [str(100 + i), *rows[0][1:8], "001-:", *rows[0][9:]]
            for i in range(7)
        ]
        validate_timetable("B1", parse_b1(rows + invalids[:6]), {"S2601"}, max_defects=6)
        with self.assertRaisesRegex(ValueError, "7 defective trains"):
            validate_timetable("B1", parse_b1(rows + invalids), {"S2601"}, max_defects=6)
        with self.assertRaisesRegex(ValueError, "S2601/holiday"):
            validate_timetable("B1", parse_b1(rows[:2]), {"S2601"}, max_defects=6)

    def test_bad_fetch_keeps_receipt_and_raw_file(self):
        row = ["1001", "S2601", "", "", "", "", "휴일", "", "", "", "", "", "20260722"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / MANIFEST
            manifest.parent.mkdir(parents=True)
            manifest.write_bytes(b"existing receipt")
            raw = root / SOURCES[0].file
            raw.parent.mkdir(parents=True)
            raw.write_bytes(b"existing raw file")
            with patch("sources.download", return_value=(b"new raw file", "text/csv")), \
                 patch("sources.read_source", return_value=([row], 1)):
                with self.assertRaisesRegex(ValueError, "unsupported day"):
                    fetch(root)
            self.assertEqual(manifest.read_bytes(), b"existing receipt")
            self.assertEqual(raw.read_bytes(), b"existing raw file")

    def test_k1_sparse_ordinals_and_donghae_aliases(self):
        rows = [
            ["K8501", "I26K6", "", "부전", "거제해", "", "휴일",
             "부전", "0.25", "0.25", "", "", "46173"],
            ["K8501", "I26K6", "", "부전", "거제해", "", "휴일",
             "거제해", "0.2520833333", "0.2520833333", "", "", "46173"],
            ["0101", "L48B1", "", "", "", "", "평일+토요일+공휴일",
             "001-가야대+002-장신대", "002-24:01", "001-23:59", "", "", "44678"],
        ]
        result = parse_k1(rows)
        self.assertEqual(result.defects, [])
        trains = {train.line: train for train in result.trains}
        self.assertEqual(trains["I26K6"].stops[1].name, "거제해맞이")
        self.assertEqual(trains["I26K6"].stops[1].arrival, 21780)
        self.assertEqual(trains["L48B1"].stops[0].arrival, None)
        self.assertEqual(trains["L48B1"].stops[0].departure, 86340)
        self.assertEqual(trains["L48B1"].stops[1].arrival, 60)
        self.assertEqual(trains["L48B1"].stops[1].departure, None)

    def test_k1_workbook_retains_sparse_columns_and_only_busan_rows(self):
        k1 = next(source for source in SOURCES if source.id == "K1")
        raw = io.BytesIO()
        namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        headers = "".join(
            f'<c r="{chr(65 + i)}1" t="inlineStr"><is><t>{escape(header)}</t></is></c>'
            for i, header in enumerate(K1_HEADER)
        )
        with zipfile.ZipFile(raw, "w") as workbook:
            workbook.writestr("xl/worksheets/sheet1.xml", f"""
                <worksheet xmlns="{namespace}"><sheetData>
                  <row r="1">{headers}</row>
                  <row r="2"><c r="A2"><v>1001</v></c>
                    <c r="B2" t="inlineStr"><is><t>S2601</t></is></c>
                    <c r="J2" t="inlineStr"><is><t>001-05:00</t></is></c></row>
                  <row r="3"><c r="B3" t="inlineStr"><is><t>S1101</t></is></c></row>
                </sheetData></worksheet>
            """)
        rows, total = read_source(k1, raw.getvalue())
        self.assertEqual(total, 2)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][8:10], ["", "001-05:00"])

    def test_m1_accepts_cp949_and_checks_header_order(self):
        m1 = next(source for source in SOURCES if source.id == "M1")
        header = ",".join(m1.header)
        row = "02,부산,코레일,동해,1,부전"
        rows, total = read_source(m1, f"{header}\n{row}".encode("cp949"))
        self.assertEqual((rows[0][-1], total), ("부전", 1))
        with self.assertRaisesRegex(ValueError, "header"):
            read_source(m1, f"{row}\n{header}".encode("cp949"))

    def test_report_rejects_raw_file_with_mismatched_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = root / MANIFEST
            receipt.parent.mkdir(parents=True)
            receipt.write_text(json.dumps([{"id": "B1", "sha256": "0" * 64}]), encoding="utf-8")
            raw = root / SOURCES[0].file
            raw.parent.mkdir(parents=True)
            raw.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "B1: SHA-256"):
                read_cached(root)

    def test_m1_join_uses_line_and_checks_missing_registry_stations(self):
        def station(code, source_id):
            return {"code": code, "name": "부전", "status": "active",
                    "sources": {"kric:operator:line": source_id}}

        registry = {"stations": [station("hsd", "operator:S2601:0119"), station("1bp", "operator:I26K6:0001")]}
        metro = ["02", "부산", "부산교통공사", "1호선", "26", "부전(부산시민공원.송상현광장)"]
        donghae = ["02", "부산", "코레일", "동해", "1", "부전"]
        self.assertEqual(join_regions([metro, donghae], registry), {"hsd": "busan", "1bp": "busan"})
        with self.assertRaisesRegex(ValueError, "1bp"):
            join_regions([metro], registry)

    def test_comparisons_use_direction_arrival_and_departure(self):
        rows = [
            ["2001", "S2602", "", "", "", "", "평일",
             "001-전포+002-국제금융.부산은행", "001-:+002-05:01",
             "001-05:00+002-:", "", "", "20260722"],
        ]
        b1 = parse_b1(rows).trains
        rows[0][8] = ""
        rows[0][9] = "001-05:01+002-:"
        k1 = parse_k1(rows).trains
        b2 = [
            ["1", "2", "232", "전포", "00:00", "", ""],
            ["2", "2", "233", "국제금융센터.부산은행", "00:45", "", ""],
        ]
        self.assertEqual(compare_runtime(b1, b2, aliases=False)["S2602"]["arrival"]["pairs"], 0)
        self.assertEqual(compare_runtime(b1, b2, aliases=True)["S2602"]["arrival"]["median_seconds"], 15)
        self.assertEqual(compare_runtime(b1, b2, aliases=True)["S2602"]["departure"]["pairs"], 0)
        result = compare_departures(b1, k1)["S2602"]
        self.assertEqual(result["matched_departures"], 1)
        self.assertEqual(result["delta_b1_minus_k1"]["median_seconds"], -60)
