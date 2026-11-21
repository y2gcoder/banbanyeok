#!/usr/bin/env bash
# 배포된 서버(또는 태그 붙은 후보 리비전)의 스모크 테스트. 사용: bash scripts/smoke-server.sh <base-url> [expected-dataVersion]
# 확인: /v1/healthz → /v1/manifest(데이터 버전) → 추천 1건 → 구분(토요일 밤) 추천 1건 → 귀갓길 막차(수집일·서울 2호선 직행 확정·신분당 대조 칸)
#       → DB 읽기(없는 방 404) → 방 생성·조회·삭제 한 번(DB 쓰기·pepper 경로).
# 방 토큰은 출력하지 않는다. 만든 방은 방장 토큰으로 바로 지운다. 콜드스타트 때문에 첫 /healthz는 재시도한다.
set -euo pipefail

base="${1:?usage: smoke-server.sh <base-url> [expected-dataVersion]}"
base="${base%/}"
expected="${2:-}"
tmp="$(mktemp -d)"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
trap 'rm -rf "$tmp"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
http() { # http <out-file> <curl args...> → 상태 코드
  local out="$1"; shift
  curl -sS --max-time 30 -o "$out" -w '%{http_code}' "$@"
}

# 주의: Cloud Run 앞단(GFE)은 /healthz 경로를 예약해서 앱에 닿기 전에 404를 준다. 배포된 서버는 /v1/healthz로 확인한다.
echo "1) /v1/healthz (콜드스타트면 시간이 걸린다)"
ok=0
for _ in $(seq 1 20); do
  code="$(http "$tmp/h" "$base/v1/healthz" || true)"
  [[ "$code" == 200 ]] && { ok=1; break; }
  sleep 3
done
[[ "$ok" == 1 ]] || fail "/v1/healthz가 200을 주지 않음(마지막 상태 $code)"
grep -qx 'ok' "$tmp/h" || fail "/v1/healthz 본문이 ok가 아님"

echo "2) /v1/manifest"
code="$(http "$tmp/m" "$base/v1/manifest")"
[[ "$code" == 200 ]] || fail "/v1/manifest 상태 $code"
version="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["dataVersion"])' "$tmp/m")"
echo "   dataVersion=$version"
[[ -z "$expected" || "$version" == "$expected" ]] || fail "dataVersion이 기대($expected)와 다름"

echo "3) 추천 1건 (02f, dd9 / 공평)"
code="$(http "$tmp/r" -X POST "$base/v1/recommend" -H 'Content-Type: application/json' \
  -d '{"origins":["02f","dd9"],"mode":"fair"}')"
[[ "$code" == 200 ]] || fail "/v1/recommend 상태 $code"
python3 -I - "$tmp/r" <<'PY' || fail "추천 응답이 예상과 다름"
import json, sys
r = json.load(open(sys.argv[1]))
assert r["status"] == "ok" and len(r["candidates"]) > 0, r.get("status")
print("   후보 %d개, 1위 %s" % (len(r["candidates"]), r["candidates"][0]["stationName"]))
PY

echo "3b) 구분 추천 (토요일 밤): 응답 기준이 요청과 같아야 한다(다르면 구분 행렬을 못 읽고 평일 낮으로 계산한 것)"
code="$(http "$tmp/s" -X POST "$base/v1/recommend" -H 'Content-Type: application/json' \
  -d '{"origins":["02f","dd9"],"mode":"fair","timeSlot":"saturday-night"}')"
[[ "$code" == 200 ]] || fail "/v1/recommend(saturday-night) 상태 $code"
python3 -I - "$tmp/s" <<'PY' || fail "구분 추천의 timeBasis가 saturday-night가 아님(구분 행렬 장애)"
import json, sys
r = json.load(open(sys.argv[1]))
basis = r.get("timeBasis") or {}
assert basis.get("timeSlot") == "saturday-night", basis.get("timeSlot")
print("   기준 %s, 1위 %s" % (basis.get("label"), r["candidates"][0]["stationName"]))
PY

