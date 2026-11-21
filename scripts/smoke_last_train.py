"""Smoke checks 3c (basis) and 3d (신분당선) of scripts/smoke-server.sh on a /v1/recommend response.

  python3 -I scripts/smoke_last_train.py basis <response.json> <server dataVersion>
      0: last trains are given; 3: the table is stale (and rightly so); 1: anything else.
  python3 -I scripts/smoke_last_train.py shinbundang <response.json> <repo root> <server dataVersion> [expected]
      0: the 신분당선 cells agree with this repository's report; 1: they do not, or the response cannot be read.
      With the deploy's expected dataVersion, a response of any other version (or none) fails, and so does this
      repository's data being of another version; without it (a run by hand) another version is only a warning.
      Every candidate and terminal must carry the name the registry of that version gives its code.

Anything the check cannot read or does not know fails (#100 fourth review): a response of another shape, a kind
outside the contract, a rider twice or missing in a candidate, a switch that is not a boolean, a stale basis that is
not old enough or still shows times. Only a well formed response without a sampled candidate is a warning.

3d looks at the 광교 rider (participant "1") at meeting stations with a weekday 신분당 sample to 광교. 광교 is on
신분당선 alone, so a confirmed direct there can only be a 신분당 sample's train:
- weekday 신분당 switched on (report `exactSwitches`): each such candidate shows the confirmed direct to 광교 at
  exactly the sample's minute;
- switched off: none of them shows a confirmed direct;
- an exact 신분당 weekday in last-train.json without its switch in the report is a broken report.
"""

import csv
import datetime
import json
import os
import re
import sys

FAMILY, HOME, HOME_CODE, RIDER = "신분당", "광교", "dzc", "1"
RIDERS = ["0", "1"]
KINDS = {"direct", "margin", "check"}
MAX_AGE_DAYS = 120
CODE = re.compile(r"[0-9a-z]{3}")


class Unreadable(Exception):
    """The response is not one the check knows how to read."""


def need(condition, message):
    if not condition:
        raise Unreadable(message)


def load(path):
    with open(path) as source:
        return json.load(source)


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def today():
    """The Seoul date (SMOKE_TODAY=YYYY-MM-DD overrides it, for tests)."""
    fixed = os.environ.get("SMOKE_TODAY")
    if fixed:
        return datetime.date.fromisoformat(fixed)
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)).date()


def station(value, where):
    need(isinstance(value, dict), "%s: boundFor is not an object" % where)
    need(isinstance(value.get("stationCode"), str) and CODE.fullmatch(value["stationCode"]), "%s: bad code" % where)
    need(isinstance(value.get("stationName"), str) and value["stationName"], "%s: no station name" % where)


def train(item, where):
    """One last train as the contract (openapi LastTrain) has it."""
    need(isinstance(item, dict), "%s: not an object" % where)
    kind = item.get("kind")
    need(kind in KINDS, "%s: unknown kind %r" % (where, kind))
    keys = set(item) - {"participantId", "kind"}
    if kind == "check":
        need(not keys, "%s: a check with %s" % (where, sorted(keys)))
        return
    need(is_int(item.get("minute")) and 1200 <= item["minute"] <= 1619, "%s: minute %r" % (where, item.get("minute")))
    if kind == "direct":
        need(keys == {"minute", "boundFor"}, "%s: a direct with %s" % (where, sorted(keys)))
        station(item["boundFor"], where)
    else:
        need(isinstance(item.get("transfer"), bool), "%s: margin without transfer" % where)
        need(keys == ({"minute", "transfer"} if item["transfer"] else {"minute", "transfer", "boundFor"}),
             "%s: a margin with %s" % (where, sorted(keys)))
        if not item["transfer"]:
            station(item["boundFor"], where)


def candidates(response):
    """The response's candidates, each with exactly one last train per rider, all well formed."""
    need(isinstance(response, dict) and response.get("status") == "ok", "status is not ok")
    riders = response.get("participants")
    need(isinstance(riders, list) and [p.get("participantId") for p in riders if isinstance(p, dict)] == RIDERS,
         "participants are not 0 and 1")
    found = response.get("candidates")
    need(isinstance(found, list) and found, "no candidates")
    for candidate in found:
        need(isinstance(candidate, dict), "a candidate is not an object")
        code = candidate.get("stationCode")
        need(isinstance(code, str) and CODE.fullmatch(code), "a candidate without a station code")
        trains = candidate.get("lastTrains")
        need(isinstance(trains, list), "%s: no lastTrains" % code)
        ids = [t.get("participantId") if isinstance(t, dict) else None for t in trains]
        need(sorted(ids) == RIDERS, "%s: last trains of riders %s" % (code, ids))
        for item in trains:
            train(item, "%s/%s" % (code, item.get("participantId")))
    return found


def basis(response, version, day):
    """(code, lines) of check 3c: 0 times given, 3 stale and rightly so, 1 anything else."""
    try:
        found = candidates(response)
        need(response.get("dataVersion") == version, "dataVersion %r" % response.get("dataVersion"))
        b = response.get("lastTrainBasis")
        need(isinstance(b, dict) and b.get("dayType") == "weekday", "lastTrainBasis %r" % b)
        try:
            as_of = datetime.date.fromisoformat(b.get("asOf", ""))
        except ValueError:
            raise Unreadable("asOf %r" % b.get("asOf"))
        unavailable = b.get("unavailable")
        times = [t for c in found for t in c["lastTrains"] if t["kind"] != "check"]
        if unavailable == "stale":
            need(day > as_of + datetime.timedelta(days=MAX_AGE_DAYS),
                 "stale although %s is not %d days after %s" % (day, MAX_AGE_DAYS, as_of))
            need(not times, "stale but %d last trains have a time" % len(times))
            return 3, ["   경고: 시간표 수집일 %s에서 120일이 지나 막차 시각을 내지 않는 중(재수집 필요)" % as_of]
        need(unavailable is None, "unavailable %r on a weekday night" % unavailable)
        need(day <= as_of + datetime.timedelta(days=MAX_AGE_DAYS), "times although %s is stale" % as_of)
        return 0, []
    except Unreadable as problem:
        return 1, ["   막차 응답을 읽을 수 없거나 모순: %s" % problem]


