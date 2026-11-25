#!/usr/bin/env bash
# 반반역 검증 인스턴스: launch | doctor | drive | db | cleanup | where. 사용법은 ../SKILL.md.
set -euo pipefail

skill_dir=$(cd "$(dirname "$0")/.." && pwd)
repo=$(git -C "$skill_dir" rev-parse --show-toplevel)
cd "$repo"

identity=$(printf '%s' "$PWD" | cksum | awk '{print $1}')
worktree_key="$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')-${identity}"
runs_root="${BBY_VERIFY_HOME:-$HOME/.cache/banbanyeok-verify}/${worktree_key}"
server_bin="$repo/server/app/build/install/app/bin/app"
# 서버 프로세스의 동작을 정하는 경로. 띄운 뒤 여기가 바뀌면 떠 있는 서버는 낡은 것이다.
server_paths=(server shared build-logic gradle build.gradle.kts settings.gradle.kts gradle.properties data/artifacts/dev)

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
}

record() { printf '%s=%q\n' "$1" "$2" >> "$RUN/state.env"; }

# 사용자 셸의 설정(DATABASE_URL, API_ORIGIN, COMPOSE_FILE, 각종 키)이 실행에 새지 않게 환경을 비우고 이 실행의 값만 넣는다.
# 웹의 키 이름은 빈 값으로 넣는다. Next는 이미 있는 변수를 web/.env* 파일로 덮어쓰지 않는다.
in_run_env() {
  local keep=() v
  for v in PATH HOME USER LOGNAME SHELL TMPDIR LANG LC_ALL LC_CTYPE TERM JAVA_HOME GRADLE_USER_HOME DOCKER_HOST DOCKER_CONTEXT DOCKER_CONFIG; do
    if [[ -n ${!v:-} ]]; then keep+=("$v=${!v}"); fi
  done
  env -i ${keep[@]+"${keep[@]}"} \
    COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" COMPOSE_FILE="$repo/compose.yaml" \
    DB_PORT="$DB_PORT" SERVER_PORT="$SERVER_PORT" WEB_PORT="$WEB_PORT" \
    APP_PROFILE=local \
    DATABASE_URL="jdbc:postgresql://127.0.0.1:${DB_PORT}/banbanyeok" DATABASE_USER=local DATABASE_PASSWORD=local-development-only \
    ARTIFACT_STORE=local ARTIFACT_LOCAL_DIR="$repo/data/artifacts/dev" \
    CORS_ALLOWED_ORIGINS="http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}" \
    RATE_LIMIT_WRITE_BURST=200 RATE_LIMIT_WRITE_PER_MINUTE=200 RATE_LIMIT_CREATE_BURST=100 \
    RATE_LIMIT_GENERAL_BURST=600 RATE_LIMIT_GENERAL_PER_MINUTE=600 \
    API_ORIGIN="http://127.0.0.1:${SERVER_PORT}" NEXT_PUBLIC_API_MOCKING= \
    NEXT_PUBLIC_POSTHOG_KEY= NEXT_PUBLIC_POSTHOG_HOST= NEXT_PUBLIC_KAKAO_JS_KEY= PROXY_SHARED_SECRET= \
    "$@"
}

server_fingerprint() {
  {
    local p
    for p in "${server_paths[@]}"; do git rev-parse "HEAD:$p" 2>/dev/null || echo "missing $p"; done
    git diff HEAD --binary -- "${server_paths[@]}"
    git ls-files -o --exclude-standard -- "${server_paths[@]}" | while IFS= read -r f; do shasum -a 256 "$f"; done
  } | shasum -a 256 | cut -c1-16
}

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }
listener() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }
started_at() { ps -o lstart= -p "$1" 2>/dev/null | tr -s ' ' || true; }
owned_pid() { [[ -n ${1:-} ]] && kill -0 "$1" 2>/dev/null && [[ "$(started_at "$1")" == "$2" ]]; }

