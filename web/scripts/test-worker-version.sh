#!/usr/bin/env bash
# worker-version.sh 단위 테스트. 실행: `bash web/scripts/test-worker-version.sh` (CI의 deploy-scripts 잡도 돌린다). 실제 Cloudflare를 부르지 않는다.
#
# 1부 가짜 wrangler: 되돌리기 논리(분할 배포, 조회 재시도, 사후 확인, 첫 배포 두 종류, 인증 오류 등)를 본다.
#   상태는 $STATE 디렉터리 파일에 있다. current = 100% 버전, split = "id:비중" 줄들(있으면 분할 배포).
#   STATUS_FAILS 파일의 숫자만큼 상태 조회가 먼저 실패한다(일시 오류). 그 밖의 표시 파일은 아래 fake 본문 참고.
# 2부 실제 wrangler(핀된 4.158.0) + 루프백 가짜 Cloudflare API(test-worker-version-api.py): 실제 JSON·오류 형식을 읽는지 본다.
#   web/node_modules에 wrangler가 없으면 건너뛴다. CI는 REQUIRE_REAL_WRANGLER=1로 건너뛰기를 실패로 본다.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="$here/worker-version.sh"
failed=0
tmp="$(mktemp -d)"
api_pid=""
trap '[ -n "$api_pid" ] && kill "$api_pid" 2>/dev/null; rm -rf "$tmp"' EXIT

OLD=11111111-1111-4111-8111-111111111111
NEW=22222222-2222-4222-8222-222222222222

cat > "$tmp/wrangler" <<'FAKE'
#!/usr/bin/env bash
state="$STATE"
echo "$*" >> "$state/calls"
dec() { local n; n="$(cat "$1")"; if [ "$n" -gt 0 ]; then echo $((n - 1)) > "$1"; return 0; fi; return 1; }
case "$1 $2" in
  "deployments status")
    if [ -f "$state/NODEPLOY" ]; then echo "✘ [ERROR] The Worker banbanyeok-web has no deployments." >&2; exit 1; fi
    if [ -f "$state/MISSING" ]; then printf '✘ [ERROR] A request to the Cloudflare API (/accounts/a/workers/scripts/banbanyeok-web/deployments) failed.\n\n  This Worker does not exist on your account. [code: 10007]\n' >&2; exit 1; fi
    if [ -f "$state/AUTH" ]; then printf '✘ [ERROR] A request to the Cloudflare API failed.\n\n  Authentication error [code: 10000]\n' >&2; exit 1; fi
    if [ -f "$state/STATUS_FAILS" ] && dec "$state/STATUS_FAILS"; then echo "fetch failed" >&2; exit 1; fi
    if [ -f "$state/GARBAGE" ]; then echo "Some banner text"; exit 0; fi
    if [ -f "$state/EMPTY_VERSIONS" ]; then echo '{"id":"d","versions":[]}'; exit 0; fi
    if [ -f "$state/split" ]; then
      vers="$(awk -F: '{printf "%s{\"version_id\":\"%s\",\"percentage\":%s}", (NR>1?",":""), $1, $2}' "$state/split")"
    else
      vers="$(printf '{"version_id":"%s","percentage":100}' "$(cat "$state/current")")"
    fi
    printf '{\n  "id": "dep1",\n  "source": "wrangler",\n  "strategy": "percentage",\n  "author_email": "someone@example.invalid",\n  "annotations": {"workers/triggered_by": "deployment"},\n  "versions": [%s],\n  "created_on": "2026-11-20T00:00:00Z"\n}\n' "$vers" ;;
  "versions view")
    if [ -f "$state/FAIL_VIEW" ]; then echo "view failed" >&2; exit 1; fi
    tag="$(cat "$state/tag" 2>/dev/null || true)"
    if [ -n "$tag" ]; then ann="{\"workers/tag\":\"$tag\",\"workers/message\":\"$tag\"}"; else ann='{}'; fi
    printf '{"id":"%s","number":3,"metadata":{"author_email":"someone@example.invalid"},"annotations":%s}\n' "$3" "$ann" ;;
  "rollback "*)
    if [ -f "$state/FAIL_ROLLBACK" ]; then echo "rollback refused" >&2; exit 1; fi
    if [ -f "$state/NOOP_ROLLBACK" ]; then exit 0; fi
    rm -f "$state/split"
    printf '%s' "$2" > "$state/current" ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac
