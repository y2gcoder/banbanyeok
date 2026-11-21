#!/usr/bin/env bash
# worker-version.sh 단위 테스트: 가짜 wrangler로 "배포 뒤 스모크 실패 → 직전 버전으로 되돌리기" 경로를 검증한다.
# 실행: `bash scripts/test-worker-version.sh` (CI의 deploy-scripts 잡도 돌린다). 실제 Cloudflare를 부르지 않는다.
#
# 가짜 wrangler 상태는 $STATE 디렉터리 파일 하나(current)에 있다:
#   deployments status --json  → current 에 적힌 버전을 100%로 낸다(NODEPLOY 파일이 있으면 "no deployments" 오류)
#   rollback <id>              → current 를 <id>로 바꾼다(FAIL_ROLLBACK 파일이 있으면 실패, NOOP_ROLLBACK 이면 성공이지만 안 바꿈)
#   calls 파일에 호출을 한 줄씩 남긴다.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="$here/worker-version.sh"
failed=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

OLD=11111111-1111-4111-8111-111111111111
NEW=22222222-2222-4222-8222-222222222222

cat > "$tmp/wrangler" <<'FAKE'
#!/usr/bin/env bash
state="$STATE"
echo "$*" >> "$state/calls"
case "$1 $2" in
  "deployments status")
    if [ -f "$state/NODEPLOY" ]; then echo "The Worker banbanyeok-web has no deployments." >&2; exit 1; fi
    if [ -f "$state/FAIL_STATUS" ]; then echo "API error 10000" >&2; exit 1; fi
    if [ -f "$state/SPLIT" ]; then
      printf '{"id":"d","versions":[{"version_id":"%s","percentage":10},{"version_id":"%s","percentage":90}]}\n' "$(cat "$state/split_a")" "$(cat "$state/current")"
    else
      printf '{"id":"d","versions":[{"version_id":"%s","percentage":100}]}\n' "$(cat "$state/current")"
    fi ;;
  "rollback "*)
    if [ -f "$state/FAIL_ROLLBACK" ]; then echo "rollback refused" >&2; exit 1; fi
    if [ -f "$state/NOOP_ROLLBACK" ]; then exit 0; fi
    printf '%s' "$2" > "$state/current" ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac
FAKE
chmod +x "$tmp/wrangler"

# run <이름> <기대 종료코드> <기대 출력 일부 또는 ''> <기대 호출 일부 또는 ''> -- <worker-version 인자...>   (환경은 호출 전에 $STATE 준비)
run() {
  local name="$1" want_code="$2" want_out="$3" want_call="$4"
  shift 5
  local out code
  out="$(STATE="$tmp/state" WRANGLER="$tmp/wrangler" RETRIES=2 RETRY_SLEEP=0 bash "$script" "$@" 2>&1)"
  code=$?
  local ok=1
  [ "$code" = "$want_code" ] || ok=0
  [ -z "$want_out" ] || grep -qF -- "$want_out" <<<"$out" || ok=0
  [ -z "$want_call" ] || grep -qF -- "$want_call" "$tmp/state/calls" || ok=0
  if [ "$ok" = 1 ]; then echo "ok   $name"; else echo "FAIL $name: code=$code (기대 $want_code) 출력='$out' 호출='$(paste -sd'|' "$tmp/state/calls")'"; failed=1; fi
}
reset() { rm -rf "$tmp/state"; mkdir -p "$tmp/state"; : > "$tmp/state/calls"; printf '%s' "$1" > "$tmp/state/current"; }

reset "$OLD"
run "current: 현재 버전 id를 출력" 0 "$OLD" "deployments status --json" -- current

reset "$OLD"; touch "$tmp/state/NODEPLOY"
out="$(STATE="$tmp/state" WRANGLER="$tmp/wrangler" bash "$script" current 2>&1)"; code=$?
if [ "$code" = 0 ] && [ -z "$out" ]; then echo "ok   current: 첫 배포(기록 없음)는 빈 출력·성공"; else echo "FAIL 첫 배포: code=$code out='$out'"; failed=1; fi

reset "$OLD"; touch "$tmp/state/FAIL_STATUS"
run "current: 조회 오류는 실패(배포 전에 멈춘다)" 1 "배포 상태를 읽지 못했습니다" "" -- current

reset "$OLD"; touch "$tmp/state/SPLIT"; printf '%s' "$NEW" > "$tmp/state/split_a"
run "current: 점진 배포 중이면 큰 비중의 버전 + 경고" 0 "::warning::" "" -- current

# 핵심: 배포가 NEW로 바꿔 놓았고 스모크가 실패했다 → OLD로 되돌린다
reset "$NEW"
run "rollback: 직전 버전으로 되돌리고 확인" 0 "되돌려졌습니다" "rollback $OLD --yes" -- rollback "$OLD"
[ "$(cat "$tmp/state/current")" = "$OLD" ] && echo "ok   rollback 뒤 현재 버전 = 직전 버전" || { echo "FAIL rollback 뒤 버전이 다름"; failed=1; }

reset "$OLD"
run "rollback: 이미 그 버전이면 wrangler rollback을 부르지 않는다" 0 "이미" "" -- rollback "$OLD"
grep -q "^rollback" "$tmp/state/calls" && { echo "FAIL 불필요한 rollback 호출"; failed=1; } || echo "ok   불필요한 rollback 호출 없음"

reset "$NEW"; touch "$tmp/state/FAIL_ROLLBACK"
run "rollback: wrangler가 계속 실패하면 재시도 뒤 실패" 1 "자동 되돌리기에 실패" "" -- rollback "$OLD"
[ "$(grep -c '^rollback' "$tmp/state/calls")" = 2 ] && echo "ok   재시도 2회" || { echo "FAIL 재시도 횟수"; failed=1; }

reset "$NEW"; touch "$tmp/state/NOOP_ROLLBACK"
run "rollback: 성공이라 했지만 버전이 안 바뀌면 실패(사후 확인)" 1 "되돌린 뒤 현재 버전" "" -- rollback "$OLD"

reset "$NEW"
run "rollback: 잘못된 id는 거절" 2 "UUID" "" -- rollback "not-a-uuid"
run "인자 없음은 사용법" 2 "사용법" "" -- 

exit $failed