# 리더와 그 자손(부모 사슬이 리더에 닿는 프로세스). pnpm은 스크립트를 다른 프로세스 그룹에서 돌리므로 그룹이 아니라 사슬로 본다.
descendants() {
  [[ -n ${1:-} ]] || return 0
  ps -axo pid=,ppid= | awk -v root="$1" '{ parent[$1] = $2 }
    END { for (pid in parent) { x = pid; while ((x in parent) && x != root && x > 1) x = parent[x]; if (x == root) print pid } }'
}

# 리더가 살아 있고 시작 시각이 기록과 같을 때만 그 자손을 이 실행의 것으로 본다.
owned_tree() { if owned_pid "$1" "$2"; then descendants "$1"; fi; }

# 포트 주인이 이 실행이 시작한 리더의 자손인가.
owned_listener() {
  local pid; pid=$(listener "$1")
  [[ -n $pid ]] && owned_tree "$2" "$3" | grep -qx "$pid"
}

server_healthy() { [[ $(curl -fsS "http://127.0.0.1:$SERVER_PORT/healthz") == ok ]]; }
# seed 방은 이 실행의 DB에만 있다. 웹 프록시로 그 방이 보이면 프록시 대상이 이 서버다.
seed_room_via() { curl -fsS "$1/rooms/$SEED_ROOM_ID" | python3 -c 'import json,sys; print(json.load(sys.stdin)["roomId"])'; }
server_ready() { owned_listener "$SERVER_PORT" "$SERVER_LEADER" "$SERVER_LEADER_STARTED" && server_healthy; }
web_ready() {
  owned_listener "$WEB_PORT" "$WEB_LEADER" "$WEB_LEADER_STARTED" &&
    curl -fsS "http://127.0.0.1:$WEB_PORT/" | grep -q '<title>[^<]*반반역' &&
    [[ $(seed_room_via "http://127.0.0.1:$WEB_PORT/api/v1") == "$SEED_ROOM_ID" ]]
}

wait_for() {
  local what=$1 leader=$2 timeout=$3; shift 3
  local deadline=$((SECONDS + timeout))
  until "$@" >/dev/null 2>&1; do
    kill -0 "$leader" 2>/dev/null || die "$what 프로세스가 끝났다. 로그: $RUN/logs/$what.log"
    (( SECONDS < deadline )) || die "$what 이(가) ${timeout}초 안에 준비되지 않았다(포트 주인이 이 실행이 아니어도 그렇다). 로그: $RUN/logs/$what.log"
    sleep 2
  done
}

