#!/usr/bin/env bash
# Worker 버전 기록·되돌리기(.github/workflows/deploy-web.yml이 부른다. web/ 에서 실행한다).
#   bash scripts/worker-version.sh current          지금 100% 트래픽을 받는 Worker 버전 id를 한 줄로 출력한다.
#                                                   배포 기록이 없는 Worker(첫 배포)면 아무것도 출력하지 않고 0으로 끝난다.
#   bash scripts/worker-version.sh rollback <id>    그 버전을 100%로 되돌린다(wrangler rollback). 이미 그 버전이면 아무것도 하지 않는다.
#                                                   끝나고 현재 버전이 정말 <id>인지 다시 읽어 확인한다. 아니면 실패한다.
# 환경 변수:
#   WRANGLER      wrangler 실행 명령(기본 `pnpm exec wrangler`). scripts/test-worker-version.sh 는 가짜로 바꿔 끼운다.
#   ROLLBACK_MESSAGE  되돌리기 메시지(120자 이하)
#   RETRIES / RETRY_SLEEP  rollback 재시도 횟수(기본 3)·간격 초(기본 5)
# 인증은 CLOUDFLARE_API_TOKEN·CLOUDFLARE_ACCOUNT_ID 환경 변수로 한다(출력하지 않는다). 버전 id는 비밀이 아니다.
# 배포 JSON에서는 versions[].version_id·percentage만 읽는다.
set -uo pipefail

WRANGLER="${WRANGLER:-pnpm exec wrangler}"
RETRIES="${RETRIES:-3}"
RETRY_SLEEP="${RETRY_SLEEP:-5}"
ROLLBACK_MESSAGE="${ROLLBACK_MESSAGE:-auto-rollback: post-deploy check failed (${GITHUB_SHA:-manual})}"
ROLLBACK_MESSAGE="${ROLLBACK_MESSAGE:0:120}"
uuid_pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

err_file="$(mktemp)"
trap 'rm -f "$err_file"' EXIT

# 현재 버전 id를 표준 출력으로. 반환값: 0 성공(없으면 빈 출력), 1 조회 실패
current_version() {
  local json
  # shellcheck disable=SC2086  # WRANGLER는 단어 분리되어야 한다
  if ! json="$($WRANGLER deployments status --json 2>"$err_file")"; then
    if grep -q "has no deployments" "$err_file"; then return 0; fi
    echo "배포 상태를 읽지 못했습니다:" >&2
    sed -n '1,5p' "$err_file" >&2
    return 1
  fi
  local id
  id="$(jq -r '(.versions // []) | sort_by(-.percentage) | (.[0].version_id // empty)' <<<"$json" 2>/dev/null)"
  if [[ -n "$id" && ! "$id" =~ $uuid_pattern ]]; then
    echo "버전 id 형식이 올바르지 않습니다" >&2
    return 1
  fi
  if [ "$(jq -r '(.versions // []) | length' <<<"$json" 2>/dev/null)" -gt 1 ]; then
    echo "::warning::여러 버전이 트래픽을 나눠 받는 중입니다(점진 배포). 가장 큰 비중의 버전을 기준으로 삼습니다." >&2
  fi
  printf '%s' "$id"
}

cmd="${1:-}"
case "$cmd" in
  current)
    id="$(current_version)" || exit 1
    [ -n "$id" ] && echo "$id"
    exit 0
    ;;
  rollback)
    target="${2:-}"
    [[ "$target" =~ $uuid_pattern ]] || { echo "되돌릴 버전 id가 필요합니다(UUID)" >&2; exit 2; }
    now="$(current_version)" || exit 1
    if [ "$now" = "$target" ]; then
      echo "현재 버전이 이미 $target 입니다. 되돌릴 것이 없습니다."
      exit 0
    fi
    attempt=1
    while :; do
      # shellcheck disable=SC2086
      if $WRANGLER rollback "$target" --yes --message "$ROLLBACK_MESSAGE" 2>"$err_file"; then break; fi
      echo "되돌리기 실패($attempt/$RETRIES):" >&2
      sed -n '1,5p' "$err_file" >&2
      if [ "$attempt" -ge "$RETRIES" ]; then
        echo "FAIL 자동 되돌리기에 실패했습니다. 직접 실행하세요: pnpm exec wrangler rollback $target" >&2
        exit 1
      fi
      attempt=$((attempt + 1))
      sleep "$RETRY_SLEEP"
    done
    after="$(current_version)" || exit 1
    if [ "$after" = "$target" ]; then
      echo "ok   Worker가 버전 $target 으로 되돌려졌습니다"
      exit 0
    fi
    echo "FAIL 되돌린 뒤 현재 버전이 ${after:-없음} 입니다(기대: $target). 직접 확인하세요." >&2
    exit 1
    ;;
  *)
    echo "사용법: worker-version.sh current | rollback <version-id>" >&2
    exit 2
    ;;
esac
