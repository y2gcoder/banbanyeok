#!/usr/bin/env bash
# scripts/deploy-plan.sh · scripts/deployed-server-sha.sh 단위 테스트. `bash scripts/test-deploy-plan.sh` (CI의 deploy-scripts 잡도 돌린다).
# 임시 git 저장소에 커밋을 쌓고, 가짜 gh(PR 라벨)·가짜 gcloud(Cloud Run)로 돌린다. 네트워크·실제 배포 없음.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
plan="$here/deploy-plan.sh"
server_sha="$here/deployed-server-sha.sh"
failed=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; failed=1; }
expect() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1: 기대 '$3' / 실제 '$2'"; fi; }

echo "== 경로 목록: main의 예전 on.push.paths와 같은 집합"
# 예전 deploy-server.yml / deploy-web.yml 의 paths 그대로(병합 전 main 44631a9). `**`는 bash case의 `*`와 같다.
MAIN_SERVER='server/**
contracts/**
shared/**
build-logic/**
gradle/**
data/artifacts/dev/**
pipeline/src/main/kotlin/app/banbanyeok/pipeline/ReleaseStage.kt
scripts/publish-artifacts.sh
scripts/db-backup.sh
infra/backup/**
scripts/smoke-server.sh
scripts/build-server-image.sh
.github/workflows/deploy-server.yml'
MAIN_WEB='web/**
contracts/**
data/artifacts/**
package.json
pnpm-lock.yaml
pnpm-workspace.yaml'
# 웹은 예전 deploy-web.yml이 자기 파일을 paths에 넣지 않았다. 지금은 서버처럼 자기 워크플로 변경도 배포한다(의도한 추가 1건).
expect "서버 경로 = main" "$(bash "$plan" --paths server | sort)" "$(sort <<<"${MAIN_SERVER//\*\*/*}")"
expect "웹 경로 = main + deploy-web.yml" "$(bash "$plan" --paths web | sort)" "$(printf '%s\n.github/workflows/deploy-web.yml\n' "${MAIN_WEB//\*\*/*}" | sort)"

m() { printf '%s\0' "${@:2}" | bash "$plan" --match "$1"; }
expect "서버: 깊은 하위 경로" "$(m server 'server/app/src/main/kotlin/A.kt')" true
expect "서버: DB changelog" "$(m server 'server/db/changelog/0010.yaml')" true
expect "서버: dev 산출물" "$(m server 'data/artifacts/dev/manifest.json')" true
expect "서버: 다른 산출물은 아님" "$(m server 'data/artifacts/prod/x.json')" false
expect "서버: ReleaseStage.kt만" "$(m server 'pipeline/src/main/kotlin/app/banbanyeok/pipeline/ReleaseStage.kt')" true
expect "서버: 다른 파이프라인 파일은 아님" "$(m server 'pipeline/src/main/kotlin/app/banbanyeok/pipeline/Other.kt')" false
expect "서버: 웹 파일은 아님" "$(m server 'web/src/a.ts')" false
expect "웹: 의존성" "$(m web 'pnpm-lock.yaml')" true
expect "웹: 산출물 전체" "$(m web 'data/artifacts/prod/x.json')" true
expect "웹: 오케스트레이터는 아님" "$(m web '.github/workflows/deploy.yml' 'scripts/deploy-plan.sh')" false
expect "둘 다: 계약" "$(m server contracts/openapi.yaml)/$(m web contracts/openapi.yaml)" true/true
expect "한글 파일명" "$(m web 'web/src/한글.ts')" true
expect "탭·줄바꿈 파일명" "$(m web $'web/a\tb.ts' $'docs/x\ny')" true
expect "문서만" "$(m server docs/a.md README.md)/$(m web docs/a.md README.md)" false/false

echo "== 계획: 운영 커밋 → HEAD 비교 (임시 저장소)"
repo="$tmp/repo"
git init -q -b main "$repo"
g() { git -C "$repo" -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false "$@"; }
commit() { # <메시지> <경로=내용 | -경로 | 옛경로>새경로 ...>
  local msg="$1" spec
  shift
  for spec in "$@"; do
    case "$spec" in
      -*) g rm -q -- "${spec#-}" ;;
      *'>'*) mkdir -p "$repo/$(dirname "${spec#*>}")"; g mv -- "${spec%%>*}" "${spec#*>}" ;;
      *) mkdir -p "$repo/$(dirname "${spec%%=*}")"; printf '%s\n' "${spec#*=}" > "$repo/${spec%%=*}"; g add -- "${spec%%=*}" ;;
    esac
  done
  g commit -q -m "$msg"
  g rev-parse HEAD
}
A="$(commit base 'server/a.kt=1' 'web/a.ts=1' 'docs/r.md=1' 'data/artifacts/x.json=1')"

