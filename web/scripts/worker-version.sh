#!/usr/bin/env bash
# Worker 버전 기록·되돌리기·배포된 커밋 읽기(.github/workflows/deploy-web.yml·deploy.yml이 부른다. web/ 에서 실행한다).
#
#   current          배포 직전에 부른다. 되돌릴 버전 id(트래픽을 가장 많이 받는 버전)를 한 줄로 출력한다.
#                    배포 기록이 **확실히 없을 때만**(배포 목록이 비었거나 Worker가 아직 없음: 10007) 빈 출력·0으로 끝난다.
#                    그 밖에 읽지 못하면(인증·권한·네트워크·형식 오류) 재시도 뒤 1 → 워크플로는 배포 전에 멈춘다.
#                    트래픽이 나뉘어 있으면 경고하고 가장 큰 비중의 버전을 고른다. 되돌릴 때는 그 버전을 **100%**로 만든다.
#   deployed-tag     지금 100% 트래픽을 받는 버전 하나의 tag(배포 때 `--tag <커밋 7자>`)를 출력한다. 모르면 1(plan은 웹을 배포한다).
#   rollback <id>    <id>를 100% 트래픽으로 되돌린다(wrangler rollback). 이미 <id> 단독 100%면 아무것도 하지 않는다.
#                    상태 조회가 계속 실패해도 대상 id를 알고 있으므로 되돌리기를 시도한다.
#                    끝나고 현재 상태가 정말 <id> 단독 100%인지 다시 읽어 확인한다(재시도). 아니면 실패한다.
# 환경 변수:
#   WRANGLER      wrangler 실행 명령(기본 `pnpm exec wrangler`). scripts/test-worker-version.sh 는 가짜로 바꿔 끼운다.
#   ROLLBACK_MESSAGE  되돌리기 메시지(120자 이하)
#   RETRIES / RETRY_SLEEP  wrangler 호출마다 재시도 횟수(기본 3)·간격 초(기본 5)
# 인증은 CLOUDFLARE_API_TOKEN·CLOUDFLARE_ACCOUNT_ID 환경 변수로 한다(출력하지 않는다). 버전 id·tag는 비밀이 아니다.
# 배포 JSON은 출력하지 않는다(작성자 메일 주소가 들어 있다). versions[].version_id·percentage와 annotations의 tag만 읽는다.
set -uo pipefail

WRANGLER="${WRANGLER:-pnpm exec wrangler}"
RETRIES="${RETRIES:-3}"
RETRY_SLEEP="${RETRY_SLEEP:-5}"
ROLLBACK_MESSAGE="${ROLLBACK_MESSAGE:-auto-rollback: post-deploy check failed (${GITHUB_SHA:-manual})}"
ROLLBACK_MESSAGE="${ROLLBACK_MESSAGE:0:120}"
uuid_re='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

err_file="$(mktemp)"
trap 'rm -f "$err_file"' EXIT

# 배포 상태를 한 번 읽는다. STATUS_KIND=ok|none|error, ok면 STATUS_JSON에 검증된 JSON.
read_status_once() {
  local json
  STATUS_JSON=""
  # shellcheck disable=SC2086  # WRANGLER는 단어 분리되어야 한다
  if ! json="$($WRANGLER deployments status --json 2>"$err_file")"; then
    # 확실한 "배포 없음"만 첫 배포로 본다: 배포 목록이 비었거나(wrangler 메시지) Worker가 없다(API 10007).
    if grep -q "has no deployments" "$err_file" || grep -q "code: 10007\]" "$err_file"; then STATUS_KIND=none; return; fi
    STATUS_KIND=error
    echo "배포 상태를 읽지 못했습니다:" >&2
    grep -v '^[[:space:]]*$' "$err_file" | sed -n '1,4p' >&2
    return
  fi
  # 형식 검증: versions가 비어 있지 않은 배열, 모든 id가 UUID, 비중이 숫자이고 합이 100.
  if ! jq -e --arg re "$uuid_re" '
      (.versions | type == "array" and length > 0)
      and all(.versions[]; (.version_id | type == "string" and test($re)) and (.percentage | type == "number"))
      and (([.versions[].percentage] | add) as $s | ($s - 100) * ($s - 100) < 0.0001)' <<<"$json" >/dev/null 2>&1; then
    STATUS_KIND=error
    echo "배포 상태 응답의 형식이 예상과 다릅니다(versions[].version_id·percentage)." >&2
    return
  fi
  STATUS_KIND=ok
  STATUS_JSON="$json"
}

