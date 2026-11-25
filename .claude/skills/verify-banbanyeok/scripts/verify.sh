#!/usr/bin/env bash
# 반반역 검증 인스턴스: launch | doctor | drive | db | cleanup | where. 사용법은 ../SKILL.md.
set -euo pipefail

skill_dir=$(cd "$(dirname "$0")/.." && pwd)
repo=$(git -C "$skill_dir" rev-parse --show-toplevel)
cd "$repo"

identity=$(printf '%s' "$PWD" | cksum | awk '{print $1}')
worktree_key="$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')-${identity}"
runs_root="${BBY_VERIFY_HOME:-$HOME/.cache/banbanyeok-verify}/${worktree_key}"

die() { echo "verify: $*" >&2; exit 1; }

run_dir() {
  if [[ -n "${BBY_VERIFY_RUN:-}" ]]; then echo "$BBY_VERIFY_RUN"; return; fi
  [[ -L "$runs_root/latest" ]] || die "이 워크트리에서 띄운 실행이 없다. 먼저 launch"
  (cd "$runs_root/latest" && pwd -P)
}

load_state() {
  RUN=$(run_dir)
  [[ -f "$RUN/state.env" ]] || die "$RUN/state.env 없음"
  # shellcheck disable=SC1091
  source "$RUN/state.env"
  export COMPOSE_PROJECT_NAME DB_PORT SERVER_PORT WEB_PORT
}

record() { printf '%s=%q\n' "$1" "$2" >> "$RUN/state.env"; }

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }

listener() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }

started_at() { ps -o lstart= -p "$1" 2>/dev/null | tr -s ' ' || true; }

group_alive() { [[ -n "${1:-}" ]] && kill -0 -- "-$1" 2>/dev/null; }

wait_for() {
  local what=$1 pgid=$2 timeout=$3; shift 3
  local deadline=$((SECONDS + timeout))
  until "$@" >/dev/null 2>&1; do
    group_alive "$pgid" || die "$what 프로세스가 끝났다. 로그: $RUN/logs/$what.log"
    (( SECONDS < deadline )) || die "$what 이(가) ${timeout}초 안에 준비되지 않았다. 로그: $RUN/logs/$what.log"
    sleep 2
  done
}

server_ready() { [[ $(curl -fsS "http://127.0.0.1:$SERVER_PORT/healthz") == ok ]]; }
web_ready() {
  curl -fsS "http://127.0.0.1:$WEB_PORT/" | grep -q '<title>[^<]*반반역' &&
    [[ $(curl -fsS "http://127.0.0.1:$WEB_PORT/api/healthz") == ok ]]
}