# 가짜 gh: $GHS/pulls/<sha>.json 을 돌려준다(없으면 []). FAIL 파일이 있으면 실패. 호출을 calls에 남긴다.
GHS="$tmp/gh"; mkdir -p "$GHS/pulls"
cat > "$tmp/gh-fake" <<'FAKE'
#!/usr/bin/env bash
echo "$*" >> "$GHS/calls"
[ -f "$GHS/FAIL" ] && { echo "HTTP 502" >&2; exit 1; }
sha="${2#repos/*/commits/}"; sha="${sha%/pulls}"
if [ -f "$GHS/pulls/$sha.json" ]; then cat "$GHS/pulls/$sha.json"; else echo '[]'; fi
FAKE
chmod +x "$tmp/gh-fake"
pr() { # <sha> <번호> <병합 여부 true|false> <라벨...>
  local sha="$1" n="$2" merged="$3"
  shift 3
  jq -n --argjson n "$n" --arg merged "$merged" '[{number: $n, merged_at: (if $merged == "true" then "2026-11-21T00:00:00Z" else null end),
    labels: ($ARGS.positional | map({name: .}))}]' --args "$@" > "$GHS/pulls/$sha.json"
}
gh_reset() { rm -rf "$GHS"; mkdir -p "$GHS/pulls"; : > "$GHS/calls"; }

# plan <이름> <기대(server web order) 또는 exit:N> [KEY=VAL...]   (기본: push, main, HEAD)
plan_run() {
  local name="$1" want="$2"
  shift 2
  local got code
  got="$(cd "$repo" && env EVENT_NAME=push GIT_REF=refs/heads/main REPO=o/r GH="$tmp/gh-fake" GHS="$GHS" "$@" bash "$plan" 2>"$tmp/err" | paste -sd' ' -)"
  code="${PIPESTATUS[0]}"
  [ "$code" = 0 ] || got="exit:$code"
  if [ "$got" = "$want" ]; then pass "$name"; else fail "$name: 기대 '$want' / 실제 '$got' ($(head -c 400 "$tmp/err" | tr '\n' '|'))"; fi
}
S='server=true web=false order=server-first'
W='server=false web=true order=server-first'
B='server=true web=true order=server-first'
BW='server=true web=true order=web-first'
N='server=false web=false order=server-first'

