"""scripts/smoke_last_train.py (deploy smoke 3c/3d) against a repository root built from parts, with made-up responses.

#100 third and fourth reviews: a confirmed direct while 신분당 was off passed, so did a response the check could not
read (a rider twice, no rider, no lastTrains, a kind outside the contract, an unknown station name, no candidates), a
switch written as the string "false", and a stale basis that was not old enough and still showed times.
"""

import copy
import csv
import datetime
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
# Meeting station code, name and weekday sample minute to 광교.
SAMPLES = [("3t2", "판교", "24:18"), ("fkn", "양재", "24:05")]
OTHER = ("8gb", "서울역")


def root(on=True, switch=True, exact=True):
    """A repository root with the files the check reads: report, manifest, registry, candidates, samples, config."""
    base = pathlib.Path(tempfile.mkdtemp())
    (base / "data/config").mkdir(parents=True)
    (base / "data/artifacts/dev").mkdir(parents=True)
    entry = {"family": "신분당", "day": "weekday", "on": on, "reasons": [] if on is True else ["no receipt S8"]}
    (base / "data/config/last-train-report.json").write_text(json.dumps({"exactSwitches": [entry] if switch else []}))
    (base / "data/artifacts/dev/manifest.json").write_text(json.dumps({"dataVersion": VERSION}))
    stations = [{"code": c, "name": n} for c, n, _ in SAMPLES] + [{"code": OTHER[0], "name": OTHER[1]}]
    (base / "data/artifacts/dev/stations.json").write_text(
        json.dumps({"stations": stations + [{"code": "dzc", "name": "광교"}, {"code": "2rz", "name": "정자"}]}))
    (base / "data/artifacts/dev/candidates.json").write_text(json.dumps({"candidates": [s["code"] for s in stations]}))
    config = {"exact": {"신분당": {"days": ["weekday", "holiday"]}}} if exact else {"exact": {}}
    (base / "data/config/last-train.json").write_text(json.dumps(config))
    with open(base / "data/config/last-train-official.csv", "w", newline="") as out:
        writer = csv.writer(out)
        writer.writerow(["meeting", "home", "day", "time", "bound", "family", "url", "checkedAt"])
        for _, name, time in SAMPLES:
            writer.writerow([name, "광교", "weekday", time, "광교", "신분당", "https://example.test", "2026-11-21"])
            writer.writerow([name, "광교", "holiday", "23:00", "광교", "신분당", "https://example.test", "2026-11-21"])
        writer.writerow(["시청", "종각", "weekday", "24:50", "동묘앞", "1", "https://example.test", "2026-11-20"])
    return str(base)


def direct(minute, code="dzc"):
    return {"kind": "direct", "minute": minute, "boundFor": {"stationCode": code, "stationName": "광교"}}


CHECK = {"kind": "check"}


def response(*cells, basis=None):
    """Candidates (station code, the 광교 rider's last train); the other rider has none."""
    names = dict([(c, n) for c, n, _ in SAMPLES] + [OTHER])
    return {
        "status": "ok",
        "dataVersion": VERSION,
        "participants": [{"participantId": "0"}, {"participantId": "1"}],
        "candidates": [{"stationCode": code, "stationName": names.get(code, "어딘가"),
                        "lastTrains": [dict(CHECK, participantId="0"), dict(train, participantId="1")]}
                       for code, train in cells],
        "lastTrainBasis": basis or {"dayType": "weekday", "asOf": "2026-11-16"},
    }


