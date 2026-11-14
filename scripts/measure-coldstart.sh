#!/usr/bin/env bash
# Cloud Run 콜드스타트 실측(min 0): 쉬었다가 첫 요청 시간을 N번 잰다.
# 사용: bash scripts/measure-coldstart.sh <base-url> [횟수=5] [쉬는 시간(초)=1020] [결과 파일]
# Cloud Run은 마지막 요청 뒤 최대 약 15분까지 인스턴스를 남길 수 있어 기본 휴지는 17분이다. 결과가 정말 콜드였는지는
# 로그의 "서버 시작" 줄 개수로 따로 확인한다(docs/setup/p8a-notes.md).
# 측정 항목(한 번당): ① 첫 /v1/healthz(콜드스타트) ② 바로 이어 DB 읽기(없는 방 404: 첫 DB 연결·Supabase 깨우기 포함)
#                     ③ 추천 1건 ④ 웜 /v1/healthz. 값은 curl의 total 시간(초)이며 클라이언트 위치의 네트워크 왕복을 포함한다.
set -euo pipefail

base="${1:?usage: measure-coldstart.sh <base-url> [count] [idle-seconds] [out-file]}"
base="${base%/}"
count="${2:-5}"
idle="${3:-1020}"
out="${4:-coldstart.jsonl}"

t() { curl -sS --max-time 60 -o /dev/null -w '%{time_total}' "$@"; }
for i in $(seq 1 "$count"); do
  echo "[$i/$count] ${idle}초 휴지 ($(date -u +%H:%M:%SZ) 시작)" >&2
  sleep "$idle"
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cold="$(t "$base/v1/healthz")"
  db="$(t "$base/v1/rooms/abcdefghjk")"
  rec="$(t -X POST "$base/v1/recommend" -H 'Content-Type: application/json' -d '{"origins":["02f","dd9"],"mode":"fair"}')"
  warm="$(t "$base/v1/healthz")"
  printf '{"i":%s,"startedAt":"%s","coldHealthz":%s,"firstDbRead":%s,"recommend":%s,"warmHealthz":%s}\n' \
    "$i" "$started" "$cold" "$db" "$rec" "$warm" | tee -a "$out"
done
python3 -I - "$out" <<'PY'
import json, sys, statistics
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
def pct(xs, p):
    xs = sorted(xs); k = (len(xs) - 1) * p; f = int(k); c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)
for key in ("coldHealthz", "firstDbRead", "recommend", "warmHealthz"):
    xs = [r[key] for r in rows]
    print("%-12s n=%d p50=%.2fs p90=%.2fs min=%.2fs max=%.2fs" % (key, len(xs), pct(xs, .5), pct(xs, .9), min(xs), max(xs)))
PY
