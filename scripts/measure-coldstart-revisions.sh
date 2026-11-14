#!/usr/bin/env bash
# Cloud Run 콜드스타트 실측(권장 방법): 같은 이미지의 트래픽 0 리비전을 N개 만들고 방치한 뒤, 각 태그 URL의 첫 요청 시간을 잰다.
# 새 리비전의 첫 요청은 항상 새 인스턴스라서 "쉰 뒤 첫 요청"이 우연히 웜 인스턴스에 닿는 문제가 없다(Cloud Run은 17분 넘게도 남긴다).
# 사용: bash scripts/measure-coldstart-revisions.sh [횟수=6] [방치 시간(초)=2100] [결과 파일]
# 필요 권한: 서비스 server에 대한 run.developer(프로젝트 owner 또는 github-deployer). 서비스 설정은 `COLD_NONCE` 환경 변수만 바뀌고
# 라이브 트래픽은 그대로다. 끝나면 태그를 지운다(리비전은 남지만 비용 없음, 다음 배포가 환경 변수를 되돌린다).
# 요청 시간은 클라이언트 위치의 네트워크 왕복을 포함한다. 서버 쪽 시간은 Cloud Run 요청 로그의 httpRequest.latency로 따로 본다.
set -euo pipefail

count="${1:-6}"
idle="${2:-2100}"
out="${3:-coldstart-revisions.jsonl}"
region="${REGION:-asia-northeast3}"
service="${SERVICE:-server}"

urls=()
for i in $(seq 1 "$count"); do
  gcloud run services update "$service" --region="$region" --no-traffic --tag="cold$i" \
    --update-env-vars="COLD_NONCE=$(date -u +%s)-$i" --quiet >/dev/null
  urls+=("$(gcloud run services describe "$service" --region="$region" --format=json \
    | python3 -I -c 'import json,sys; t=sys.argv[1]; print([x["url"] for x in json.load(sys.stdin)["status"]["traffic"] if x.get("tag")==t][0])' "cold$i")")
  echo "[$i/$count] 리비전 준비: ${urls[${#urls[@]}-1]}" >&2
done
echo "${idle}초 방치 ($(date -u +%H:%M:%SZ) 시작)" >&2
sleep "$idle"

t() { curl -sS --max-time 60 -o /dev/null -w '%{time_total}' "$@"; }
for i in $(seq 1 "$count"); do
  b="${urls[$((i - 1))]}"
  s="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cold="$(t "$b/v1/healthz")"
  db="$(t "$b/v1/rooms/abcdefghjk")"
  rec="$(t -X POST "$b/v1/recommend" -H 'Content-Type: application/json' -d '{"origins":["02f","dd9"],"mode":"fair"}')"
  warm="$(t "$b/v1/healthz")"
  printf '{"i":%s,"startedAt":"%s","coldHealthz":%s,"firstDbRead":%s,"recommend":%s,"warmHealthz":%s}\n' \
    "$i" "$s" "$cold" "$db" "$rec" "$warm" | tee -a "$out"
done
gcloud run services update-traffic "$service" --region="$region" \
  --remove-tags="$(seq -f 'cold%g' -s, 1 "$count")" >/dev/null

python3 -I - "$out" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
def pct(xs, p):
    xs = sorted(xs); k = (len(xs) - 1) * p; f = int(k); c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)
for key in ("coldHealthz", "firstDbRead", "recommend", "warmHealthz"):
    xs = [r[key] for r in rows]
    print("%-12s n=%d p50=%.2fs p90=%.2fs min=%.2fs max=%.2fs" % (key, len(xs), pct(xs, .5), pct(xs, .9), min(xs), max(xs)))
PY