launch() {
  if [[ -L "$runs_root/latest" && -f "$runs_root/latest/state.env" ]]; then
    local prev; prev=$(cd "$runs_root/latest" && pwd -P)
    if ! grep -q '^STOPPED_AT=' "$prev/state.env"; then
      die "정리하지 않은 실행이 있다: $prev. 먼저 cleanup (web/.next를 같이 쓰므로 워크트리당 한 실행)"
    fi
  fi
  for tool in docker curl lsof python3 pnpm shasum; do command -v "$tool" >/dev/null || die "$tool 필요"; done
  docker info >/dev/null 2>&1 || die "Docker가 꺼져 있다"

  local run_id; run_id="$(date +%Y%m%d-%H%M%S)-$(openssl rand -hex 2)"
  COMPOSE_PROJECT_NAME="bbyverify-${run_id}"
  DB_PORT=${DB_PORT:-$(free_port)}
  SERVER_PORT=${SERVER_PORT:-$(free_port)}
  WEB_PORT=${WEB_PORT:-$(free_port)}
  for port in "$DB_PORT" "$SERVER_PORT" "$WEB_PORT"; do
    [[ -z $(listener "$port") ]] || die "포트 $port 를 이미 누가 쓰고 있다"
  done

  RUN="$runs_root/$run_id"
  mkdir -p "$RUN/logs" "$RUN/evidence"
  : > "$RUN/state.env"
  record RUN_ID "$run_id"
  record REPO_HEAD "$(git rev-parse HEAD)"
  record COMPOSE_PROJECT_NAME "$COMPOSE_PROJECT_NAME"
  record DB_PORT "$DB_PORT"
  record SERVER_PORT "$SERVER_PORT"
  record WEB_PORT "$WEB_PORT"
  record LAUNCHED_AT "$(date -u +%FT%TZ)"
  ln -sfn "$run_id" "$runs_root/latest"
  echo "run: $RUN"
  echo "ports: db=$DB_PORT server=$SERVER_PORT web=$WEB_PORT project=$COMPOSE_PROJECT_NAME"

  echo "db: 빈 볼륨으로 시작(healthy까지 대기)"
  in_run_env bash scripts/dev.sh db > "$RUN/logs/db.log" 2>&1 || die "db 실패. 로그: $RUN/logs/db.log"
  echo "migrate: Liquibase changelog 적용"
  in_run_env bash scripts/dev.sh migrate > "$RUN/logs/migrate.log" 2>&1 || die "migrate 실패. 로그: $RUN/logs/migrate.log"
  echo "build: 서버 설치본(:server:app:installDist)"
  SERVER_FINGERPRINT=$(server_fingerprint)
  record SERVER_FINGERPRINT "$SERVER_FINGERPRINT"
  in_run_env ./gradlew :server:app:installDist --console=plain -q > "$RUN/logs/build.log" 2>&1 || die "서버 빌드 실패. 로그: $RUN/logs/build.log"
  echo "seed: 예시 방 하나"
  in_run_env "$server_bin" seed > "$RUN/logs/seed.log" 2>&1 || die "seed 실패. 로그: $RUN/logs/seed.log"
  SEED_ROOM_ID=$(sed -n 's/^roomId=\([0-9a-z]*\)$/\1/p' "$RUN/logs/seed.log")
  [[ -n $SEED_ROOM_ID ]] || die "seed 출력에 roomId가 없다. 로그: $RUN/logs/seed.log"
  record SEED_ROOM_ID "$SEED_ROOM_ID"

  # 셸 작업 제어(set -m)로 띄워야 이 명령을 부른 도구가 끝날 때 함께 꺼지지 않는다.
  echo "server: 설치본 실행(/healthz 대기)"
  set -m; in_run_env "$server_bin" > "$RUN/logs/server.log" 2>&1 & SERVER_LEADER=$!; set +m
  SERVER_LEADER_STARTED=$(started_at "$SERVER_LEADER")
  record SERVER_LEADER "$SERVER_LEADER"
  record SERVER_LEADER_STARTED "$SERVER_LEADER_STARTED"
  wait_for server "$SERVER_LEADER" 120 server_ready

  echo "web: next dev (첫 화면과 프록시로 seed 방 대기)"
  set -m; in_run_env bash scripts/dev.sh web > "$RUN/logs/web.log" 2>&1 & WEB_LEADER=$!; set +m
  WEB_LEADER_STARTED=$(started_at "$WEB_LEADER")
  record WEB_LEADER "$WEB_LEADER"
  record WEB_LEADER_STARTED "$WEB_LEADER_STARTED"
  wait_for web "$WEB_LEADER" 300 web_ready

  local role pid
  for role in server web; do
    local up; up=$(echo "$role" | tr '[:lower:]' '[:upper:]')
    local port_var="${up}_PORT" leader_var="${up}_LEADER" st_var="${up}_LEADER_STARTED"
    pid=$(listener "${!port_var}")
    owned_listener "${!port_var}" "${!leader_var}" "${!st_var}" || die "포트 ${!port_var} 주인 PID $pid 가 이 실행이 시작한 프로세스가 아니다"
    record "${up}_LISTENER_PID" "$pid"
    record "${up}_LISTENER_STARTED" "$(started_at "$pid")"
    owned_tree "${!leader_var}" "${!st_var}" | while read -r p; do printf '%s\t%s\n' "$p" "$(started_at "$p")"; done > "$RUN/procs-$role.tsv"
  done
  echo "ready: web http://localhost:$WEB_PORT  server http://127.0.0.1:$SERVER_PORT"
  echo "evidence: $RUN/evidence"
}

