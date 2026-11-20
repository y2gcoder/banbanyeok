#!/usr/bin/env bash
# 배포된 서버(또는 태그 붙은 후보 리비전)의 스모크 테스트. 사용: bash scripts/smoke-server.sh <base-url> [expected-dataVersion]
# 확인: /v1/healthz → /v1/manifest(데이터 버전) → 추천 1건 → 구분(토요일 밤) 추천 1건 → 귀갓길 막차(수집일·신분당 확정 표본)
#       → DB 읽기(없는 방 404) → 방 생성·조회·삭제 한 번(DB 쓰기·pepper 경로).
# 방 토큰은 출력하지 않는다. 만든 방은 방장 토큰으로 바로 지운다. 콜드스타트 때문에 첫 /healthz는 재시도한다.
set -euo pipefail

base="${1:?usage: smoke-server.sh <base-url> [expected-dataVersion]}"
base="${base%/}"
expected="${2:-}"
tmp="$(mktemp -d)"
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

echo "3c) 귀갓길 막차 (강남·광교, 평일 밤): 막차 표가 읽혔고 신분당선 확정 표본(광교행 직행)이 그대로 나와야 한다"
# 막차 표는 기동 뒤 뒤에서 읽고 요청은 기다리지 않는다. 그래서 표가 준비될 때까지 몇 번 다시 묻는다(없으면 lastTrainBasis 키가 없다).
last_ok=0
for _ in $(seq 1 10); do
  code="$(http "$tmp/l" -X POST "$base/v1/recommend" -H 'Content-Type: application/json' \
    -d '{"origins":["k3a","dzc"],"mode":"fair","timeSlot":"weekday-night"}')"
  [[ "$code" == 200 ]] || fail "/v1/recommend(weekday-night) 상태 $code"
  if python3 -I -c 'import json,sys; sys.exit(0 if "lastTrainBasis" in json.load(open(sys.argv[1])) else 1)' "$tmp/l"; then
    last_ok=1; break
  fi
  sleep 2
done
[[ "$last_ok" == 1 ]] || fail "응답에 lastTrainBasis가 없음(막차 표를 읽지 못했거나 검증에 실패)"
python3 -I - "$tmp/l" <<'PY' || fail "막차 응답이 예상과 다름(확정 표본 또는 수집일)"
import json, re, sys
r = json.load(open(sys.argv[1]))
basis = r["lastTrainBasis"]
assert basis["dayType"] == "weekday", basis
assert re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", basis["asOf"]), basis
if basis.get("unavailable") == "stale":
    # 수집 120일이 지나면 서버가 시각을 내지 않는다(설계된 동작). 배포는 막지 않고 알리기만 한다.
    print("   경고: 시간표 수집일 %s에서 120일이 지나 막차 시각을 내지 않는 중(재수집 필요)" % basis["asOf"])
    sys.exit(0)
assert "unavailable" not in basis, basis
trains = [t for c in r["candidates"] for t in c["lastTrains"]]
assert len(trains) == 2 * len(r["candidates"]), len(trains)
# 광교(dzc) 참가자는 신분당선 위의 만날 역에서 광교행 직행 확정 막차를 받는다(분 단위, 20:00~26:59).
confirmed = [t for t in trains if t["participantId"] == "1" and t["kind"] == "direct"
             and t.get("boundFor", {}).get("stationCode") == "dzc" and 1200 <= t["minute"] <= 1619]
assert confirmed, trains
print("   수집일 %s, 광교행 직행 확정 %d건(예: %02d:%02d)" % (
    basis["asOf"], len(confirmed), confirmed[0]["minute"] // 60 % 24, confirmed[0]["minute"] % 60))
PY

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