FAKE
chmod +x "$tmp/wrangler"

reset() { rm -rf "$tmp/state"; mkdir -p "$tmp/state"; : > "$tmp/state/calls"; printf '%s' "$1" > "$tmp/state/current"; }
# run <이름> <기대 종료코드> <기대 출력(정확히, 표준 출력만) 또는 '*'> <기대 표준 오류 일부 또는 ''> -- <인자...>
run() {
  local name="$1" want_code="$2" want_out="$3" want_err="$4"
  shift 5
  local out code
  out="$(STATE="$tmp/state" WRANGLER="$tmp/wrangler" RETRIES=3 RETRY_SLEEP=0 bash "$script" "$@" 2>"$tmp/err")"
  code=$?
  local ok=1
  [ "$code" = "$want_code" ] || ok=0
  [ "$want_out" = '*' ] || [ "$out" = "$want_out" ] || ok=0
  [ -z "$want_err" ] || grep -qF -- "$want_err" "$tmp/err" || ok=0
  if grep -q 'example.invalid' <<<"$out$(cat "$tmp/err")"; then ok=0; echo "     (배포 JSON의 메일 주소가 출력에 나왔다)"; fi
  if [ "$ok" = 1 ]; then echo "ok   $name"; else echo "FAIL $name: code=$code (기대 $want_code) out='$out' err='$(paste -sd'|' "$tmp/err")' 호출='$(paste -sd'|' "$tmp/state/calls")'"; failed=1; fi
}
calls() { grep -c "^$1" "$tmp/state/calls"; }
expect() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: 기대 '$3' / 실제 '$2'"; failed=1; fi; }

echo "== 1부: 가짜 wrangler"
# current (배포 직전 기록)
reset "$OLD"
run "current: 단독 100% 버전 id" 0 "$OLD" "" -- current
reset "$OLD"; touch "$tmp/state/NODEPLOY"
run "current: 배포 목록이 빈 Worker(첫 배포)는 빈 출력·성공" 0 "" "" -- current
reset "$OLD"; touch "$tmp/state/MISSING"
run "current: 아직 없는 Worker(10007, 첫 배포)는 빈 출력·성공" 0 "" "" -- current
reset "$OLD"; touch "$tmp/state/AUTH"
run "current: 인증 오류(10000)는 실패(배포 전에 멈춘다)" 1 "" "배포하지 않습니다" -- current
expect "current: 인증 오류도 재시도" "$(calls deployments)" 3
reset "$OLD"; touch "$tmp/state/GARBAGE"
run "current: JSON이 아닌 출력은 실패(빈 성공으로 넘기지 않는다)" 1 "" "형식이 예상과 다릅니다" -- current
reset "$OLD"; touch "$tmp/state/EMPTY_VERSIONS"
run "current: versions가 빈 배포 객체는 실패" 1 "" "형식이 예상과 다릅니다" -- current
reset "$OLD"; echo 2 > "$tmp/state/STATUS_FAILS"
run "current: 일시 오류 2번 뒤 성공" 0 "$OLD" "다시 시도" -- current
reset "$OLD"; printf '%s:60\n%s:40\n' "$OLD" "$NEW" > "$tmp/state/split"
run "current: 분할(60/40)이면 큰 쪽 + 경고" 0 "$OLD" "::warning::" -- current