echo "3c) 귀갓길 막차 (강남·잠실, 평일 밤): 막차 표가 읽혔고 서울 2호선의 직행 확정 막차가 나와야 한다"
# 막차 표는 기동 뒤 뒤에서 읽고 요청은 기다리지 않는다. 그래서 표가 준비될 때까지 몇 번 다시 묻는다(없으면 lastTrainBasis 키가 없다).
last_ok=0
for _ in $(seq 1 10); do
  code="$(http "$tmp/l" -X POST "$base/v1/recommend" -H 'Content-Type: application/json' \
    -d '{"origins":["k3a","dxy"],"mode":"fair","timeSlot":"weekday-night"}')"
  [[ "$code" == 200 ]] || fail "/v1/recommend(weekday-night) 상태 $code"
  if python3 -I -c 'import json,sys; sys.exit(0 if "lastTrainBasis" in json.load(open(sys.argv[1])) else 1)' "$tmp/l"; then
    last_ok=1; break
  fi
  sleep 2
done
[[ "$last_ok" == 1 ]] || fail "응답에 lastTrainBasis가 없음(막차 표를 읽지 못했거나 검증에 실패)"
stale="$(python3 -I - "$tmp/l" <<'PY' || fail "막차 응답이 예상과 다름(직행 확정 또는 수집일)"
import json, re, sys
r = json.load(open(sys.argv[1]))
basis = r["lastTrainBasis"]
assert basis["dayType"] == "weekday", basis
assert re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", basis["asOf"]), basis
if basis.get("unavailable") == "stale":
    # 수집 120일이 지나면 서버가 시각을 내지 않는다(설계된 동작). 배포는 막지 않고 알리기만 한다.
    print("   경고: 시간표 수집일 %s에서 120일이 지나 막차 시각을 내지 않는 중(재수집 필요)" % basis["asOf"], file=sys.stderr)
    print("stale")
    sys.exit(0)
