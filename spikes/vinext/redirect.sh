#!/usr/bin/env bash
# 정식 도메인 리디렉트 비교. 두 Worker를 CANONICAL_HOST=banbanyeok.app 으로 띄운 뒤(stack.sh restart) Host 헤더로 www·workers.dev를 흉내 낸다.
#   bash spikes/vinext/redirect.sh > spikes/vinext/results/redirect.tsv
set -uo pipefail
printf 'target\thost\trequest\tstatus\tlocation\tcache-control\n'
for t in opennext=18787 vinext=18788; do
  name="${t%%=*}" port="${t#*=}"
  for host in www.banbanyeok.app banbanyeok-web.example.workers.dev localhost; do
    for req in "GET /meet?x=1" "POST /api/v1/rooms" "GET /_next/static/x.js"; do
      method="${req%% *}" target="${req#* }"
      out="$(curl -q --noproxy '*' -s -o /dev/null -X "$method" -H "Host: $host" -D - "http://127.0.0.1:$port$target" | tr -d '\r')"
      status="$(sed -n 1p <<<"$out" | awk '{print $2}')"
      location="$(grep -i '^location:' <<<"$out" | cut -d' ' -f2-)"
      cache="$(grep -i '^cache-control:' <<<"$out" | cut -d' ' -f2-)"
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$host" "$req" "$status" "$location" "$cache"
    done
  done
done
