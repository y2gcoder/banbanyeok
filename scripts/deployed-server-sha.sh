#!/usr/bin/env bash
# 운영 서버(Cloud Run)에 나가 있는 커밋 SHA를 한 줄로 출력한다. .github/workflows/deploy.yml 의 plan 잡이 부른다(GCP 인증 뒤).
#   100% 트래픽을 받는 리비전 하나 → 아래 순서로 커밋 SHA를 찾는다.
#   1) 리비전 라벨 commit-sha (deploy-server.yml이 `--update-labels commit-sha=$GITHUB_SHA`로 단다)
#   2) 이미지가 `server:<40hex>` 태그이면 그 태그
# 알 수 없으면(조회 실패, 트래픽이 나뉘어 있음, 태그가 SHA가 아님) 아무것도 출력하지 않고 1로 끝난다 → plan은 서버를 배포한다.
# 환경 변수: SERVICE(기본 server), REGION(필수), GCLOUD(기본 gcloud, scripts/test-deploy-plan.sh는 가짜로 바꿔 끼운다)
# 비밀값은 다루지 않는다(리비전 이름·이미지 주소만 읽는다).
set -uo pipefail

SERVICE="${SERVICE:-server}"
REGION="${REGION:?REGION이 필요합니다}"
GCLOUD="${GCLOUD:-gcloud}"

# shellcheck disable=SC2086  # GCLOUD는 단어 분리되어야 한다
if ! svc="$($GCLOUD run services describe "$SERVICE" --region "$REGION" --format=json 2>/dev/null)"; then
  echo "서비스 정보를 읽지 못했습니다" >&2; exit 1
fi
# 트래픽 항목은 같은 리비전이 여러 번(태그별) 나올 수 있어 리비전별로 합친다. 정확히 한 리비전이 100%일 때만 쓴다.
if ! rev="$(jq -er '[.status.traffic[]? | select((.percent // 0) > 0)] | group_by(.revisionName)
    | map({r: .[0].revisionName, p: (map(.percent) | add)})
    | if length == 1 and .[0].p == 100 and (.[0].r | type) == "string" then .[0].r else error("not single") end' <<<"$svc" 2>/dev/null)"; then
  echo "100% 트래픽을 받는 리비전이 하나가 아닙니다" >&2; exit 1
fi
[[ "$rev" =~ ^[a-z0-9-]+$ ]] || { echo "리비전 이름 형식이 다릅니다" >&2; exit 1; }
# shellcheck disable=SC2086
if ! revjson="$($GCLOUD run revisions describe "$rev" --region "$REGION" --format=json 2>/dev/null)"; then
  echo "리비전 $rev 을 읽지 못했습니다" >&2; exit 1
fi
label="$(jq -r '.metadata.labels["commit-sha"] // empty' <<<"$revjson" 2>/dev/null)"
if [[ "$label" =~ ^[0-9a-f]{40}$ ]]; then
  echo "$label"
  exit 0
fi
if ! image="$(jq -er '.spec.containers[0].image' <<<"$revjson" 2>/dev/null)"; then
  echo "리비전 $rev 의 이미지를 읽지 못했습니다" >&2; exit 1
fi
if [[ "$image" =~ /server:([0-9a-f]{40})$ ]]; then
  echo "${BASH_REMATCH[1]}"
  exit 0
fi
echo "리비전 $rev 의 이미지 태그가 커밋 SHA가 아닙니다" >&2
exit 1
