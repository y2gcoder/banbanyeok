#!/usr/bin/env bash
# 로컬 workerd 벽시계 응답 시간(ms). Workers CPU가 아니며 운영 수치와 섞지 않는다.
# 표본: Worker를 다시 띄운 직후 경로별 첫 요청(cold) 1회 + 이어서 같은 경로 5회(warm). ROUNDS번 반복한다.
#   bash spikes/vinext/timing.sh 3 > spikes/vinext/results/timing.tsv
set -euo pipefail
rounds="${1:-3}"
here="$(cd "$(dirname "$0")" && pwd)"
pair="${PAIR:-/meet/10t-1qs}" pair_og="${PAIR_OG:-/meet/10t-1qs/opengraph-image?v=6e4d1336}" site_og="${SITE_OG:-/opengraph-image?v=a5ba6de0}"
codes="${pair#/meet/}"; o="${codes%%-*}.${codes##*-}"
paths=("/" "$pair" "$pair_og" "$site_og" "/sitemap.xml" "/privacy" "/r/abcdefghjk" "/result?v=2&o=$o&m=f&t=weekday-day" "/s?v=1&o=$o&m=f" "/s/og?v=1&o=$o&m=f" "/api/healthz")

ms() { curl -q --noproxy '*' -s -o /dev/null -w '%{http_code} %{time_total}' "$1" | awk '{printf "%s\t%.1f", $1, $2*1000}'; }

printf 'round\ttarget\tpath\tkind\tstatus\tms\n'
for r in $(seq 1 "$rounds"); do
  bash "$here/stack.sh" restart >/dev/null
  # 순서 치우침을 줄이려고 라운드마다 먼저 재는 쪽을 바꾼다.
  order=(opennext=http://localhost:18787 vinext=http://localhost:18788)
  (( r % 2 == 0 )) && order=("${order[1]}" "${order[0]}")
  for t in "${order[@]}"; do
    name="${t%%=*}" base="${t#*=}"
    for p in "${paths[@]}"; do
      printf '%s\t%s\t%s\tcold\t%s\n' "$r" "$name" "$p" "$(ms "$base$p")"
      for _ in 1 2 3 4 5; do printf '%s\t%s\t%s\twarm\t%s\n' "$r" "$name" "$p" "$(ms "$base$p")"; done
    done
  done
done
