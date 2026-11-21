#!/usr/bin/env bash
# 배포 계획: 서버·웹 중 무엇을 배포할지와 순서를 정한다. .github/workflows/deploy.yml 의 plan 잡이 저장소 루트에서 부른다.
#
# 기준은 "직전 push"가 아니라 **지금 운영에 나가 있는 커밋**이다.
#   서버: Cloud Run에서 100% 트래픽을 받는 리비전의 이미지 태그(scripts/deployed-server-sha.sh)
#   웹:   100% 트래픽을 받는 Worker 버전의 tag(web/scripts/worker-version.sh deployed-tag, 배포 때 `--tag <sha 7자>`)
# 각 서비스마다 `git diff <배포된 커밋> HEAD`에 그 서비스 경로가 있으면 배포한다. 그래서 대기 중이던 실행이 취소되거나
# 여러 커밋이 한꺼번에 들어와도, 앞 배포가 실패해도 다음 실행이 밀린 변경을 모두 배포한다.
# 배포된 커밋을 모르면(조회 실패, main 이력에 없음, 형식 오류) 그 서비스는 배포한다(안전한 기본값). `git diff` 자체가 실패해도
# (객체 손상 등) "바뀐 것 없음"으로 보지 않고 그 서비스를 배포한다.
# 단 둘 다 배포 대상인데 운영 커밋 하나라도 모르면 밀린 범위의 시작을 알 수 없어 PR 라벨로 순서를 정할 수 없다. 이때는 순서를
# 추측하지 않고 종료 6으로 실패한다(main에서 deploy.yml 수동 실행, order 직접 선택).
#
# 결과는 `이름=값` 줄로 표준 출력에 나가서 $GITHUB_OUTPUT 에 그대로 붙인다.
#   server=true|false  web=true|false  order=server-first|web-first
# 설명(마크다운)은 SUMMARY_FILE이 있으면 거기에, 경고는 표준 오류에.
#
# 환경 변수:
#   EVENT_NAME       push | workflow_dispatch
#   GIT_REF          실행 ref(GITHUB_REF). 서버를 배포하는 계획은 refs/heads/main 에서만 허용한다(GCP 인증이 main 한정)
#   HEAD_SHA         배포할 커밋(기본: git rev-parse HEAD)
#   BEFORE           push 이벤트의 before(라벨 조회 범위 보충용. 0000…이면 무시. 범위의 시작을 증명하지는 못한다)
#   SERVER_DEPLOYED  운영 서버의 커밋(40자). 비우면 모름
#   WEB_DEPLOYED     운영 웹의 커밋(7~40자). 비우면 모름
#   TARGETS          auto(기본: 위 비교로 결정) | both | server | web   (수동 실행)
#   ORDER            비우면 라벨로 결정(push). server-first | web-first 면 그대로(수동 실행)
#   REPO             owner/name (라벨 조회). GH  gh 실행 명령(기본 gh, 테스트는 가짜로 바꿔 끼운다)
#   MAX_LABEL_COMMITS  라벨을 조회할 커밋 수 한도(기본 100). 넘으면 순서를 확정할 수 없어 실패한다
# 다른 사용법(테스트용):
#   deploy-plan.sh --paths server|web        경로 패턴 목록을 한 줄에 하나씩 출력
#   deploy-plan.sh --match server|web        표준 입력의 NUL 구분 경로 중 하나라도 맞으면 true, 아니면 false
# 경로 목록은 예전에 deploy-server.yml / deploy-web.yml 의 `on.push.paths` 에 있던 것과 같다(`**` → bash case의 `*`,
# `*`는 `/`도 맞춘다). 고치면 scripts/test-deploy-plan.sh 의 고정 목록도 고친다.
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
LABEL_WEB_FIRST='deploy:web-first'

matches_any() { # <파일> <패턴...>
  local file="$1" pattern
  shift
  for pattern in "$@"; do
    # shellcheck disable=SC2254  # 패턴은 글롭이어야 한다
    case "$file" in $pattern) return 0 ;; esac
  done
  return 1
}

# 표준 입력의 NUL 구분 경로 중 하나라도 <패턴...>에 맞으면 0
any_path_matches() {
  local file found=1
  while IFS= read -r -d '' file; do
    if matches_any "$file" "$@"; then found=0; fi
  done
  return "$found"
}

paths_for() {
  case "$1" in
    server) printf '%s\n' "${SERVER_PATHS[@]}" ;;
    web) printf '%s\n' "${WEB_PATHS[@]}" ;;
    *) echo "server 또는 web" >&2; return 2 ;;
  esac
}

case "${1:-}" in
  --paths) paths_for "${2:-}"; exit $? ;;
  --match)
    case "${2:-}" in
      server) any_path_matches "${SERVER_PATHS[@]}" && echo true || echo false ;;
      web) any_path_matches "${WEB_PATHS[@]}" && echo true || echo false ;;
      *) echo "server 또는 web" >&2; exit 2 ;;
    esac
    exit 0 ;;
  '') ;;
  *) echo "사용법: deploy-plan.sh [--paths|--match server|web]" >&2; exit 2 ;;