doctor() {
  load_state
  local fail=0
  ok() { echo "ok   $*"; }
  bad() { echo "FAIL $*"; fail=1; }

  echo "run: $RUN"
  if grep -q '^STOPPED_AT=' "$RUN/state.env"; then bad "이미 정리한 실행이다(STOPPED_AT). 새로 launch"; fi

  local mapped; mapped=$(in_run_env docker compose port db 5432 2>/dev/null || true)
  if [[ $mapped == "127.0.0.1:$DB_PORT" ]]; then ok "db: 프로젝트 $COMPOSE_PROJECT_NAME 컨테이너가 $mapped"
  else bad "db: 프로젝트 $COMPOSE_PROJECT_NAME 의 5432 매핑이 '$mapped' (기대 127.0.0.1:$DB_PORT)"; fi

  local role
  for role in server web; do
    local up; up=$(echo "$role" | tr '[:lower:]' '[:upper:]')
    local port_var="${up}_PORT" pid_var="${up}_LISTENER_PID" st_var="${up}_LISTENER_STARTED"
    local leader_var="${up}_LEADER" lst_var="${up}_LEADER_STARTED"
    local port=${!port_var} want=${!pid_var:-} have; have=$(listener "$port")
    if [[ $have == "$want" ]] && owned_pid "$have" "${!st_var:-}" && owned_listener "$port" "${!leader_var:-}" "${!lst_var:-}"; then
      ok "$role: 포트 $port 주인 PID $have, 이 실행이 시작한 ${!leader_var}의 자손"
    else bad "$role: 포트 $port 주인 '$have' 가 이 실행이 시작한 ${!leader_var:-?}의 자손 $want 가 아니다"; fi
  done

  if server_healthy; then ok "server: /healthz ok"; else bad "server: /healthz 응답 없음"; fi
  local served local_v
  served=$(curl -fsS "http://127.0.0.1:$SERVER_PORT/v1/manifest" | python3 -c 'import json,sys; print(json.load(sys.stdin)["dataVersion"])' 2>/dev/null || true)
  local_v=$(python3 -c 'import json; print(json.load(open("data/artifacts/dev/manifest.json"))["dataVersion"])')
  if [[ $served == "$local_v" ]]; then ok "server: 데이터 버전 $served (data/artifacts/dev와 같음)"
  else bad "server: 데이터 버전 '$served', 작업 트리는 $local_v"; fi

  local now_fp; now_fp=$(server_fingerprint)
  if [[ $now_fp == "${SERVER_FINGERPRINT:-}" ]]; then ok "server: 빌드 지문 $now_fp (띄운 뒤 서버 쪽 파일 변경 없음)"
  else bad "server: 띄운 뒤 서버 쪽 파일이 바뀌었다(지문 ${SERVER_FINGERPRINT:-?} → $now_fp). cleanup 후 launch"; fi

  if curl -fsS "http://127.0.0.1:$WEB_PORT/" 2>/dev/null | grep -q '<title>[^<]*반반역'; then ok "web: 첫 화면 <title> 반반역"
  else bad "web: 첫 화면 응답 없음"; fi
  local direct proxied
  direct=$(seed_room_via "http://127.0.0.1:$SERVER_PORT/v1" 2>/dev/null || true)
  proxied=$(seed_room_via "http://127.0.0.1:$WEB_PORT/api/v1" 2>/dev/null || true)
  if [[ -n $direct && $direct == "${SEED_ROOM_ID:-}" && $proxied == "$direct" ]]; then
    ok "web: /api 프록시가 이 서버로 간다(seed 방 $SEED_ROOM_ID 이 직접·프록시 모두 보임)"
  else bad "web: seed 방 $SEED_ROOM_ID 이 직접 '$direct', 프록시 '$proxied'. 프록시 대상이 이 서버가 아니다"; fi

  local head; head=$(git rev-parse HEAD)
  if [[ $head == "$REPO_HEAD" ]]; then ok "build: HEAD ${head:0:9} (띄울 때와 같음)"
  else ok "build: HEAD ${REPO_HEAD:0:9} → ${head:0:9}. 서버 지문이 같으면 웹만 바뀐 것이고 next dev가 다시 읽는다"; fi
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
  in_run_env docker compose exec -T db psql -U local -d banbanyeok -X -A -F $'\t' -P footer=off -c "$1"
}

