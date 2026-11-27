#!/usr/bin/env bash
# 빌드 시간 교대 측정: OpenNext와 vinext(SEO 번들)를 번갈아 N번씩 깨끗하게 빌드한다. 기계의 다른 부하를 두 쪽이 같이 받게 하려는 것이다.
#   bash spikes/vinext/alternate.sh 5 > spikes/vinext/results/build-alternate.tsv
set -euo pipefail
runs="${1:-5}"
here="$(cd "$(dirname "$0")" && pwd)"
printf 'target\trun\tbuild_s\tcache_s\tupload_kib\tgzip_kib\tsha\tload1\n'
for i in $(seq 1 "$runs"); do
  for side in opennext vinext-seo; do
    load="$(uptime | sed -E 's/.*load averages?: ([0-9.]+).*/\1/')"
    if [[ "$side" == opennext ]]; then
      row="$(bash "$here/measure-build.sh" opennext 1 | tail -1)"
    else
      row="$(VINEXT_SEO_BUNDLE=1 LABEL=vinext-seo bash "$here/measure-build.sh" vinext 1 | tail -1)"
    fi
    awk -F'\t' -v OFS='\t' -v run="$i" -v load="$load" '{ $2 = run; print $0, load }' <<<"$row"
  done
done
