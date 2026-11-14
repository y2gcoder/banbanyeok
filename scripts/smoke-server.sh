#!/usr/bin/env bash
# 배포된 서버(또는 태그 붙은 후보 리비전)의 스모크 테스트. 사용: bash scripts/smoke-server.sh <base-url> [expected-dataVersion]
# 확인: /v1/healthz → /v1/manifest(데이터 버전) → 추천 1건 → DB 읽기(없는 방 404) → 방 생성·조회·삭제 한 번(DB 쓰기·pepper 경로).
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
