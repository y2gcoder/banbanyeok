#!/usr/bin/env bash
# regional-precheck.sh를 로컬 가짜 서버(python http.server)로 확인한다: 수도권 색인은 서버 주소·세대와 상관없이 통과,
# 권역 색인은 서버 주소가 없거나 4세대면 실패, 5세대면 통과. 실제 배포·Cloudflare·GCP는 쓰지 않는다.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

mkdir -p "$work/srv/v1"
printf '{"dataVersion":"20261123.1","stations":[]}\n' > "$work/capital.json"
printf '{"dataVersion":"20261123.1","stations":[],"regions":[]}\n' > "$work/regional.json"
port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
(cd "$work/srv" && exec python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1) &
server_pid=$!
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.1; done

serve() { printf '{"dataVersion":"20261123.1","schemaVersion":%s}\n' "$1" > "$work/srv/v1/manifest"; }
run() { INDEX="$work/$1.json" SERVER_ORIGIN="$2" INTERVAL=1 MAX_WAIT=2 bash "$here/regional-precheck.sh" > "$work/out" 2>&1; }
fail() { echo "FAIL $*"; cat "$work/out"; exit 1; }

serve 4
run capital "" || fail "수도권 색인·서버 주소 없음은 통과해야 한다"
echo "ok 수도권 색인은 서버 주소가 없어도 통과한다"
run capital "http://127.0.0.1:$port" || fail "수도권 색인(되돌리기)은 4세대 서버 앞에서도 통과해야 한다"
echo "ok 수도권 색인(되돌리기)은 4세대 서버 앞에서 통과한다"
if run regional ""; then fail "권역 색인·서버 주소 없음은 실패해야 한다"; fi
grep -q "SERVER_ORIGIN이 없어" "$work/out" || fail "서버 주소 없음의 이유가 없다"
echo "ok 권역 색인은 서버 주소가 없으면 공개 전에 실패한다"
if run regional "http://127.0.0.1:$port/"; then fail "권역 색인·4세대 서버는 실패해야 한다"; fi
grep -q "권역 세대 5를 아직 싣지 않음" "$work/out" || fail "4세대의 이유가 없다"
echo "ok 권역 색인은 4세대 서버 앞에서 실패한다"
serve 5
run regional "http://127.0.0.1:$port" || fail "권역 색인·5세대 서버는 통과해야 한다"
echo "ok 권역 색인은 5세대 서버 앞에서 통과한다"
