#!/usr/bin/env bash
# 아키텍처 지표 이슈("아키텍처 지표 (자동)", 라벨 architecture)를 읽고 갱신한다. architecture-metrics.yml이 부른다.
#
#   bash scripts/architecture-metrics-issue.sh fetch FILE    기존 이슈 본문을 FILE에 쓴다(이슈가 없으면 빈 파일).
#   bash scripts/architecture-metrics-issue.sh publish FILE  FILE을 본문으로 이슈를 만들거나 덮어쓴다(댓글은 달지 않는다).
#
# gh CLI와 GH_TOKEN(issues: write)이 필요하다. 저장소는 GITHUB_REPOSITORY(Actions가 채운다)나 현재 클론에서 정한다.
# 이슈가 닫혀 있어도 그 이슈의 본문만 갱신하고 상태는 건드리지 않는다.
set -euo pipefail

TITLE="아키텍처 지표 (자동)"
LABEL="architecture"
LABEL_COLOR="5319e7"
LABEL_DESC="아키텍처 지표 자동 갱신 이슈와 리팩터링 후보"

if [ -n "${GITHUB_REPOSITORY:-}" ]; then export GH_REPO="$GITHUB_REPOSITORY"; fi

# 제목이 같은 이슈 중 가장 오래된 번호. 없으면 빈 문자열.
find_issue() {
  gh issue list --label "$LABEL" --state all --limit 100 --json number,title \
    | jq -r --arg title "$TITLE" '[.[] | select(.title == $title) | .number] | sort | first // empty'
}

ensure_label() {
  if ! gh label list --limit 200 --json name --jq '.[].name' | grep -qxF "$LABEL"; then
    gh label create "$LABEL" --color "$LABEL_COLOR" --description "$LABEL_DESC"
  fi
}

case "${1:-}" in
  fetch)
    out="${2:?출력 파일 경로가 필요하다}"
    number="$(find_issue)"
    mkdir -p "$(dirname "$out")"
    if [ -n "$number" ]; then
      gh issue view "$number" --json body --jq .body > "$out"
      echo "기존 이슈 #$number 본문을 읽었다" >&2
    else
      : > "$out"
      echo "기존 이슈가 없다. 첫 실행으로 본다" >&2
    fi
    ;;
  publish)
    body="${2:?본문 파일 경로가 필요하다}"
    [ -s "$body" ] || { echo "본문 파일이 비었다: $body" >&2; exit 1; }
    ensure_label
    number="$(find_issue)"
    if [ -n "$number" ]; then
      gh issue edit "$number" --body-file "$body" --add-label "$LABEL"
      echo "이슈 #$number 본문을 갱신했다" >&2
    else
      gh issue create --title "$TITLE" --label "$LABEL" --body-file "$body"
    fi
    ;;
  *)
    echo "사용법: $0 fetch|publish FILE" >&2
    exit 2
    ;;
esac
