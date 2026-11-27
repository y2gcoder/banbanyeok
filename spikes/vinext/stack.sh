#!/usr/bin/env bash
# OpenNext Worker와 vinext Worker를 같은 로컬 Ktor 서버(빈 DB, 합성 데이터) 앞에 나란히 띄운다. 외부 배포·클라우드 호출은 하지 않는다.
#   bash spikes/vinext/stack.sh up      # DB → migrate → 서버 → 두 Worker 빌드 → 로컬 workerd 둘
#   bash spikes/vinext/stack.sh restart # 두 Worker만 다시 띄운다(콜드 측정용, 빌드는 그대로)
#   bash spikes/vinext/stack.sh down    # 띄운 PID(자손 포함)와 compose 프로젝트만 정리
# 상태는 저장소 밖($STATE)에 둔다. 프록시 공유 비밀은 실행마다 새로 만든 합성 값이고 출력하지 않는다.
# CANONICAL_HOST=banbanyeok.app 을 주면 두 Worker 모두 정식 도메인 리디렉트를 켠 채로 뜬다(리디렉트 비교용).
set -euo pipefail

cmd="${1:?up|restart|down|env}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
web="$root/web"
STATE="${STATE:-$HOME/.cache/banbanyeok-vinext-spike}"
mkdir -p "$STATE/logs"

DB_PORT="${DB_PORT:-55433}" SERVER_PORT="${SERVER_PORT:-18081}"
OPENNEXT_PORT="${OPENNEXT_PORT:-18787}" VINEXT_PORT="${VINEXT_PORT:-18788}"
CANONICAL_HOST="${CANONICAL_HOST:-}"
export COMPOSE_PROJECT_NAME=bbyvinext COMPOSE_FILE="$root/compose.yaml" DB_PORT SERVER_PORT

regional() { [[ -f "$root/data/artifacts/dev/regional/manifest.v5.json" ]] && echo true || echo false; }

wait_http() { # <url> <seconds>
  for _ in $(seq 1 "$2"); do curl -q --noproxy '*' -sf -o /dev/null "$1" && return 0; sleep 1; done
  echo "timeout: $1" >&2; return 1
}

descendants() { local p; for p in $(pgrep -P "$1" 2>/dev/null || true); do descendants "$p"; echo "$p"; done; }

stop_pidfile() { # <name>
  local f="$STATE/$1.pid" pid
  [[ -f "$f" ]] || return 0
  pid="$(cat "$f")"
  if kill -0 "$pid" 2>/dev/null; then
    local all; all="$(descendants "$pid") $pid"
    kill $all 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -9 $all 2>/dev/null || true
  fi
  rm -f "$f"
}

build_env() {
  export SITE_URL=https://banbanyeok.app SITE_NOINDEX='' API_ORIGIN="http://127.0.0.1:$SERVER_PORT" CANONICAL_HOST
  export NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_POSTHOG_KEY='' NEXT_PUBLIC_POSTHOG_HOST='' NEXT_PUBLIC_KAKAO_JS_KEY=
  NEXT_PUBLIC_APP_VERSION="$(git -C "$root" rev-parse --short=7 HEAD)"; export NEXT_PUBLIC_APP_VERSION
}

start_workers() {
  build_env
  [[ -f "$STATE/proxy-secret" ]] || { python3 -c 'import secrets;print(secrets.token_urlsafe(32))' > "$STATE/proxy-secret"; chmod 600 "$STATE/proxy-secret"; }
  # 두 도구 모두 web/.dev.vars에서 Worker secret을 읽는다(gitignore됨). 실험이 끝나면 down이 지운다.
  printf 'PROXY_SHARED_SECRET=%s\n' "$(cat "$STATE/proxy-secret")" > "$web/.dev.vars"; chmod 600 "$web/.dev.vars"
  cd "$web"
  nohup pnpm exec wrangler dev --ip 127.0.0.1 --port "$OPENNEXT_PORT" --inspector-port 0 \
    --var "API_ORIGIN:$API_ORIGIN" --var "CANONICAL_HOST:$CANONICAL_HOST" > "$STATE/logs/opennext.log" 2>&1 &
  echo $! > "$STATE/opennext.pid"
  nohup env VINEXT=1 pnpm exec vite preview --host 127.0.0.1 --port "$VINEXT_PORT" --strictPort > "$STATE/logs/vinext.log" 2>&1 &
  echo $! > "$STATE/vinext.pid"
  wait_http "http://127.0.0.1:$OPENNEXT_PORT/robots.txt" 120
  wait_http "http://127.0.0.1:$VINEXT_PORT/robots.txt" 120
  echo "ready: opennext http://localhost:$OPENNEXT_PORT vinext http://localhost:$VINEXT_PORT server http://127.0.0.1:$SERVER_PORT"
}