gh_reset
C1="$(commit 'docs' 'docs/r.md=2')"
plan_run "문서만 바뀜: 배포 없음" "$N" SERVER_DEPLOYED="$A" WEB_DEPLOYED="$A"
plan_run "운영이 이미 HEAD: 배포 없음" "$N" SERVER_DEPLOYED="$C1" WEB_DEPLOYED="${C1:0:7}"
C2="$(commit 'move' 'server/a.kt>docs/a.kt')"
plan_run "이름 바뀜 server/a → docs/a: 옛 경로로 서버" "$S" SERVER_DEPLOYED="$C1" WEB_DEPLOYED="$C1"
C3="$(commit 'kr' 'web/src/한글.ts=1')"
plan_run "한글 파일명 추가: 웹" "$W" SERVER_DEPLOYED="$C3" WEB_DEPLOYED="$C2"
C4="$(commit 'tab' $'web/a\tb.ts=1')"
plan_run "탭 든 파일명: 웹" "$W" SERVER_DEPLOYED="$C4" WEB_DEPLOYED="$C3"
# 대기열 취소: 서버 변경 B5가 대기 중 취소되고 문서만 바꾼 C6이 돈다 → 운영 커밋(C4) 기준이라 서버가 빠지지 않는다
B5="$(commit 'server change' 'server/b.kt=1')"
C6="$(commit 'docs again' 'docs/r.md=3')"
plan_run "중간 push가 취소돼도 밀린 서버 변경을 배포" "$S" SERVER_DEPLOYED="$C4" WEB_DEPLOYED="$C4" BEFORE="$B5"
plan_run "서버는 이미 B5까지 나가 있으면 서버 없음" "$N" SERVER_DEPLOYED="$B5" WEB_DEPLOYED="$C4"
plan_run "운영 서버 커밋을 모르면 서버 배포" "$S" SERVER_DEPLOYED="" WEB_DEPLOYED="$C6"
plan_run "운영 웹 커밋을 모르면 웹 배포" "$W" SERVER_DEPLOYED="$C6" WEB_DEPLOYED=""
plan_run "형식이 다른 값은 모름" "$W" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="release-1"
plan_run "저장소에 없는 커밋은 모름" "$W" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="deadbee"
g checkout -q -b side "$A"; SIDE="$(commit 'side' 'docs/side.md=1')"; g checkout -q main
plan_run "이력에 없는 커밋(다른 브랜치 수동 배포)은 모름" "$W" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="${SIDE:0:7}"
# git diff 실패 ≠ 변경 없음: 기준 커밋(C4)의 트리 객체만 치우면 커밋 확인·조상 검사는 통과하고 diff만 종료 128로 실패한다.
# C4 이후 웹 변경은 없으므로(서버 b.kt, 문서뿐) 정상이면 웹 없음이다. 실패를 "변경 없음"으로 보면 웹이 빠진다.
plan_run "정상 비교: C4 이후 웹 변경 없음" "$N" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C4"
tree="$(git -C "$repo" rev-parse "${C4}^{tree}")"
obj="$repo/.git/objects/${tree:0:2}/${tree:2}"
if [ -f "$obj" ]; then
  mv "$obj" "$tmp/tree-hidden"
  if git -C "$repo" diff --no-renames --name-only -z "$C4" "$C6" >/dev/null 2>&1; then fail "재현 실패: 트리 객체를 치웠는데 git diff가 성공한다"; fi
  plan_run "git diff 실패(트리 객체 없음)는 변경 없음이 아니라 배포 대상" "$W" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C4"
  if grep -q 'git diff 종료' "$tmp/err"; then pass "diff 실패 경고"; else fail "diff 실패 경고가 없다"; fi
  mv "$tmp/tree-hidden" "$obj"
else
  fail "트리 객체가 느슨한 파일이 아니라 diff 실패를 재현하지 못했다: $obj"
fi
plan_run "트리 복원 뒤 다시 정상 비교" "$N" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C4"

