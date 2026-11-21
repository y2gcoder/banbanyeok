"""scripts/smoke_last_train.py (deploy smoke 3d) against a repository root built from parts, with made-up responses.

#100 re-review: with 신분당 switched off, a confirmed direct in the response passed the smoke with a warning.
"""

import csv
import importlib.util
import json
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("smoke_last_train", HERE.parent / "scripts" / "smoke_last_train.py")
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)

VERSION = "20261120.5"
SAMPLES = [("판교", "24:18"), ("양재", "24:05")]


def root(switch=True, on=True, exact=True):
    """A repository root with the files the check reads: report, manifest, last-train.json, samples."""
    base = pathlib.Path(tempfile.mkdtemp())
    (base / "data/config").mkdir(parents=True)
    (base / "data/artifacts/dev").mkdir(parents=True)
    switches = [{"family": "신분당", "day": "weekday", "on": on, "reasons": [] if on else ["no receipt S8"]}]
    (base / "data/config/last-train-report.json").write_text(json.dumps({"exactSwitches": switches if switch else []}))
    (base / "data/artifacts/dev/manifest.json").write_text(json.dumps({"dataVersion": VERSION}))
    config = {"exact": {"신분당": {"days": ["weekday", "holiday"]}}} if exact else {"exact": {}}
    (base / "data/config/last-train.json").write_text(json.dumps(config))
    with open(base / "data/config/last-train-official.csv", "w", newline="") as out:
        writer = csv.writer(out)
        writer.writerow(["meeting", "home", "day", "time", "bound", "family", "url", "checkedAt"])
        for meeting, time in SAMPLES:
            writer.writerow([meeting, "광교", "weekday", time, "광교", "신분당", "https://example.test", "2026-11-21"])
            writer.writerow([meeting, "광교", "holiday", "23:00", "광교", "신분당", "https://example.test", "2026-11-21"])
        writer.writerow(["시청", "종각", "weekday", "24:50", "동묘앞", "1", "https://example.test", "2026-11-20"])
    return str(base)


def response(*cells):
    """Candidates (station name, the 광교 rider's last train or None)."""
    return {"candidates": [{"stationName": name, "lastTrains": [{"participantId": "0", "kind": "check"}]
                            + ([dict(train, participantId="1")] if train else [])} for name, train in cells]}


def direct(minute, code="dzc"):
    return {"kind": "direct", "minute": minute, "boundFor": {"stationCode": code, "stationName": "광교"}}


class SmokeLastTrainTest(unittest.TestCase):
    def code(self, body, **kwargs):
        return smoke.check(body, root(**kwargs), VERSION)[0]

    def test_on_requires_the_sample_minute_to_gwanggyo_at_every_sampled_candidate(self):
        self.assertEqual(0, self.code(response(("판교", direct(1458)), ("양재", direct(1445)), ("서울역", None))))
        self.assertEqual(1, self.code(response(("판교", direct(1459)))), "a minute late")
        self.assertEqual(1, self.code(response(("판교", direct(1458, code="2rz")))), "another terminal")
        self.assertEqual(1, self.code(response(("판교", {"kind": "check"}))), "no direct")
        self.assertEqual(1, self.code(response(("판교", None))), "no last train at all")
        self.assertEqual(0, self.code(response(("서울역", None))), "no sampled candidate: warning only")

    def test_off_forbids_any_confirmed_direct_at_a_sampled_candidate(self):
        # The review's case: 양재 → 광교 shown as a confirmed 24:05 direct while 신분당 is switched off.
        self.assertEqual(1, self.code(response(("양재", direct(1445))), on=False))
        self.assertEqual(1, self.code(response(("판교", {"kind": "check"}), ("양재", direct(1445))), on=False))
        self.assertEqual(0, self.code(response(("양재", {"kind": "check"}), ("판교", None)), on=False))
        self.assertEqual(0, self.code(response(("양재", {"kind": "margin-transfer", "minute": 1440})), on=False))

    def test_a_missing_switch_of_an_exact_line_is_a_broken_report(self):
        self.assertEqual(1, self.code(response(("양재", {"kind": "check"})), switch=False))
        # Not exact in last-train.json: no switch is expected, and no direct may show.
        self.assertEqual(0, self.code(response(("양재", {"kind": "check"})), switch=False, exact=False))
        self.assertEqual(1, self.code(response(("양재", direct(1445))), switch=False, exact=False))

    def test_another_data_version_is_not_checked(self):
        code, lines = smoke.check(response(("양재", direct(1)),), root(on=False), "20261120.4")
        self.assertEqual(0, code)
        self.assertIn("20261120.4", lines[0])


if __name__ == "__main__":
    unittest.main()