class SmokeShinbundangTest(unittest.TestCase):
    def code(self, body, **kwargs):
        return smoke.check(body, root(**kwargs), VERSION)[0]

    def test_on_requires_the_sample_minute_to_gwanggyo_at_every_sampled_candidate(self):
        self.assertEqual(0, self.code(response(("3t2", direct(1458)), ("fkn", direct(1445)), ("8gb", CHECK))))
        self.assertEqual(1, self.code(response(("3t2", direct(1459)))), "a minute late")
        wrong = response(("3t2", direct(1458, code="2rz")))
        wrong["candidates"][0]["lastTrains"][1]["boundFor"]["stationName"] = "정자"
        self.assertEqual(1, self.code(wrong), "another terminal")
        self.assertEqual(1, self.code(response(("3t2", CHECK))), "no direct")
        self.assertEqual(0, self.code(response(("8gb", CHECK))), "no sampled candidate: warning only")

    def test_off_forbids_any_confirmed_direct_at_a_sampled_candidate(self):
        self.assertEqual(1, self.code(response(("fkn", direct(1445))), on=False))
        self.assertEqual(0, self.code(response(("fkn", CHECK), ("3t2", CHECK)), on=False))
        margin = {"kind": "margin", "minute": 1440, "transfer": True}
        self.assertEqual(0, self.code(response(("fkn", margin)), on=False))

    def test_a_rider_twice_or_missing_or_unreadable_fails(self):
        # The review's case: the 광교 rider first as check, then again as a 23:58 direct, while off.
        twice = response(("fkn", CHECK))
        twice["candidates"][0]["lastTrains"].append(dict(direct(1438), participantId="1"))
        self.assertEqual(1, self.code(twice, on=False))
        missing = response(("fkn", CHECK))
        missing["candidates"][0]["lastTrains"].pop()
        self.assertEqual(1, self.code(missing, on=False))
        no_trains = response(("fkn", CHECK))
        del no_trains["candidates"][0]["lastTrains"]
        self.assertEqual(1, self.code(no_trains, on=False))
        odd = response(("fkn", {"kind": "maybe"}))
        self.assertEqual(1, self.code(odd, on=False))
        self.assertEqual(1, self.code(response(("fkn", {"kind": "check", "minute": 1445})), on=False))
        self.assertEqual(1, self.code(response(("fkn", {"kind": "direct", "minute": 1445})), on=False))

    def test_a_sampled_station_is_found_by_its_code_whatever_its_name(self):
        renamed = response(("fkn", CHECK))
        renamed["candidates"][0]["stationName"] = "낯선 이름"
        self.assertEqual(1, self.code(renamed), "on: the sampled candidate shows no direct")
        self.assertEqual(1, self.code(dict(response(), candidates=[])), "no candidates at all")
        self.assertEqual(1, self.code(dict(response(("fkn", CHECK)), status="error")))

    def test_a_switch_that_is_not_a_boolean_or_is_missing_fails(self):
        # The review's case: "false" written as a string passed a direct.
        self.assertEqual(1, self.code(response(("fkn", direct(1445))), on="false"))
        self.assertEqual(1, self.code(response(("fkn", CHECK)), on="false"))
        self.assertEqual(1, self.code(response(("fkn", CHECK)), switch=False))
        self.assertEqual(0, self.code(response(("fkn", CHECK)), switch=False, exact=False))
        self.assertEqual(1, self.code(response(("fkn", direct(1445))), switch=False, exact=False))

    def test_the_deploys_expected_version_binds_the_response(self):
        # #100 final review: a stale 00:05 direct passed when the 3d body had the previous version or none.
        late = response(("fkn", direct(1445)))
        base = root(on=False)
        self.assertEqual(1, smoke.check(late, base, VERSION, VERSION)[0], "off and a direct: fails anyway")
        old = dict(late, dataVersion="20261120.4")
        self.assertEqual(1, smoke.check(old, base, VERSION, VERSION)[0], "the previous version")
        none = {k: v for k, v in late.items() if k != "dataVersion"}
        self.assertEqual(1, smoke.check(none, base, VERSION, VERSION)[0], "no version in the body")
        self.assertEqual(1, smoke.check(response(("fkn", CHECK)), base, VERSION, "20261121.1")[0], "repo of another version")
        self.assertEqual(0, smoke.check(response(("fkn", CHECK)), base, VERSION, VERSION)[0])
        # By hand (no expected version): a body that is not the server's version is a contradiction.
        self.assertEqual(1, smoke.check(old, base, VERSION)[0])

    def test_a_candidate_or_terminal_shown_under_another_name_fails(self):
        # The review's case: 판교 (3t2) with its own 00:18 direct to 광교, shown as 양재 (whose sample is 00:05).
        swapped = response(("3t2", direct(1458)))
        swapped["candidates"][0]["stationName"] = "양재"
        self.assertEqual(1, self.code(swapped))
        terminal = response(("3t2", direct(1458)))
        terminal["candidates"][0]["lastTrains"][1]["boundFor"]["stationName"] = "정자"
        self.assertEqual(1, self.code(terminal))

    def test_another_data_version_is_not_checked(self):
        body = dict(response(("fkn", direct(1445))), dataVersion="20261120.4")
        code, lines = smoke.check(body, root(on=False), "20261120.4")
        self.assertEqual(0, code)
        self.assertIn("20261120.4", lines[0])


class SmokeBasisTest(unittest.TestCase):
    DAY = datetime.date(2026, 11, 21)

    def code(self, body, day=DAY):
        return smoke.basis(body, VERSION, day)[0]

    def test_a_fresh_basis_with_times_passes(self):
        self.assertEqual(0, self.code(response(("fkn", direct(1445)))))

    def test_stale_must_be_old_enough_and_show_no_time(self):
        stale = {"dayType": "weekday", "asOf": "2026-11-16", "unavailable": "stale"}
        # The review's case: stale on 11-21 with a time shown passed with a warning and skipped 3d.
        self.assertEqual(1, self.code(response(("fkn", direct(1445)), basis=stale)))
        self.assertEqual(1, self.code(response(("fkn", CHECK), basis=stale)), "not 120 days yet")
        later = datetime.date(2027, 3, 17)
        self.assertEqual(3, self.code(response(("fkn", CHECK), basis=stale), later), "rightly stale")
        self.assertEqual(1, self.code(response(("fkn", direct(1445)), basis=stale), later), "stale with a time")
        self.assertEqual(1, self.code(response(("fkn", CHECK)), later), "times given although stale")
        self.assertEqual(3, self.code(response(("fkn", CHECK), basis=stale), later))

    def test_an_unreadable_basis_fails(self):
        for basis in ({"dayType": "holiday", "asOf": "2026-11-16"}, {"dayType": "weekday", "asOf": "11월 16일"},
                      {"dayType": "weekday", "asOf": "2026-11-16", "unavailable": "day_unknown"}):
            self.assertEqual(1, self.code(response(("fkn", CHECK), basis=basis)), basis)
        body = response(("fkn", CHECK))
        body["dataVersion"] = "other"
        self.assertEqual(1, self.code(body))
        broken = copy.deepcopy(response(("fkn", CHECK)))
        broken["candidates"][0]["lastTrains"][1]["participantId"] = "0"
        self.assertEqual(1, self.code(broken))


if __name__ == "__main__":
    unittest.main()
