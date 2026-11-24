#!/usr/bin/env bash
# 임시 git 저장소·가짜 gh/curl만 쓴다. 실제 태그 push·릴리즈·외부 API 호출 없음.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
git init -q -b main "$repo"
g() { git -C "$repo" "$@"; }
g config user.name test
g config user.email test@example.invalid
g config commit.gpgsign false
g config tag.gpgsign false
g config core.hooksPath /dev/null
commit() { g commit --allow-empty -qm "$1"; }
expect() { if [ "$2" != "$3" ]; then printf 'FAIL %s: expected %s, got %s\n' "$1" "$3" "$2"; exit 1; fi; echo "ok $1"; }
commit first
base="$(g rev-parse HEAD)"
commit second
HEAD_SHA="$(g rev-parse HEAD)"
export HEAD_SHA
# 2026-11-24 14:59:59 / 15:00:00 UTC = KST 자정 경계.
export RELEASE_TIME=1795532399
plan() { (cd "$repo" && bash "$here/release-tag.sh"); }
value() { plan | sed -n "s/^$1=//p"; }
expect 'KST 자정 직전, 첫 태그' "$(value tag)" v2026.11.24
expect '첫 태그 기준 없음' "$(value previous)" ''
export RELEASE_TIME=1795532400
expect 'KST 자정 직후' "$(value tag)" v2026.11.25
g tag v2026.11.25 "$base"
expect '당일 두 번째' "$(value tag)" v2026.11.25.1
g tag v2026.11.25.1 "$base"
g tag v2026.11.25.9 "$base"
g tag v2026.11.25.10 "$base"
g tag v2026.11.25.012 "$base"
g tag v2026x11x25.99 "$base"
expect '접미사 숫자 비교·빈 번호 재사용 안 함·비슷한 이름 무시' "$(value tag)" v2026.11.25.11
expect '이전 날짜 태그 숫자 정렬' "$(value previous)" v2026.11.25.10
g tag -a v2026.11.25.11 -m release "$HEAD_SHA"
expect 'annotated 태그도 재실행 생략' "$(plan)" skip=true
g tag -d v2026.11.25.11 >/dev/null
g tag unrelated "$HEAD_SHA"
expect '이미 커밋에 다른 태그가 있어도 생략' "$(plan)" skip=true
g tag -d unrelated >/dev/null
# 다른 브랜치의 더 새 태그는 이름 충돌을 피하지만 이전 노트 기준으로는 쓰지 않는다.
g checkout -q --orphan other
commit other
g tag v2026.11.25.12
expect '다른 브랜치 태그도 번호 충돌 방지' "$(value tag)" v2026.11.25.13
expect '다른 브랜치는 노트 기준에서 제외' "$(value previous)" v2026.11.25.10

mkdir "$tmp/bin"
cat > "$tmp/bin/gh" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CALLS"
exit "${GH_EXIT:-0}"
FAKE
cat > "$tmp/bin/curl" <<'FAKE'
#!/usr/bin/env bash
if [ "${CURL_FAIL:-false}" = true ]; then exit 22; fi
printf '%s' "${MANIFEST:-}"
FAKE
chmod +x "$tmp/bin/gh" "$tmp/bin/curl"
export PATH="$tmp/bin:$PATH" CALLS="$tmp/calls"
export TAG=v2026.11.25.13 PREVIOUS=v2026.11.25.10
export SERVER_NEW=true WEB_NEW=false WEB_BEFORE=abcdef1234567
export DATA_BEFORE=20261123.1 DATA_AFTER=20261124.1
bash "$here/create-deploy-release.sh"
expect '명시한 전체 커밋으로 생성' "$(sed -n '5p' "$CALLS")" "$HEAD_SHA"
expect '노트 시작 태그' "$(sed -n '/^--notes-start-tag$/{n;p;}' "$CALLS")" "$PREVIOUS"
expect '대상별 첫 줄' "$(sed -n '/^--notes$/{n;p;}' "$CALLS")" "서버 ${HEAD_SHA:0:7} (새로 배포) · 웹 abcdef1 (그대로) · 데이터 20261124.1 (바뀜)"
export DATA_AFTER="$DATA_BEFORE" SERVER_NEW=false SERVER_BEFORE=1234567890 WEB_NEW=true
bash "$here/create-deploy-release.sh"
expect '서버 그대로·웹 배포·데이터 그대로' "$(sed -n '/^--notes$/{n;p;}' "$CALLS")" "서버 1234567 (그대로) · 웹 ${HEAD_SHA:0:7} (새로 배포) · 데이터 $DATA_AFTER (그대로)"
export PREVIOUS='' DATA_BEFORE='' DATA_AFTER=''
bash "$here/create-deploy-release.sh"
if rg -q -- '--generate-notes|--notes-start-tag' "$CALLS"; then echo 'FAIL 첫 릴리즈 전체 이력 생성'; exit 1; fi
rg -q '첫 릴리즈' "$CALLS"
echo 'ok 첫 릴리즈는 짧은 노트, 모르는 데이터는 확인 불가'
if GH_EXIT=1 bash "$here/create-deploy-release.sh"; then echo 'FAIL gh 오류 은폐'; exit 1; fi
echo 'ok 릴리즈 실패를 잡에서 확인 가능'
export SITE_DOMAIN=example.com MANIFEST='{"dataVersion":"20261124.1"}'
expect '서버 manifest 실제 dataVersion' "$(bash "$here/release-data-version.sh")" 20261124.1
expect 'manifest 실패는 빈 값' "$(CURL_FAIL=true bash "$here/release-data-version.sh")" ''
expect '잘못된 버전은 빈 값' "$(MANIFEST='{"dataVersion":"bad"}' bash "$here/release-data-version.sh")" ''
expect '잘못된 도메인은 빈 값' "$(SITE_DOMAIN='bad/path' bash "$here/release-data-version.sh")" ''
echo 'All deploy-release tests passed.'