launch() {
  if [[ -L "$runs_root/latest" && -f "$runs_root/latest/state.env" ]]; then
    local prev; prev=$(cd "$runs_root/latest" && pwd -P)
    if ! grep -q '^STOPPED_AT=' "$prev/state.env"; then
      die "정리하지 않은 실행이 있다: $prev. 먼저 cleanup (web/.next를 같이 쓰므로 워크트리당 한 실행)"
    fi
  fi
  for tool in docker curl lsof python3 pnpm; do command -v "$tool" >/dev/null || die "$tool 필요"; done
  docker info >/dev/null 2>&1 || die "Docker가 꺼져 있다"

  local run_id; run_id="$(date +%Y%m%d-%H%M%S)-$(openssl rand -hex 2)"
  RUN="$runs_root/$run_id"
  mkdir -p "$RUN/logs" "$RUN/evidence"
  ln -sfn "$run_id" "$runs_root/latest"

  COMPOSE_PROJECT_NAME="bbyverify-${run_id}"
  DB_PORT=${DB_PORT:-$(free_port)}
  SERVER_PORT=${SERVER_PORT:-$(free_port)}
  WEB_PORT=${WEB_PORT:-$(free_port)}
  export COMPOSE_PROJECT_NAME DB_PORT SERVER_PORT WEB_PORT
  for port in "$DB_PORT" "$SERVER_PORT" "$WEB_PORT"; do
    [[ -z $(listener "$port") ]] || die "포트 $port 를 이미 누가 쓰고 있다"
  done
  : > "$RUN/state.env"
  record RUN_ID "$run_id"
  record REPO_HEAD "$(git rev-parse HEAD)"
  record REPO_DIRTY "$(git status --porcelain | wc -l | tr -d ' ')"
  record COMPOSE_PROJECT_NAME "$COMPOSE_PROJECT_NAME"
  record DB_PORT "$DB_PORT"
  record SERVER_PORT "$SERVER_PORT"
  record WEB_PORT "$WEB_PORT"
  record LAUNCHED_AT "$(date -u +%FT%TZ)"
  echo "run: $RUN"
  echo "ports: db=$DB_PORT server=$SERVER_PORT web=$WEB_PORT project=$COMPOSE_PROJECT_NAME"

  echo "db: 빈 볼륨으로 시작(healthy까지 대기)"
  bash scripts/dev.sh db > "$RUN/logs/db.log" 2>&1 || die "db 실패. 로그: $RUN/logs/db.log"
  echo "migrate: Liquibase changelog 적용"
  bash scripts/dev.sh migrate > "$RUN/logs/migrate.log" 2>&1 || die "migrate 실패. 로그: $RUN/logs/migrate.log"
  echo "seed: 예시 방 하나"
  bash scripts/dev.sh seed > "$RUN/logs/seed.log" 2>&1 || die "seed 실패. 로그: $RUN/logs/seed.log"

  set -m
  echo "server: gradle :server:app:run (/healthz 대기)"
  bash scripts/dev.sh server > "$RUN/logs/server.log" 2>&1 &
  SERVER_PGID=$!
  record SERVER_PGID "$SERVER_PGID"
  wait_for server "$SERVER_PGID" 300 server_ready

  echo "web: next dev (첫 화면과 /api/healthz 프록시 대기)"
  bash scripts/dev.sh web > "$RUN/logs/web.log" 2>&1 &
  WEB_PGID=$!
  record WEB_PGID "$WEB_PGID"
  wait_for web "$WEB_PGID" 300 web_ready
  set +m

  local spid wpid
  spid=$(listener "$SERVER_PORT"); wpid=$(listener "$WEB_PORT")
  record SERVER_LISTENER_PID "$spid"
  record SERVER_LISTENER_STARTED "$(started_at "$spid")"
  record WEB_LISTENER_PID "$wpid"
  record WEB_LISTENER_STARTED "$(started_at "$wpid")"
  echo "ready: web http://localhost:$WEB_PORT  server http://127.0.0.1:$SERVER_PORT"
  echo "evidence: $RUN/evidence"
}

doctor() {
  load_state
  local fail=0
  ok() { echo "ok   $*"; }
  bad() { echo "FAIL $*"; fail=1; }
  warn() { echo "warn $*"; }

  echo "run: $RUN"
  if grep -q '^STOPPED_AT=' "$RUN/state.env"; then bad "이미 정리한 실행이다(STOPPED_AT). 새로 launch"; fi

  local mapped; mapped=$(docker compose port db 5432 2>/dev/null || true)
  if [[ $mapped == "127.0.0.1:$DB_PORT" ]]; then ok "db: 프로젝트 $COMPOSE_PROJECT_NAME 컨테이너가 $mapped"
  else bad "db: 프로젝트 $COMPOSE_PROJECT_NAME 의 5432 매핑이 '$mapped' (기대 127.0.0.1:$DB_PORT)"; fi

  local role
  for role in server web; do
    local up; up=$(echo "$role" | tr '[:lower:]' '[:upper:]')
    local port_var="${up}_PORT" pid_var="${up}_LISTENER_PID" st_var="${up}_LISTENER_STARTED" pg_var="${up}_PGID"
    local port=${!port_var} want=${!pid_var:-} pgid=${!pg_var:-}
    local have; have=$(listener "$port")
    if [[ -z $have ]]; then bad "$role: 포트 $port 에 듣는 프로세스가 없다"
    elif [[ $have != "$want" || "$(started_at "$have")" != "${!st_var:-}" ]]; then
      bad "$role: 포트 $port 주인 PID $have 는 이 실행이 띄운 $want 가 아니다"
    else ok "$role: 포트 $port 주인 PID $have (이 실행이 띄움)"; fi
    group_alive "$pgid" || warn "$role: 시작한 프로세스 그룹 $pgid 이(가) 없다"
  done

  if server_ready; then ok "server: /healthz ok"; else bad "server: /healthz 응답 없음"; fi
  local served local_v
  served=$(curl -fsS "http://127.0.0.1:$SERVER_PORT/v1/manifest" | python3 -c 'import json,sys; print(json.load(sys.stdin)["dataVersion"])' 2>/dev/null || true)
  local_v=$(python3 -c 'import json; print(json.load(open("data/artifacts/dev/manifest.json"))["dataVersion"])')
  if [[ $served == "$local_v" ]]; then ok "server: 데이터 버전 $served (data/artifacts/dev와 같음)"
  else bad "server: 데이터 버전 '$served', 작업 트리는 $local_v"; fi

  if web_ready; then ok "web: 첫 화면 <title> 반반역, /api/healthz가 이 서버로 프록시"
  else bad "web: 첫 화면 또는 /api/healthz 프록시 실패"; fi

  local head dirty; head=$(git rev-parse HEAD); dirty=$(git status --porcelain | wc -l | tr -d ' ')
  if [[ $head == "$REPO_HEAD" ]]; then ok "build: HEAD ${head:0:9} (띄울 때와 같음, 바뀐 파일 ${dirty}개, 띄울 때 ${REPO_DIRTY}개)"
  else warn "build: 띄운 뒤 HEAD가 ${REPO_HEAD:0:9} → ${head:0:9}. 웹은 다시 읽지만 서버는 아니다. 서버 변경을 보려면 cleanup 후 launch"; fi
  return "$fail"
}