esac

EVENT_NAME="${EVENT_NAME:-push}"
GIT_REF="${GIT_REF:-}"
TARGETS="${TARGETS:-auto}"
ORDER="${ORDER:-}"
GH="${GH:-gh}"
MAX_LABEL_COMMITS="${MAX_LABEL_COMMITS:-100}"
HEAD_SHA="$(git rev-parse --verify "${HEAD_SHA:-HEAD}^{commit}")"

case "$TARGETS" in auto | both | server | web) ;; *) echo "TARGETS 값이 올바르지 않습니다: $TARGETS" >&2; exit 2 ;; esac
case "$ORDER" in '' | server-first | web-first) ;; *) echo "ORDER 값이 올바르지 않습니다: $ORDER" >&2; exit 2 ;; esac

summary() { if [ -n "${SUMMARY_FILE:-}" ]; then printf '%s\n' "$*" >> "$SUMMARY_FILE"; fi; }
short() { printf '%s' "${1:0:7}"; }

# 배포된 커밋 → HEAD의 조상인 전체 SHA. 모르면 빈 문자열(이유는 표준 오류)
resolve_base() { # <이름> <값>
  local name="$1" value="$2" full
  if [ -z "$value" ]; then echo "::warning::${name}: 운영에 나가 있는 커밋을 읽지 못했습니다. ${name}을(를) 배포합니다." >&2; return 0; fi
  if ! [[ "$value" =~ ^[0-9a-f]{7,40}$ ]]; then echo "::warning::${name}: 배포된 커밋 값의 형식이 다릅니다. ${name}을(를) 배포합니다." >&2; return 0; fi
  if ! full="$(git rev-parse --verify --quiet "${value}^{commit}" 2>/dev/null)"; then
    echo "::warning::${name}: 배포된 커밋 $(short "$value")을(를) 저장소에서 찾지 못했습니다(없거나 짧은 SHA가 모호). ${name}을(를) 배포합니다." >&2; return 0
  fi
  if ! git merge-base --is-ancestor "$full" "$HEAD_SHA"; then
    echo "::warning::${name}: 배포된 커밋 $(short "$full")이(가) 이 커밋의 이력에 없습니다(다른 브랜치에서 수동 배포?). ${name}을(를) 배포합니다." >&2; return 0
  fi
  printf '%s' "$full"
}

# <기준 커밋> 이후 바뀐 경로(이름 바뀜은 옛·새 경로 둘 다, -z라 한글·탭·줄바꿈 파일명도 그대로)가 패턴에 맞는가.
# 0 = 맞음 또는 비교 실패(배포한다), 1 = 비교가 성공했고 맞는 경로가 없음. NUL 경로 목록을 끝까지 만든 경우에만 "없음"이다.
changed_since() { # <기준> <패턴...>
  local base="$1" list rc=0
  shift
  list="$(mktemp)"
  git diff --no-renames --name-only -z "$base" "$HEAD_SHA" > "$list" || rc=$?
  if [ "$rc" -ne 0 ]; then
    rm -f "$list"
    echo "::warning::$(short "$base")..$(short "$HEAD_SHA") 비교가 실패했습니다(git diff 종료 $rc). 바뀐 것이 없다고 볼 수 없어 배포 대상으로 봅니다." >&2
    return 0
  fi
  rc=0
  any_path_matches "$@" < "$list" || rc=$?
  rm -f "$list"
  return "$rc"
}

server_base=""
web_base=""
server=false
web=false
data_changed=false

if [ "$TARGETS" = auto ]; then
  server_base="$(resolve_base 서버 "${SERVER_DEPLOYED:-}")"
  web_base="$(resolve_base 웹 "${WEB_DEPLOYED:-}")"
  if [ -z "$server_base" ] || changed_since "$server_base" "${SERVER_PATHS[@]}"; then server=true; fi
  if [ -z "$web_base" ] || changed_since "$web_base" "${WEB_PATHS[@]}"; then web=true; fi
  if [ -n "$web_base" ] && changed_since "$web_base" 'data/artifacts/*'; then data_changed=true; fi
  summary "- 운영 서버 커밋: \`$( [ -n "$server_base" ] && short "$server_base" || echo 모름)\` → 서버 배포 \`$server\`"
  summary "- 운영 웹 커밋: \`$( [ -n "$web_base" ] && short "$web_base" || echo 모름)\` → 웹 배포 \`$web\`"
else
  case "$TARGETS" in
    both) server=true; web=true ;;
    server) server=true ;;
    web) web=true ;;
  esac
  summary "- 수동 지정: \`$TARGETS\`"
fi

