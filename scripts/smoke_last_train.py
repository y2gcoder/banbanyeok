"""Smoke check 3d of scripts/smoke-server.sh: the 신분당선 cells of a /v1/recommend response for 강남·광교.

Usage: python3 -I scripts/smoke_last_train.py <response.json> <repo root> <server dataVersion>
Exit 1 when the response contradicts this repository's last-train report, 0 otherwise (with a warning when it
cannot be checked). Only the 광교 rider (participant "1") at meeting stations with a weekday 신분당 sample to 광교 is
looked at: 광교 is on 신분당선 alone, so a confirmed direct there can only be a 신분당 sample's train.

- weekday 신분당 switched on (report `exactSwitches`): each such candidate must show the confirmed direct to 광교
  at exactly the sample's minute;
- switched off: none of them may show a confirmed direct at all (the line gives no time while it is off);
- an exact 신분당 weekday in last-train.json without its switch in the report is a broken report: fail.
"""

import csv
import json
import sys

FAMILY, HOME, HOME_CODE, RIDER = "신분당", "광교", "dzc", "1"


def check(response, root, version):
    """(exit code, lines to print)."""
    report = json.load(open(root + "/data/config/last-train-report.json"))
    ours = json.load(open(root + "/data/artifacts/dev/manifest.json"))["dataVersion"]
    if version != ours:
        return 0, ["   경고: 서버 dataVersion %s가 이 저장소의 %s와 달라 신분당 칸을 대조하지 않음" % (version, ours)]
    exact = json.load(open(root + "/data/config/last-train.json")).get("exact", {})
    configured = "weekday" in exact.get(FAMILY, {}).get("days", [])
    switch = [s for s in report.get("exactSwitches", []) if s["family"] == FAMILY and s["day"] == "weekday"]
    if configured and not switch:
        return 1, ["   보고서에 평일 %s 스위치가 없음(last-train.json에는 exact로 있음)" % FAMILY]
    on = bool(switch) and switch[0]["on"]
    samples = {row["meeting"]: int(row["time"][:2]) * 60 + int(row["time"][3:])
               for row in csv.DictReader(open(root + "/data/config/last-train-official.csv"))
               if row["family"] == FAMILY and row["home"] == HOME and row["day"] == "weekday"}

    def train(candidate):
        return next((t for t in candidate.get("lastTrains", []) if t["participantId"] == RIDER), None)

    checked = [(c["stationName"], train(c)) for c in response["candidates"] if c["stationName"] in samples]

    def shown(t):
        if t is None or "minute" not in t:
            return str(t)
        return "%s %02d:%02d" % (t["kind"], t["minute"] // 60 % 24, t["minute"] % 60)

    if not on:
        direct = [(name, t) for name, t in checked if t is not None and t["kind"] == "direct"]
        lines = ["   %s: %s에서 광교로 직행 확정이 나옴 ← 꺼진 노선은 시각을 내지 않아야 한다" % (name, shown(t))
                 for name, t in direct]
        if direct:
            return 1, lines
        return 0, ["   경고: 평일 %s이 꺼진 채 발행됨(%s). 대조 후보 %d곳 모두 직행 확정 없음(맞음)"
                   % (FAMILY, switch[0]["reasons"] if switch else "exact 아님", len(checked))]
    if not checked:
        return 0, ["   경고: 상위 후보에 신분당선 표본이 있는 만날 역이 없음(후보 순위가 바뀌었는지 확인)"]
    lines, bad = [], 0
    for name, t in checked:
        want = samples[name]
        ok = (t is not None and t["kind"] == "direct" and t.get("minute") == want
              and t.get("boundFor", {}).get("stationCode") == HOME_CODE)
        bad += not ok
        lines.append("   %s에서 광교행 %s (표본 직행 확정 %02d:%02d)%s"
                     % (name, shown(t), want // 60 % 24, want % 60, "" if ok else "  ← 다름"))
    return (1 if bad else 0), lines


def main():
    code, lines = check(json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3])
    print("\n".join(lines))
    return code


if __name__ == "__main__":
    sys.exit(main())