drive() {
  load_state
  (( $# >= 1 )) || die "drive <여정 이름 또는 .mjs 경로> [phone|desktop]"
  BBY_VERIFY_RUN="$RUN" BBY_REPO="$repo" BBY_SKILL="$skill_dir" node "$skill_dir/scripts/drive.mjs" "$@"
}

db() {
  load_state
  (( $# == 1 )) || die "db '<SQL>'"
  docker compose exec -T db psql -U local -d banbanyeok -X -A -F $'\t' -P footer=off -c "$1"
}

stop_group() {
  local name=$1 pgid=$2 pid=$3 started=$4
  if group_alive "$pgid"; then
    kill -TERM -- "-$pgid" 2>/dev/null || true
    for _ in $(seq 1 15); do group_alive "$pgid" || break; sleep 1; done
    group_alive "$pgid" && kill -KILL -- "-$pgid" 2>/dev/null || true
  fi
  if [[ -n $pid ]] && kill -0 "$pid" 2>/dev/null && [[ "$(started_at "$pid")" == "$started" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 15); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  fi
  echo "stopped: $name (pgid $pgid, listener $pid)"
}

cleanup() {
  load_state
  stop_group web "${WEB_PGID:-}" "${WEB_LISTENER_PID:-}" "${WEB_LISTENER_STARTED:-}"
  stop_group server "${SERVER_PGID:-}" "${SERVER_LISTENER_PID:-}" "${SERVER_LISTENER_STARTED:-}"
  docker compose --profile tools down -v --rmi local --remove-orphans > "$RUN/logs/cleanup-compose.log" 2>&1 ||
    echo "warn: compose down 실패. 로그: $RUN/logs/cleanup-compose.log"
  echo "removed: compose 프로젝트 $COMPOSE_PROJECT_NAME (컨테이너·볼륨·migrate 이미지)"
  local left=0
  for port in "$DB_PORT" "$SERVER_PORT" "$WEB_PORT"; do
    if [[ -n $(listener "$port") ]]; then echo "FAIL 포트 $port 에 아직 프로세스가 있다: PID $(listener "$port")"; left=1; fi
  done
  grep -q '^STOPPED_AT=' "$RUN/state.env" || record STOPPED_AT "$(date -u +%FT%TZ)"
  echo "evidence kept: $RUN/evidence"
  find "$RUN/evidence" -mindepth 1 -maxdepth 1 | sed 's/^/  /'
  return "$left"
}

where() { run_dir; }

cmd=${1:-}; shift || true
case "$cmd" in
  launch) launch ;;
  doctor) doctor ;;
  drive) drive "$@" ;;
  db) db "$@" ;;
  cleanup) cleanup ;;
  where) where ;;
  *) die "사용법: verify.sh {launch|doctor|drive <여정> [phone|desktop]|db '<SQL>'|cleanup|where}" ;;
esac