def sample_codes(root):
    """Meeting station code -> minute of the weekday 신분당 sample to 광교."""
    names = {s["code"]: s["name"] for s in load(root + "/data/artifacts/dev/stations.json")["stations"]}
    meetings = {names[c]: c for c in load(root + "/data/artifacts/dev/candidates.json")["candidates"]}
    with open(root + "/data/config/last-train-official.csv") as source:
        rows = list(csv.DictReader(source))
    return {meetings[row["meeting"]]: int(row["time"][:2]) * 60 + int(row["time"][3:])
            for row in rows if row["family"] == FAMILY and row["home"] == HOME and row["day"] == "weekday"}


def names_problem(found, root):
    """A candidate or terminal whose name is not the one the registry gives its code (None when none is)."""
    names = {s["code"]: s["name"] for s in load(root + "/data/artifacts/dev/stations.json")["stations"]}
    for candidate in found:
        if names.get(candidate["stationCode"]) != candidate.get("stationName"):
            return "candidate %s shown as %r, the registry says %r" % (
                candidate["stationCode"], candidate.get("stationName"), names.get(candidate["stationCode"]))
        for item in candidate["lastTrains"]:
            bound = item.get("boundFor")
            if bound and names.get(bound["stationCode"]) != bound["stationName"]:
                return "terminal %s shown as %r at %s" % (bound["stationCode"], bound["stationName"],
                                                            candidate["stationCode"])
    return None


def check(response, root, version, expected=None):
    """(code, lines) of check 3d."""
    try:
        found = candidates(response)
    except Unreadable as problem:
        return 1, ["   응답을 읽을 수 없음: %s" % problem]
    report = load(root + "/data/config/last-train-report.json")
    ours = load(root + "/data/artifacts/dev/manifest.json")["dataVersion"]
    body = response.get("dataVersion")
    if expected:
        # A deploy: the response, the server and this checkout must all be the version being deployed.
        if body != expected or version != expected or ours != expected:
            return 1, ["   dataVersion이 배포 기대값 %s와 다름(응답 %r, 서버 %s, 이 저장소 %s)"
                       % (expected, body, version, ours)]
    elif body != version:
        return 1, ["   응답의 dataVersion %r가 서버 manifest의 %s와 다름" % (body, version)]
    elif version != ours:
        return 0, ["   경고: 서버 dataVersion %s가 이 저장소의 %s와 달라 신분당 칸을 대조하지 않음" % (version, ours)]
    problem = names_problem(found, root)
    if problem:
        return 1, ["   응답의 역 이름이 같은 버전의 역 목록과 다름: %s" % problem]
    exact = load(root + "/data/config/last-train.json").get("exact", {})
    configured = "weekday" in exact.get(FAMILY, {}).get("days", [])
    switches = [s for s in report.get("exactSwitches", []) if s.get("family") == FAMILY and s.get("day") == "weekday"]
    if configured and len(switches) != 1:
        return 1, ["   보고서에 평일 %s 스위치가 %d개(last-train.json에는 exact로 있음)" % (FAMILY, len(switches))]
    if switches and not isinstance(switches[0].get("on"), bool):
        return 1, ["   보고서의 평일 %s 스위치가 참·거짓이 아님: %r" % (FAMILY, switches[0].get("on"))]
    on = bool(switches) and switches[0]["on"]
    samples = sample_codes(root)
    checked = [(c, next(t for t in c["lastTrains"] if t["participantId"] == RIDER))
               for c in found if c["stationCode"] in samples]

    def shown(t):
        return t["kind"] if "minute" not in t else "%s %02d:%02d" % (t["kind"], t["minute"] // 60 % 24, t["minute"] % 60)

    if not on:
        direct = [(c, t) for c, t in checked if t["kind"] == "direct"]
        if direct:
            return 1, ["   %s: %s에서 광교로 직행 확정이 나옴 ← 꺼진 노선은 시각을 내지 않아야 한다"
                       % (shown(t), c["stationName"]) for c, t in direct]
        return 0, ["   경고: 평일 %s이 꺼진 채 발행됨(%s). 대조 후보 %d곳 모두 직행 확정 없음(맞음)"
                   % (FAMILY, switches[0].get("reasons") if switches else "exact 아님", len(checked))]
    if not checked:
        return 0, ["   경고: 상위 후보에 신분당선 표본이 있는 만날 역이 없음(후보 순위가 바뀌었는지 확인)"]
    lines, bad = [], 0
    for c, t in checked:
        want = samples[c["stationCode"]]
        ok = t["kind"] == "direct" and t["minute"] == want and t["boundFor"]["stationCode"] == HOME_CODE
        bad += not ok
        lines.append("   %s에서 광교행 %s (표본 직행 확정 %02d:%02d)%s"
                     % (c["stationName"], shown(t), want // 60 % 24, want % 60, "" if ok else "  ← 다름"))
    return (1 if bad else 0), lines


def main():
    mode = sys.argv[1]
    response = load(sys.argv[2])
    if mode == "basis":
        code, lines = basis(response, sys.argv[3], today())
    elif mode == "shinbundang":
        code, lines = check(response, sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else None)
    else:
        raise SystemExit("usage: smoke_last_train.py basis|shinbundang ...")
    if lines:
        print("\n".join(lines), file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