# deployed-tag (plan이 운영 웹 커밋을 읽는다)
reset "$OLD"; echo "a2f2249" > "$tmp/state/tag"
run "deployed-tag: 단독 100% 버전의 tag" 0 "a2f2249" "" -- deployed-tag
reset "$OLD"
run "deployed-tag: tag 없는 버전(예: secret put)은 모름" 1 "" "" -- deployed-tag
reset "$OLD"; echo "release-1" > "$tmp/state/tag"
run "deployed-tag: SHA가 아닌 tag는 모름" 1 "" "커밋 SHA가 아닙니다" -- deployed-tag
reset "$OLD"; echo "a2f2249" > "$tmp/state/tag"; printf '%s:60\n%s:40\n' "$OLD" "$NEW" > "$tmp/state/split"
run "deployed-tag: 분할 배포 중이면 모름" 1 "" "하나가 아닙니다" -- deployed-tag
reset "$OLD"; touch "$tmp/state/NODEPLOY"
run "deployed-tag: 배포 없음은 모름" 1 "" "" -- deployed-tag

# rollback
reset "$NEW"
run "rollback: 새 버전이 라이브 → 직전 버전으로" 0 '*' "" -- rollback "$OLD"
expect "rollback 뒤 현재 버전 = 직전 버전" "$(cat "$tmp/state/current")" "$OLD"
expect "rollback 호출 1회" "$(calls rollback)" 1
reset "$OLD"
run "rollback: 이미 직전 버전 단독 100%면 부르지 않는다" 0 '*' "" -- rollback "$OLD"
expect "불필요한 rollback 호출 없음" "$(calls rollback)" 0
reset "$OLD"; printf '%s:60\n%s:40\n' "$OLD" "$NEW" > "$tmp/state/split"
run "rollback: 대상이 60%뿐이면 생략하지 않고 100%로" 0 '*' "" -- rollback "$OLD"
expect "분할 → rollback 호출 1회" "$(calls rollback)" 1
if [ -f "$tmp/state/split" ]; then fail_split="split"; else fail_split="$(cat "$tmp/state/current")"; fi
expect "분할 → 단독 100%" "$fail_split" "$OLD"
reset "$NEW"; printf '%s:60\n%s:40\n' "$OLD" "$NEW" > "$tmp/state/split"; touch "$tmp/state/NOOP_ROLLBACK"
run "rollback: 사후 확인에서 분할이 남아 있으면 실패" 1 "" "단독 100%가 아닙니다" -- rollback "$OLD"
reset "$NEW"; echo 3 > "$tmp/state/STATUS_FAILS"
run "rollback: 첫 상태 조회가 끝내 실패해도 되돌리기를 시도" 0 '*' "시도합니다" -- rollback "$OLD"
expect "조회 실패 → rollback 호출 1회" "$(calls rollback)" 1
expect "조회 실패 → 현재 버전 = 직전 버전" "$(cat "$tmp/state/current")" "$OLD"
reset "$NEW"; touch "$tmp/state/AUTH"
run "rollback: 사후 확인도 못 읽으면 실패" 1 "" "확인하지 못했습니다" -- rollback "$OLD"
reset "$NEW"; touch "$tmp/state/FAIL_ROLLBACK"
run "rollback: wrangler가 계속 실패하면 재시도 뒤 실패" 1 "" "자동 되돌리기에 실패" -- rollback "$OLD"
expect "rollback 재시도 3회" "$(calls rollback)" 3
reset "$NEW"; touch "$tmp/state/NOOP_ROLLBACK"
run "rollback: 성공이라 했지만 버전이 안 바뀌면 실패(사후 확인)" 1 "" "단독 100%가 아닙니다" -- rollback "$OLD"
reset "$NEW"
run "rollback: 잘못된 id는 거절" 2 "" "UUID" -- rollback "not-a-uuid"
run "인자 없음은 사용법" 2 "" "사용법" --

