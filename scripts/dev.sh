#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/dev-env.sh
# 서버(Ktor)가 읽는 설정. 로컬 프로필 기본값 위에 이 워크트리의 포트를 덮어쓴다(이미 지정했으면 그대로 둔다).
export DATABASE_URL="${DATABASE_URL:-jdbc:postgresql://127.0.0.1:${DB_PORT}/banbanyeok}"
export CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}}"
case "${1:-}" in
  config) printf 'project=%s DB_PORT=%s SERVER_PORT=%s WEB_PORT=%s\n' "$COMPOSE_PROJECT_NAME" "$DB_PORT" "$SERVER_PORT" "$WEB_PORT" ;;
  db) shift; if (( $# )); then docker compose "$@"; else docker compose up -d --wait db; fi ;;
  migrate) docker compose run --rm migrate ;;
  seed) ./gradlew :server:app:run --args=seed --console=plain -q ;;
  server) ./gradlew :server:app:run --console=plain ;;
  web|web:mock)
    if [[ ! -f web/package.json ]]; then echo 'web/ 앱은 P4에서 추가됩니다. 현재는 서버만 실행할 수 있습니다.'; exit 0; fi
    if [[ $1 == web:mock ]]; then export NEXT_PUBLIC_API_MOCKING=enabled; fi
    pnpm --dir web dev --port "$WEB_PORT" ;;
  all)
    bash scripts/dev.sh db
    bash scripts/dev.sh migrate
    bash scripts/dev.sh seed
    bash scripts/dev.sh server & server_pid=$!
    trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM
    bash scripts/dev.sh web & web_pid=$!
    trap 'kill "$server_pid" "$web_pid" 2>/dev/null || true' EXIT INT TERM
    wait "$server_pid" ;;
  *) echo 'usage: dev.sh {config|db [compose args]|migrate|seed|server|web|web:mock|all}' >&2; exit 2 ;;
esac
