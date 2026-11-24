#!/usr/bin/env bash
# 성공한 deploy.yml의 release 잡 전용. 태그는 gh release create가 HEAD_SHA에 만든다.
# TAG/PREVIOUS는 release-tag.sh 결과, 나머지는 plan 출력과 배포 전후 서버 manifest 조회 결과.
set -euo pipefail
: "${TAG:?}" "${HEAD_SHA:?}" "${SERVER_NEW:?}" "${WEB_NEW:?}"
component() {
  local deployed="$1" old="$2"
  if [ "$deployed" = true ]; then printf '%s (새로 배포)' "${HEAD_SHA:0:7}"
  else printf '%s (그대로)' "${old:0:7}"; fi
}
server="$(component "$SERVER_NEW" "${SERVER_BEFORE:-확인 불가}")"
web="$(component "$WEB_NEW" "${WEB_BEFORE:-확인 불가}")"
data='확인 불가'
if [ -n "${DATA_AFTER:-}" ]; then
  state='변경 여부 확인 불가'
  if [ -n "${DATA_BEFORE:-}" ]; then
    if [ "$DATA_AFTER" = "$DATA_BEFORE" ]; then state=그대로; else state=바뀜; fi
  fi
  data="$DATA_AFTER ($state)"
fi
notes="서버 $server · 웹 $web · 데이터 $data"
args=(release create "$TAG" --target "$HEAD_SHA" --title "$TAG")
if [ -n "${PREVIOUS:-}" ]; then
  args+=(--generate-notes --notes-start-tag "$PREVIOUS" --notes "$notes")
else
  # 전체 저장소 이력을 첫 노트에 쏟지 않는다. 다음 배포부터 이 태그 이후의 PR만 자동 생성한다.
  args+=(--notes "$notes"$'\n\n첫 릴리즈. 이후 릴리즈부터 이 태그를 기준으로 변경 내역을 자동 생성합니다.')
fi
"${GH:-gh}" "${args[@]}"