echo "== 순서: 배포 범위의 모든 병합 PR 라벨"
gh_reset
D1="$(commit 'pr1 server' 'server/c.kt=1')"
D2="$(commit 'pr2 web' 'web/c.ts=1')"
D3="$(commit 'pr3 docs' 'docs/r.md=4')"
pr "$D1" 11 true 'deploy:web-first'; pr "$D2" 12 true bug; pr "$D3" 13 true
plan_run "가장 오래된 커밋의 PR에만 라벨이 있어도 웹 먼저" "$BW" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C6" BEFORE="$D2"
expect "범위의 커밋 3개를 모두 조회" "$(grep -c . "$GHS/calls")" 3
gh_reset; pr "$D1" 11 true bug
plan_run "라벨 없으면 서버 먼저" "$B" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C6"
gh_reset; pr "$D3" 13 true 'docs, deploy:web-first'
plan_run "이름이 다른 라벨(쉼표 든 한 이름)은 무시" "$B" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C6"
gh_reset; pr "$D3" 13 true 'deploy:web-first-not' 'Deploy:Web-First'
plan_run "비슷한 라벨·대소문자 다른 라벨은 무시" "$B" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C6"
gh_reset; pr "$D3" 99 false 'deploy:web-first'
plan_run "병합 안 된 PR의 라벨은 무시" "$B" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C6"
gh_reset; pr "$D3" 13 true 'deploy:web-first'
# 둘 다 배포 대상인데 운영 커밋을 하나라도 모르면 범위의 시작을 증명할 수 없다 → 순서를 추측하지 않고 실패(종료 6), gh 호출·배포 없음
plan_run "운영 커밋을 둘 다 모르면 순서를 정하지 못해 실패(before 0)" "exit:6" SERVER_DEPLOYED="" WEB_DEPLOYED="" BEFORE=0000000000000000000000000000000000000000
if grep -q 'deploy.yml을 수동 실행' "$tmp/err"; then pass "실패 메시지가 수동 실행을 안내"; else fail "수동 실행 안내가 없다"; fi
expect "추측하지 않으므로 PR 조회 없음" "$(grep -c . "$GHS/calls")" 0
gh_reset; pr "$D2" 12 true 'deploy:web-first'
plan_run "운영 커밋을 몰라도 before가 있다고 추측하지 않는다" "exit:6" SERVER_DEPLOYED="" WEB_DEPLOYED="" BEFORE="$D1"
gh_reset; pr "$D1" 11 true 'deploy:web-first'
plan_run "서버만 모르면 실패(범위의 시작을 증명 못 함)" "exit:6" SERVER_DEPLOYED="" WEB_DEPLOYED="$C6" BEFORE="$D2"
plan_run "웹만 모르면 실패" "exit:6" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="" BEFORE="$D2"
plan_run "수동 order를 주면 운영 커밋을 몰라도 라벨 없이 진행" "$B" ORDER=server-first SERVER_DEPLOYED="" WEB_DEPLOYED=""
# 라벨 조회는 --paginate로 모든 페이지를 읽는다(앞 페이지가 비어 있고 뒤 페이지에 라벨 PR이 있어도 웹 먼저)
gh_reset
jq -n '[]' > "$GHS/pulls/$D3.json"
pr "$D1" 11 false; cp "$GHS/pulls/$D1.json" "$GHS/p1"
pr "$D1" 21 true 'deploy:web-first'; cat "$GHS/pulls/$D1.json" >> "$GHS/p1"; mv "$GHS/p1" "$GHS/pulls/$D1.json"
plan_run "여러 페이지로 이어 붙은 응답의 뒤 페이지 라벨도 읽는다" "$BW" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C6"
if grep -q -- '--paginate' "$GHS/calls"; then pass "gh api에 --paginate"; else fail "--paginate 없이 호출한다"; fi
gh_reset; touch "$GHS/FAIL"
plan_run "라벨 조회 실패는 배포 전에 실패" "exit:4" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C6"
gh_reset; printf 'not json' > "$GHS/pulls/$D3.json"
plan_run "PR 응답이 JSON이 아니면 실패" "exit:4" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C6"
gh_reset
plan_run "커밋이 한도보다 많으면 순서를 확정 못 해 실패" "exit:3" SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C6" MAX_LABEL_COMMITS=2
gh_reset; pr "$D3" 13 true 'deploy:web-first'
plan_run "한쪽만 바뀌면 라벨을 보지 않는다" "$N" SERVER_DEPLOYED="$D3" WEB_DEPLOYED="$D3"
plan_run "한쪽만(웹) 바뀌면 그쪽만, 라벨 조회 없음" "$W" SERVER_DEPLOYED="$D3" WEB_DEPLOYED="$D1"
expect "한쪽만이면 gh 호출 없음" "$(grep -c . "$GHS/calls")" 0
D4="$(commit 'pr4 data' 'data/artifacts/dev/m.json=2')"
pr "$D4" 14 true 'deploy:web-first'
plan_run "웹 먼저 + 데이터 변경은 그대로 웹 먼저(경고)" "$BW" SERVER_DEPLOYED="$D3" WEB_DEPLOYED="$D3"
if grep -q 'data/artifacts' "$tmp/err"; then pass "데이터 변경 경고"; else fail "데이터 변경 경고가 없다"; fi