assert "unavailable" not in basis, basis
trains = [t for c in r["candidates"] for t in c["lastTrains"]]
assert len(trains) == 2 * len(r["candidates"]), len(trains)
# 강남(k3a)·잠실(dxy)은 서울교통공사 2호선이다: 운영사 공식 파일과 대조를 통과한 노선이라 직행은 분 단위 확정으로 나온다(20:00~26:59).
confirmed = [t for t in trains if t["kind"] == "direct" and "boundFor" in t and 1200 <= t["minute"] <= 1619]
assert confirmed, trains
print("   수집일 %s, 직행 확정 %d건(예: %s행 %02d:%02d)" % (
    basis["asOf"], len(confirmed), confirmed[0]["boundFor"]["stationName"],
    confirmed[0]["minute"] // 60 % 24, confirmed[0]["minute"] % 60), file=sys.stderr)
PY
)"

if [[ "$stale" != stale ]]; then
  echo "3d) 귀갓길 막차 (강남·광교, 평일 밤): 운영사 표와 칸마다 대조한 신분당선 직행(광교행)"
  code="$(http "$tmp/k" -X POST "$base/v1/recommend" -H 'Content-Type: application/json' \
    -d '{"origins":["k3a","dzc"],"mode":"fair","timeSlot":"weekday-night"}')"
  [[ "$code" == 200 ]] || fail "/v1/recommend(강남·광교) 상태 $code"
  # 신분당선은 운영사 표와 대조한 칸만 시각을 낸다. 이 저장소의 보고서(exactSwitches)에서 평일 신분당이 꺼져 있으면
  # 직행이 없는 것이 맞으므로 알리기만 한다. 켜져 있으면 응답의 후보 가운데 신분당 표본이 있는 만날 역은 모두 광교행
  # 직행 확정이 표본의 분 그대로 나와야 한다(없으면 배포 실패). 서버의 데이터 버전이 이 저장소의 것과 다르면 알리기만 한다.
  python3 -I - "$tmp/k" "$root" "$version" <<'PY' || fail "신분당선 막차 직행 확정이 기대와 다름"
import csv, json, sys
response, root, version = sys.argv[1], sys.argv[2], sys.argv[3]
r = json.load(open(response))
report = json.load(open(root + "/data/config/last-train-report.json"))
ours = json.load(open(root + "/data/artifacts/dev/manifest.json"))["dataVersion"]
switch = [s for s in report.get("exactSwitches", []) if s["family"] == "신분당" and s["day"] == "weekday"]
on = bool(switch) and switch[0]["on"]
samples = {row["meeting"]: int(row["time"][:2]) * 60 + int(row["time"][3:])
           for row in csv.DictReader(open(root + "/data/config/last-train-official.csv"))
           if row["family"] == "신분당" and row["home"] == "광교" and row["day"] == "weekday"}
def train(candidate):
    return next((t for t in candidate.get("lastTrains", []) if t["participantId"] == "1"), None)
checked = [(c["stationName"], train(c)) for c in r["candidates"] if c["stationName"] in samples]
if version != ours:
    print("   경고: 서버 dataVersion %s가 이 저장소의 %s와 달라 신분당 칸을 대조하지 않음" % (version, ours))
elif not on:
    print("   경고: 평일 신분당이 꺼진 채 발행됨(보고서 exactSwitches: %s). 직행이 없는 것이 맞다"
          % (switch[0]["reasons"] if switch else "없음"))
elif not checked:
    print("   경고: 상위 후보에 신분당선 표본이 있는 만날 역이 없음(후보 순위가 바뀌었는지 확인)")
else:
    bad = []
    for name, t in checked:
        want = samples[name]
        ok = (t is not None and t["kind"] == "direct" and t.get("minute") == want
              and t.get("boundFor", {}).get("stationCode") == "dzc")
        print("   %s에서 광교행 직행 확정 %s (표본 %02d:%02d)%s" % (
            name, "%02d:%02d" % (t["minute"] // 60 % 24, t["minute"] % 60) if t and "minute" in t else t,
            want // 60 % 24, want % 60, "" if ok else "  ← 다름"))
        if not ok:
            bad.append(name)
    sys.exit(1 if bad else 0)
PY
fi

echo "4) DB 읽기: 없는 방은 404 ROOM_NOT_FOUND여야 한다(DB 연결 실패면 500)"
code="$(http "$tmp/n" "$base/v1/rooms/abcdefghjk")"
[[ "$code" == 404 ]] || fail "없는 방 조회 상태 $code (404 기대; DB 연결 문제일 수 있음)"
grep -q 'ROOM_NOT_FOUND' "$tmp/n" || fail "404 본문에 ROOM_NOT_FOUND 없음"

echo "5) 방 생성 → 조회 → 삭제"
code="$(http "$tmp/c" -X POST "$base/v1/rooms" -H 'Content-Type: application/json' \
  -d '{"mode":"fair","host":{"originCode":"02f","nickname":"smoke"}}')"
[[ "$code" == 201 ]] || fail "방 생성 상태 $code"
room_id="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["roomId"])' "$tmp/c")"
host_token="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["hostToken"])' "$tmp/c")"
# Actions 로그에서는 토큰을 가린다(로컬 터미널에는 아무것도 출력하지 않는다).
[[ -z "${GITHUB_ACTIONS:-}" ]] || echo "::add-mask::$host_token"
code="$(http "$tmp/g" "$base/v1/rooms/$room_id")"
[[ "$code" == 200 ]] || fail "방 조회 상태 $code"
code="$(http "$tmp/d" -X DELETE "$base/v1/rooms/$room_id" -H "Authorization: Bearer $host_token")"
[[ "$code" == 204 ]] || fail "방 삭제 상태 $code"
code="$(http "$tmp/g2" "$base/v1/rooms/$room_id")"
[[ "$code" == 404 ]] || fail "삭제한 방이 아직 보임($code)"
echo "스모크 통과: dataVersion=$version"