if [ "$server" = true ] && [ "$GIT_REF" != "refs/heads/main" ]; then
  echo "::error::서버를 포함한 배포는 main에서만 실행할 수 있습니다(지금 ref: ${GIT_REF:-없음}). GCP 인증이 main으로 한정되어 있어 뒤 단계에서 거부됩니다. main에서 다시 실행하거나 targets=web으로 고르세요." >&2
  exit 5
fi

order='server-first'
if [ -n "$ORDER" ]; then
  order="$ORDER"
elif [ "$server" = true ] && [ "$web" = true ]; then
  # 순서가 의미 있을 때만 라벨을 본다. 배포 범위(운영 커밋 이후 들어온 모든 커밋)의 병합 PR 중 하나라도 라벨이 있으면 웹 먼저.
  # 두 서비스 모두 배포하므로 범위는 두 운영 커밋 중 더 오래된 쪽부터다. 하나라도 모르면 시작을 증명할 수 없다(push의 before나 HEAD만
  # 보는 것은 추측이다: 앞 배포가 취소돼 밀린 PR의 라벨을 놓친다). 순서를 추측하지 않고 실패한다.
  if [ -z "$server_base" ] || [ -z "$web_base" ]; then
    unknown=""
    [ -z "$server_base" ] && unknown+=" 서버"
    [ -z "$web_base" ] && unknown+=" 웹"
    echo "::error::서버·웹이 모두 배포 대상인데 운영에 나가 있는 커밋을 읽지 못한 서비스가 있어(${unknown# }) 밀린 범위의 시작을 알 수 없고, PR 라벨로 순서를 정할 수 없습니다. 순서를 추측하지 않고 중단합니다. main에서 deploy.yml을 수동 실행해 order(server-first / web-first)를 직접 고르세요(targets=both)." >&2
    summary "- 순서를 정하지 못함: 운영 커밋을 모르는 서비스(${unknown# })가 있어 배포 범위의 시작을 알 수 없음 → main에서 deploy.yml 수동 실행(order 직접 선택)"
    exit 6
  fi
  bases="$server_base $web_base"
  if [[ -n "${BEFORE:-}" && ! "${BEFORE}" =~ ^0+$ ]] && git cat-file -e "${BEFORE}^{commit}" 2>/dev/null && git merge-base --is-ancestor "$BEFORE" "$HEAD_SHA"; then
    bases+=" $(git rev-parse "${BEFORE}^{commit}")"
  fi
  # shellcheck disable=SC2086  # 공백으로 나눈 SHA 목록
  root="$(git merge-base --octopus $bases)"
  commits="$( { echo "$HEAD_SHA"; git rev-list "${root}..${HEAD_SHA}"; } | awk '!seen[$0]++')"
  count="$(grep -c . <<<"$commits")"
  if [ "$count" -gt "$MAX_LABEL_COMMITS" ]; then
    echo "::error::배포 범위의 커밋이 ${count}개라(한도 $MAX_LABEL_COMMITS) PR 라벨을 다 볼 수 없어 순서를 정하지 못했습니다. deploy.yml을 targets=both, order를 직접 골라 수동 실행하세요." >&2
    exit 3
  fi
  web_first_prs=""
  for c in $commits; do
    # 커밋 연결 PR API는 페이지 단위라 --paginate로 모든 페이지를 읽는다(이어 붙은 JSON 배열들을 jq가 차례로 처리)
    if ! json="$($GH api "repos/${REPO:?REPO가 필요합니다}/commits/${c}/pulls" --paginate)"; then
      echo "::error::커밋 $(short "$c")의 PR 라벨을 읽지 못해 순서를 정할 수 없습니다. 다시 실행하거나 수동 실행에서 order를 고르세요." >&2
      exit 4
    fi
    # 병합된 PR만, 라벨 이름은 정확히 같을 때만
    if ! prs="$(jq -r --arg l "$LABEL_WEB_FIRST" '.[] | select(.merged_at != null) | select(any(.labels[]?; .name == $l)) | .number' <<<"$json")"; then
      echo "::error::커밋 $(short "$c")의 PR 응답을 해석하지 못했습니다." >&2
      exit 4
    fi
    while IFS= read -r n; do if [ -n "$n" ]; then web_first_prs+=" #$n"; fi; done <<<"$prs"
  done
  if [ -n "$web_first_prs" ]; then order='web-first'; fi
  summary "- 라벨 조회: 커밋 ${count}개, \`$LABEL_WEB_FIRST\` PR:${web_first_prs:- 없음}"
fi

if [ "$order" = "web-first" ] && [ "$server" = true ] && [ "$web" = true ] && [ "$data_changed" = true ]; then
  echo "::warning::웹 먼저 순서인데 데이터 산출물(data/artifacts)도 바뀌었습니다. 새 역 색인을 쓰는 웹이 옛 서버를 부르면 스모크가 실패해 웹이 직전 버전으로 되돌려집니다. 데이터 변경은 서버 먼저로 배포하세요." >&2
fi

echo "server=$server"
echo "web=$web"
echo "order=$order"
