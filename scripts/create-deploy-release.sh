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
if result="$("${GH:-gh}" "${args[@]}" 2>&1)"; then
  if [ -n "$result" ]; then printf '%s\n' "$result"; fi
  exit 0
else
  status=$?
fi
if [ -n "$result" ]; then printf '%s\n' "$result" >&2; fi

# 대상 SHA의 워크플로 파일이 기본 브랜치와 다르면 GITHUB_TOKEN으로 새 태그를 만들 수 없다.
# 배포 후 릴리즈 생성 API에서 받은 이 응답만 생략한다. 노트 조회 등의 오류는 계속 실패로 남긴다.
if ! grep -Eq '^HTTP 403: Resource not accessible by integration \(https://api\.github\.com/repos/[^/]+/[^/]+/releases\)$' <<< "$result"; then
  exit "$status"
fi

message="릴리즈 생략: $TAG (${HEAD_SHA:0:7}) 생성 권한이 거부됐습니다."
if [ -n "${PREVIOUS:-}" ]; then
  message+=" $PREVIOUS 이후의 변경은 다음 릴리즈 노트에 포함됩니다."
else
  message+=' 이전 태그가 없어 첫 릴리즈의 변경 내역은 수동으로 기록합니다.'
fi
printf '::warning title=GitHub 릴리즈 생략::%s\n' "$message"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    printf '%s\n\n다음 릴리즈 전에 수동 발행하려면 태그 이름이 아직 사용되지 않았는지 확인하고, 권한이 있는 토큰으로 아래 명령을 실행합니다.\n\n' "$message"
    (
      export LC_ALL=C
      printf '    gh'
      printf ' %q' "${args[@]}"
      if [ -n "${GH_REPO:-}" ]; then printf ' --repo %q' "$GH_REPO"; fi
      printf '\n'
    )
  } >> "$GITHUB_STEP_SUMMARY"
fi