echo "== 2부: 실제 wrangler + 루프백 API"
real="$here/../node_modules/.bin/wrangler"
if [ ! -x "$real" ] || ! command -v python3 >/dev/null; then
  if [ "${REQUIRE_REAL_WRANGLER:-0}" = 1 ]; then echo "FAIL 실제 wrangler(web/node_modules) 또는 python3이 없습니다"; failed=1; else echo "skip 실제 wrangler 없음(web/에서 pnpm install 뒤 다시)"; fi
  exit $failed
fi
api_state="$tmp/api"
mkdir -p "$api_state"
port_file="$tmp/port"
python3 -I "$here/test-worker-version-api.py" "$api_state" "$port_file" 2>"$tmp/api.log" &
api_pid=$!
disown "$api_pid" 2>/dev/null || true
for _ in $(seq 1 50); do [ -s "$port_file" ] && break; sleep 0.1; done
[ -s "$port_file" ] || { echo "FAIL 루프백 API가 뜨지 않았습니다"; cat "$tmp/api.log"; exit 1; }
port="$(cat "$port_file")"
# api_mode <모드> [현재 버전] [tag]  (모드: single | split | empty | missing | auth)
api_mode() { printf '%s' "$1" > "$api_state/mode"; printf '%s' "${2:-$OLD}" > "$api_state/current"; printf '%s' "${3:-}" > "$api_state/tag"; }
real_run() {
  local name="$1" want_code="$2" want_out="$3" want_err="$4"
  shift 5
  local out code
  out="$(cd "$here/.." && CLOUDFLARE_API_BASE_URL="http://127.0.0.1:$port/client/v4" CLOUDFLARE_API_TOKEN=test-token CLOUDFLARE_ACCOUNT_ID=test-account \
    WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH="$tmp/wrangler-logs" CI=true WRANGLER="$real" RETRIES=2 RETRY_SLEEP=0 bash "$script" "$@" 2>"$tmp/err")"
  code=$?
  local ok=1
  [ "$code" = "$want_code" ] || ok=0
  [ "$want_out" = '*' ] || [ "$out" = "$want_out" ] || ok=0
  [ -z "$want_err" ] || grep -qF -- "$want_err" "$tmp/err" || ok=0
  if grep -q 'example.invalid' <<<"$out$(cat "$tmp/err")"; then ok=0; echo "     (메일 주소가 출력에 나왔다)"; fi
  if [ "$ok" = 1 ]; then echo "ok   [실제] $name"; else echo "FAIL [실제] $name: code=$code (기대 $want_code) out='$out' err='$(head -c 600 "$tmp/err" | tr '\n' '|')'"; failed=1; fi
}
api_mode single "$OLD"
real_run "current: 배포 객체 + versions[{percentage:100}]" 0 "$OLD" "" -- current
api_mode split "$OLD"
real_run "current: 60/40 분할은 60% 쪽 + 경고" 0 "$OLD" "::warning::" -- current
api_mode empty
real_run "current: 빈 배포 목록 = 첫 배포" 0 "" "" -- current
api_mode missing
real_run "current: 없는 Worker(404/10007) = 첫 배포" 0 "" "" -- current
api_mode auth
real_run "current: 인증 오류는 실패" 1 "" "배포하지 않습니다" -- current
api_mode single "$OLD" "a2f2249"
real_run "deployed-tag: versions view의 workers/tag" 0 "a2f2249" "" -- deployed-tag
api_mode single "$NEW"
real_run "rollback: 실제 CLI로 직전 버전 100%" 0 '*' "" -- rollback "$OLD"
expect "[실제] rollback 뒤 API 상태" "$(cat "$api_state/current")" "$OLD"
api_mode split "$OLD"
real_run "rollback: 분할(대상 60%) → 100%로" 0 '*' "" -- rollback "$OLD"
expect "[실제] 분할 rollback 뒤 모드" "$(cat "$api_state/mode")" "single"

exit $failed