echo "== 수동 실행"
gh_reset
plan_run "수동: 둘 다 + 웹 먼저" "$BW" EVENT_NAME=workflow_dispatch TARGETS=both ORDER=web-first
plan_run "수동: 서버만" "$S" EVENT_NAME=workflow_dispatch TARGETS=server ORDER=server-first
plan_run "수동: 순서 지정은 라벨보다 우선" "$B" EVENT_NAME=workflow_dispatch TARGETS=auto ORDER=server-first SERVER_DEPLOYED="$C6" WEB_DEPLOYED="$C6"
plan_run "수동: main이 아닌 ref에서 서버 포함은 거부" "exit:5" EVENT_NAME=workflow_dispatch GIT_REF=refs/heads/feature TARGETS=both ORDER=web-first
plan_run "수동: main이 아닌 ref에서 auto라도 서버가 대상이면 거부" "exit:5" EVENT_NAME=workflow_dispatch GIT_REF=refs/heads/feature TARGETS=auto ORDER=server-first
plan_run "수동: main이 아닌 ref의 웹만은 허용" "$W" EVENT_NAME=workflow_dispatch GIT_REF=refs/heads/feature TARGETS=web ORDER=server-first
expect "수동 실행은 gh 호출 없음" "$(grep -c . "$GHS/calls")" 0
plan_run "잘못된 TARGETS는 실패" "exit:2" TARGETS=nope
plan_run "잘못된 ORDER는 실패" "exit:2" ORDER=sideways

echo "== 운영 서버 커밋 읽기 (가짜 gcloud)"
SHA40=0123456789abcdef0123456789abcdef01234567
cat > "$tmp/gcloud-fake" <<'FAKE'
#!/usr/bin/env bash
case "$1 $2 $3" in
  "run services describe") [ -f "$GCS/FAIL_SVC" ] && exit 1; cat "$GCS/service.json" ;;
  "run revisions describe") [ -f "$GCS/FAIL_REV" ] && exit 1; [ "$4" = "$(cat "$GCS/rev")" ] || exit 1; cat "$GCS/revision.json" ;;
  *) exit 9 ;;
esac
FAKE
chmod +x "$tmp/gcloud-fake"
GCS="$tmp/gc"
gc_reset() { # <traffic JSON 배열> <이미지>
  rm -rf "$GCS"; mkdir -p "$GCS"; echo server-00042-abc > "$GCS/rev"
  jq -n --argjson t "$1" '{metadata: {name: "server"}, status: {url: "https://server.example.invalid", latestCreatedRevisionName: "server-00043-new", traffic: $t}}' > "$GCS/service.json"
  jq -n --arg img "$2" '{metadata: {name: "server-00042-abc"}, spec: {containers: [{image: $img}]}}' > "$GCS/revision.json"
}
srv() { GCS="$GCS" GCLOUD="$tmp/gcloud-fake" REGION=r bash "$server_sha" 2>/dev/null; echo "exit:$?"; }
IMG="r-docker.pkg.dev/p/server/server:$SHA40"
gc_reset '[{"revisionName":"server-00042-abc","percent":100,"latestRevision":true}]' "$IMG"
expect "서버: 100% 리비전의 이미지 태그" "$(srv | paste -sd' ' -)" "$SHA40 exit:0"
gc_reset '[{"revisionName":"server-00042-abc","percent":100},{"revisionName":"server-00043-new","percent":0,"tag":"candidate"}]' "$IMG"
expect "서버: 트래픽 0 후보 태그는 무시" "$(srv | paste -sd' ' -)" "$SHA40 exit:0"
gc_reset '[{"revisionName":"server-00042-abc","percent":50},{"revisionName":"server-00043-new","percent":50}]' "$IMG"
expect "서버: 트래픽이 나뉘면 모름" "$(srv)" "exit:1"
gc_reset '[{"revisionName":"server-00042-abc","percent":100}]' "r-docker.pkg.dev/p/server/server:latest"
expect "서버: 태그가 SHA가 아니면 모름" "$(srv)" "exit:1"
gc_reset '[{"revisionName":"server-00042-abc","percent":100}]' "$IMG"; touch "$GCS/FAIL_SVC"
expect "서버: 서비스 조회 실패는 모름" "$(srv)" "exit:1"
gc_reset '[{"revisionName":"server-00042-abc","percent":100}]' "$IMG"; touch "$GCS/FAIL_REV"
expect "서버: 리비전 조회 실패는 모름" "$(srv)" "exit:1"
gc_reset '[]' "$IMG"
expect "서버: 트래픽 정보 없음은 모름" "$(srv)" "exit:1"

exit $failed
