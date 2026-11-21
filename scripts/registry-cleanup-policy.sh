#!/usr/bin/env bash
# Artifact Registry `server` 저장소의 정리 정책을 보거나 적용한다(#107). 적용은 운영자가 병합 뒤에 직접 한다.
#   scripts/registry-cleanup-policy.sh show             현재 정책만 출력한다(변경 없음)
#   scripts/registry-cleanup-policy.sh dry-run          infra/registry/cleanup-policy.json 을 --dry-run 으로 적용한다
#   scripts/registry-cleanup-policy.sh apply --yes      실제로 적용한다(--yes 없이는 거부)
# 주의: --dry-run 도 저장소 정책을 새 파일 내용으로 바꾸고 "삭제는 하지 않고 로그만 남기는" 모드로 돌린다.
#       그러니 dry-run 뒤에는 apply 로 실제 모드를 되돌려야 정리가 다시 돈다.
# 프로젝트·계정은 gcloud 설정을 따른다. 비밀값은 다루지 않는다.
# 환경 변수: REPO(기본 server), LOCATION(기본 asia-northeast3)
set -euo pipefail

REPO="${REPO:-server}"
LOCATION="${LOCATION:-asia-northeast3}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POLICY="$ROOT/infra/registry/cleanup-policy.json"

usage() { echo "사용법: $0 show | dry-run | apply --yes" >&2; exit 2; }

mode="${1:-}"
[ -n "$mode" ] || usage
shift
yes=0
for a in "$@"; do
  case "$a" in
    --yes) yes=1 ;;
    *) usage ;;
  esac
done

describe() {
  gcloud artifacts repositories describe "$REPO" --location="$LOCATION" \
    --format="yaml(cleanupPolicies,cleanupPolicyDryRun)"
}

case "$mode" in
  show)
    describe
    ;;
  dry-run)
    gcloud artifacts repositories set-cleanup-policies "$REPO" --location="$LOCATION" \
      --policy="$POLICY" --dry-run
    echo "--- 적용 뒤 상태(cleanupPolicyDryRun: true 여야 한다)"
    describe
    ;;
  apply)
    if [ "$yes" -ne 1 ]; then
      echo "실제 적용은 --yes 가 필요합니다. 먼저 dry-run 으로 확인하세요." >&2
      exit 2
    fi
    gcloud artifacts repositories set-cleanup-policies "$REPO" --location="$LOCATION" \
      --policy="$POLICY"
    echo "--- 적용 뒤 상태(keepCount 30, cleanupPolicyDryRun 이 false/없음 이어야 한다)"
    describe
    ;;
  *)
    usage
    ;;
esac
