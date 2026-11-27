#!/usr/bin/env bash
# 같은 기계·같은 입력으로 웹 Worker 빌드를 N번 깨끗하게(산출물·빌드 캐시 삭제) 돌려 빌드 시간과 업로드 크기를 잰다.
#   bash spikes/vinext/measure-build.sh opennext 3 > spikes/vinext/results/build-opennext.tsv
#   bash spikes/vinext/measure-build.sh vinext 3   > spikes/vinext/results/build-vinext.tsv
#   VINEXT_SEO_BUNDLE=1 LABEL=vinext-seo bash spikes/vinext/measure-build.sh vinext 3 > spikes/vinext/results/build-vinext-seo.tsv
# 크기는 `wrangler deploy --dry-run`이 내는 Total Upload(raw / gzip)다. 네트워크 배포는 하지 않는다.
# 빌드 값은 deploy-web.yml과 같은 이름을 쓰고 공개 키(PostHog·카카오)는 비운다(합성 비교).
set -euo pipefail

target="${1:?opennext|vinext}"
runs="${2:-3}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
web="$root/web"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

export SITE_URL="${SITE_URL:-https://banbanyeok.app}" SITE_NOINDEX="${SITE_NOINDEX:-}"
NEXT_PUBLIC_APP_VERSION="$(git -C "$root" rev-parse --short=7 HEAD)"
export API_ORIGIN="${API_ORIGIN:-http://127.0.0.1:8080}" NEXT_PUBLIC_APP_VERSION
export NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_POSTHOG_KEY="" NEXT_PUBLIC_POSTHOG_HOST="" NEXT_PUBLIC_KAKAO_JS_KEY=""

now() { python3 -c 'import time; print(time.monotonic())'; }

printf 'target\trun\tbuild_s\tcache_s\tupload_kib\tgzip_kib\tsha\n'
for i in $(seq 1 "$runs"); do
  cd "$web"
  case "$target" in
    opennext)
      rm -rf .next .open-next .wrangler/tmp
      t0="$(now)"; pnpm cf:build >"$out/build-$i.log" 2>&1; t1="$(now)"
      # 배포 경로는 빌드 뒤에 정적 증분 캐시를 채운다(deploy-web.yml populateCache). 로컬 복사 시간을 따로 잰다.
      c0="$(now)"; pnpm exec opennextjs-cloudflare populateCache local >"$out/populate-$i.log" 2>&1; c1="$(now)"
      pnpm exec wrangler deploy --dry-run --outdir "$out/w$i" >"$out/dry-$i.log" 2>&1
      ;;
    vinext)
      rm -rf dist .vinext .cloudflare/output node_modules/.vite .wrangler/tmp
      t0="$(now)"; pnpm build:vinext >"$out/build-$i.log" 2>&1; t1="$(now)"
      c0=0; c1=0  # vinext는 사전 렌더가 빌드 안에 있고 따로 채우는 단계가 없다
      env -u CLOUDFLARE_API_TOKEN pnpm exec cf deploy --prebuilt --dry-run --mode production >"$out/dry-$i.log" 2>&1
      ;;
    *) echo "unknown target $target" >&2; exit 2 ;;
  esac
  sizes="$(grep -oE 'Total Upload: [0-9.]+ KiB / gzip: [0-9.]+ KiB' "$out/dry-$i.log" | tail -1)"
  upload="$(sed -E 's#Total Upload: ([0-9.]+) KiB.*#\1#' <<<"$sizes")"
  gzip="$(sed -E 's#.*gzip: ([0-9.]+) KiB#\1#' <<<"$sizes")"
  printf '%s\t%s\t%.1f\t%.1f\t%s\t%s\t%s\n' "${LABEL:-$target}" "$i" "$(python3 -c "print($t1-$t0)")" "$(python3 -c "print($c1-$c0)")" "${upload:-?}" "${gzip:-?}" "$NEXT_PUBLIC_APP_VERSION"
  cp "$out/build-$i.log" "$root/spikes/vinext/results/build-$target-$i.log" 2>/dev/null || true
  cp "$out/dry-$i.log" "$root/spikes/vinext/results/dry-$target-$i.log" 2>/dev/null || true
done