# 재시도하며 읽는다. none/ok면 바로, error면 RETRIES번까지.
read_status() {
  local attempt=1
  while :; do
    read_status_once
    [ "$STATUS_KIND" != error ] && return
    [ "$attempt" -ge "$RETRIES" ] && return
    echo "  다시 시도합니다($attempt/$RETRIES)" >&2
    attempt=$((attempt + 1))
    sleep "$RETRY_SLEEP"
  done
}

# 단독 100% 버전 id(없으면 빈 문자열)
sole_version() { jq -r 'if (.versions | length) == 1 and .versions[0].percentage == 100 then .versions[0].version_id else "" end' <<<"$STATUS_JSON"; }
# 가장 큰 비중의 버전 id
top_version() { jq -r '.versions | max_by(.percentage) | .version_id' <<<"$STATUS_JSON"; }

cmd="${1:-}"
case "$cmd" in
  current)
    read_status
    case "$STATUS_KIND" in
      none) exit 0 ;;
      error) echo "FAIL 지금 Worker 버전을 확인하지 못했습니다. 되돌릴 곳을 모르므로 배포하지 않습니다." >&2; exit 1 ;;
    esac
    if [ -z "$(sole_version)" ]; then
      echo "::warning::여러 버전이 트래픽을 나눠 받는 중입니다($(jq -r '[.versions[] | "\(.version_id[0:8]) \(.percentage)%"] | join(", ")' <<<"$STATUS_JSON")). 실패하면 가장 큰 비중의 버전을 100%로 되돌립니다." >&2
    fi
    top_version
    exit 0
    ;;
  deployed-tag)
    read_status
    [ "$STATUS_KIND" = ok ] || exit 1
    id="$(sole_version)"
    [ -n "$id" ] || { echo "100% 트래픽을 받는 버전이 하나가 아닙니다" >&2; exit 1; }
    # shellcheck disable=SC2086
    if ! tag="$($WRANGLER versions view "$id" --json 2>"$err_file" | jq -er '.annotations["workers/tag"] // empty' 2>/dev/null)"; then
      echo "버전 $id 의 tag를 읽지 못했습니다" >&2; exit 1
    fi
    [[ "$tag" =~ ^[0-9a-f]{7,40}$ ]] || { echo "버전 $id 의 tag가 커밋 SHA가 아닙니다" >&2; exit 1; }
    echo "$tag"
    exit 0
    ;;
  rollback)
    target="${2:-}"
    [[ "$target" =~ $uuid_re ]] || { echo "되돌릴 버전 id가 필요합니다(UUID)" >&2; exit 2; }
    read_status
    if [ "$STATUS_KIND" = ok ] && [ "$(sole_version)" = "$target" ]; then
      echo "현재 버전이 이미 $target (100%) 입니다. 되돌릴 것이 없습니다."
      exit 0
    fi
    if [ "$STATUS_KIND" != ok ]; then
      echo "::warning::현재 배포 상태를 확인하지 못했지만, 되돌릴 버전($target)을 알고 있으므로 되돌리기를 시도합니다." >&2
    fi
    attempt=1
    while :; do
      # shellcheck disable=SC2086
      if $WRANGLER rollback "$target" --yes --message "$ROLLBACK_MESSAGE" 2>"$err_file"; then break; fi
      echo "되돌리기 실패($attempt/$RETRIES):" >&2
      grep -v '^[[:space:]]*$' "$err_file" | sed -n '1,4p' >&2
      if [ "$attempt" -ge "$RETRIES" ]; then
        echo "FAIL 자동 되돌리기에 실패했습니다. 직접 실행하세요(web/ 에서): pnpm exec wrangler rollback $target" >&2
        exit 1
      fi
      attempt=$((attempt + 1))
      sleep "$RETRY_SLEEP"
    done
    read_status
    if [ "$STATUS_KIND" = ok ] && [ "$(sole_version)" = "$target" ]; then
      echo "ok   Worker가 버전 $target (100%) 으로 되돌려졌습니다"
      exit 0
    fi
    if [ "$STATUS_KIND" = ok ]; then
      echo "FAIL 되돌린 뒤 상태가 $target 단독 100%가 아닙니다($(jq -r '[.versions[] | "\(.version_id) \(.percentage)%"] | join(", ")' <<<"$STATUS_JSON")). 직접 확인하세요." >&2
    else
      echo "FAIL 되돌린 뒤 상태를 확인하지 못했습니다. 직접 확인하세요(web/ 에서): pnpm exec wrangler deployments status" >&2
    fi
    exit 1
    ;;
  *)
    echo "사용법: worker-version.sh current | deployed-tag | rollback <version-id>" >&2
    exit 2
    ;;
esac