# 이 실행의 프로세스: launch가 남긴 목록과 지금 리더의 자손. 한 줄에 "PID<탭>시작 시각".
owned_procs() {
  local role=$1 leader=$2 leader_started=$3 p
  { [[ -f "$RUN/procs-$role.tsv" ]] && cat "$RUN/procs-$role.tsv"
    owned_tree "$leader" "$leader_started" | while read -r p; do printf '%s\t%s\n' "$p" "$(started_at "$p")"; done
  } | awk -F'\t' '$1 != "" && !seen[$1]++'
}

# 아직 살아 있고 시작 시각이 그대로인 것만 남긴다. 신호를 보내기 직전마다 이것으로 다시 확인한다.
still_owned() { local p st; while IFS=$'\t' read -r p st; do owned_pid "$p" "$st" && printf '%s\t%s\n' "$p" "$st"; done; return 0; }

stop_role() {
  local name=$1 leader=$2 leader_started=$3 procs sig p st
  procs=$(owned_procs "$name" "$leader" "$leader_started")
  for sig in TERM KILL; do
    while IFS=$'\t' read -r p st; do
      [[ -n $p ]] && owned_pid "$p" "$st" && kill "-$sig" "$p" 2>/dev/null || true
    done <<< "$procs"
    for _ in $(seq 1 20); do
      [[ -z $(still_owned <<< "$procs") ]] && break
      sleep 1
    done
  done
  local left; left=$(still_owned <<< "$procs" | cut -f1 | tr '\n' ' ')
  if [[ -n $left ]]; then echo "FAIL $name: KILL 뒤에도 남은 프로세스 $left"; return 1; fi
  echo "stopped: $name (기록한 프로세스 $(grep -c . <<< "$procs" || true)개 모두 종료 확인)"
}

cleanup() {
  load_state
  local fail=0
  stop_role web "${WEB_LEADER:-}" "${WEB_LEADER_STARTED:-}" || fail=1
  stop_role server "${SERVER_LEADER:-}" "${SERVER_LEADER_STARTED:-}" || fail=1
  if in_run_env docker compose --profile tools down -v --rmi local --remove-orphans > "$RUN/logs/cleanup-compose.log" 2>&1; then
    echo "removed: compose 프로젝트 $COMPOSE_PROJECT_NAME (컨테이너·볼륨·migrate 이미지)"
  else
    echo "FAIL compose down 실패. 로그: $RUN/logs/cleanup-compose.log"; fail=1
  fi
  local port
  for port in "$DB_PORT" "$SERVER_PORT" "$WEB_PORT"; do
    if [[ -n $(listener "$port") ]]; then echo "FAIL 포트 $port 에 아직 프로세스가 있다: PID $(listener "$port")"; fail=1; fi
  done
  echo "evidence kept: $RUN/evidence"
  find "$RUN/evidence" -mindepth 1 -maxdepth 1 | sed 's/^/  /'
  if (( fail )); then echo "cleanup 미완료. 원인을 고치고 다시 cleanup한다(STOPPED_AT을 적지 않았다)"; return 1; fi
  grep -q '^STOPPED_AT=' "$RUN/state.env" || record STOPPED_AT "$(date -u +%FT%TZ)"
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