case "$cmd" in
  up)
    cd "$root"
    bash scripts/dev.sh db > "$STATE/logs/db.log" 2>&1
    bash scripts/dev.sh migrate > "$STATE/logs/migrate.log" 2>&1
    ./gradlew :server:app:installDist --console=plain -q > "$STATE/logs/install.log" 2>&1
    [[ -f "$STATE/proxy-secret" ]] || { python3 -c 'import secrets;print(secrets.token_urlsafe(32))' > "$STATE/proxy-secret"; chmod 600 "$STATE/proxy-secret"; }
    origins="http://localhost:$OPENNEXT_PORT,http://127.0.0.1:$OPENNEXT_PORT,http://localhost:$VINEXT_PORT,http://127.0.0.1:$VINEXT_PORT"
    PROXY_SHARED_SECRET="$(cat "$STATE/proxy-secret")" \
    APP_PROFILE=local PORT="$SERVER_PORT" \
    DATABASE_URL="jdbc:postgresql://127.0.0.1:$DB_PORT/banbanyeok" DATABASE_USER=local DATABASE_PASSWORD=local-development-only \
    ARTIFACT_STORE=local ARTIFACT_LOCAL_DIR="$root/data/artifacts/dev" REGIONAL_ARTIFACTS="$(regional)" \
    CORS_ALLOWED_ORIGINS="$origins" \
    RATE_LIMIT_WRITE_BURST=400 RATE_LIMIT_WRITE_PER_MINUTE=400 RATE_LIMIT_CREATE_BURST=200 \
    RATE_LIMIT_GENERAL_BURST=2000 RATE_LIMIT_GENERAL_PER_MINUTE=2000 \
      nohup "$root/server/app/build/install/app/bin/app" > "$STATE/logs/server.log" 2>&1 &
    echo $! > "$STATE/server.pid"
    wait_http "http://127.0.0.1:$SERVER_PORT/healthz" 120
    build_env
    (cd "$web" && rm -rf .next .open-next && pnpm cf:build > "$STATE/logs/build-opennext.log" 2>&1 \
      && pnpm exec opennextjs-cloudflare populateCache local > "$STATE/logs/populate.log" 2>&1)
    (cd "$web" && rm -rf dist .cloudflare/output && pnpm build:vinext > "$STATE/logs/build-vinext.log" 2>&1)
    start_workers
    ;;
  restart)
    stop_pidfile opennext; stop_pidfile vinext; start_workers ;;
  down)
    stop_pidfile opennext; stop_pidfile vinext; stop_pidfile server
    rm -f "$web/.dev.vars"
    (cd "$root" && docker compose --profile tools down -v --rmi local > "$STATE/logs/down.log" 2>&1) || echo "FAIL compose down (로그: $STATE/logs/down.log)"
    for p in "$DB_PORT" "$SERVER_PORT" "$OPENNEXT_PORT" "$VINEXT_PORT"; do
      lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && echo "FAIL port $p still listening" || true
    done
    echo "down"
    ;;
  env) echo "OPENNEXT=http://localhost:$OPENNEXT_PORT VINEXT=http://localhost:$VINEXT_PORT SERVER=http://127.0.0.1:$SERVER_PORT" ;;
  *) echo "usage: stack.sh up|restart|down|env" >&2; exit 2 ;;
esac
