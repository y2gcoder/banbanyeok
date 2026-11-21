#!/usr/bin/env bash
# 배포 계획: 바뀐 파일 목록(표준 입력, 한 줄에 하나)으로 서버·웹 중 무엇을 배포할지와 순서를 정한다.
# .github/workflows/deploy.yml 의 plan 잡이 부른다. 결과는 `이름=값` 줄로 표준 출력에 나가서 $GITHUB_OUTPUT 에 그대로 붙인다.
#   server=true|false   서버 배포 여부
#   web=true|false      웹 배포 여부
#   order=server-first|web-first
# 환경 변수:
#   PR_LABELS  병합된 PR의 라벨(줄바꿈 또는 쉼표로 구분). `deploy:web-first`가 있으면 웹 먼저, 없으면 서버 먼저.
#   TARGETS    auto(기본: 바뀐 파일로 결정) | both | server | web   (수동 실행에서 쓴다)
#   ORDER      비우면 라벨로 결정. server-first | web-first 면 라벨을 무시하고 그대로 쓴다(수동 실행)
# 경로 목록은 예전에 deploy-server.yml / deploy-web.yml 의 `on.push.paths` 에 있던 것과 같다. 한쪽을 고치면 scripts/test-deploy-plan.sh 도 고친다.
# 비밀값은 다루지 않는다.
set -euo pipefail

SERVER_PATHS=(
  'server/*'                   # server/db/changelog 포함
  'contracts/*'
  'shared/*'
  'build-logic/*'
  'gradle/*'
  'data/artifacts/dev/*'       # 새 데이터 발행 = 새 리비전(docs/setup/p3-notes.md 8절 1번)
  'pipeline/src/main/kotlin/app/banbanyeok/pipeline/ReleaseStage.kt'
  'scripts/publish-artifacts.sh'
  'scripts/db-backup.sh'       # backup 이미지에 들어간다
  'infra/backup/*'
  'scripts/smoke-server.sh'
  'scripts/build-server-image.sh'
  '.github/workflows/deploy-server.yml'
)
WEB_PATHS=(
  'web/*'
  'contracts/*'
  'data/artifacts/*'
  'package.json'
  'pnpm-lock.yaml'
  'pnpm-workspace.yaml'
  '.github/workflows/deploy-web.yml'
)

TARGETS="${TARGETS:-auto}"
ORDER="${ORDER:-}"
LABEL_WEB_FIRST='deploy:web-first'

case "$TARGETS" in auto | both | server | web) ;; *) echo "TARGETS 값이 올바르지 않습니다: $TARGETS" >&2; exit 2 ;; esac
case "$ORDER" in '' | server-first | web-first) ;; *) echo "ORDER 값이 올바르지 않습니다: $ORDER" >&2; exit 2 ;; esac

matches_any() { # <파일> <패턴...>
  local file="$1" pattern
  shift
  for pattern in "$@"; do
    # shellcheck disable=SC2254  # 패턴은 글롭이어야 한다
    case "$file" in $pattern) return 0 ;; esac
  done
  return 1
}

server=false
web=false
data_changed=false
while IFS= read -r file || [ -n "$file" ]; do
  [ -z "$file" ] && continue
  matches_any "$file" "${SERVER_PATHS[@]}" && server=true
  matches_any "$file" "${WEB_PATHS[@]}" && web=true
  matches_any "$file" 'data/artifacts/*' && data_changed=true
done

case "$TARGETS" in
  both) server=true; web=true ;;
  server) server=true; web=false ;;
  web) server=false; web=true ;;
esac

order='server-first'
if [ -n "$ORDER" ]; then
  order="$ORDER"
elif tr ',' '\n' <<<"${PR_LABELS:-}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -qxF "$LABEL_WEB_FIRST"; then
  order='web-first'
fi

if [ "$order" = "web-first" ] && [ "$server" = true ] && [ "$web" = true ] && [ "$data_changed" = true ]; then
  echo "::warning::웹 먼저 순서인데 데이터 산출물(data/artifacts)도 바뀌었습니다. 새 역 색인을 쓰는 웹이 옛 서버를 부르면 스모크가 실패해 웹이 직전 버전으로 되돌려집니다. 데이터 변경은 서버 먼저로 배포하세요." >&2
fi

echo "server=$server"
echo "web=$web"
echo "order=$order"
