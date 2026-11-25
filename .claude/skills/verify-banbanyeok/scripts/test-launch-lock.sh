#!/usr/bin/env bash
# 회귀: 실행 폴더 경로에 작은따옴표가 있어도 launch가 끝날 때 잠금이 풀려, 다시 부른 launch가 잠금으로 거절되지 않는다.
# Docker 없이 돈다(점유 포트에서 launch가 멈추게 한다). 사용: bash .claude/skills/verify-banbanyeok/scripts/test-launch-lock.sh
set -euo pipefail
verify="$(cd "$(dirname "$0")" && pwd)/verify.sh"
tmp=$(mktemp -d)
python3 -I -c 'import socket, time; s = socket.socket(); s.bind(("127.0.0.1", 0)); s.listen(); print(s.getsockname()[1], flush=True); time.sleep(60)' > "$tmp/port" &
holder=$!
trap 'kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null || true; rm -r -- "$tmp"' EXIT
until [[ -s "$tmp/port" ]]; do sleep 0.1; done
home="$tmp/it's home"
for attempt in 1 2; do
  out=$(BBY_VERIFY_HOME="$home" DB_PORT=$(cat "$tmp/port") bash "$verify" launch 2>&1 || true)
  grep -q '이미 누가 쓰고 있다' <<< "$out" || { echo "FAIL attempt $attempt: $out"; exit 1; }
done
[[ -z $(find "$home" -name launch.lock) ]] || { echo "FAIL: launch.lock이 남았다"; exit 1; }
echo "PASS: 따옴표가 든 경로에서도 잠금이 풀린다"
