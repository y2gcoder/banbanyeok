#!/usr/bin/env bash
# scripts/deploy-plan.sh 단위 테스트. `bash scripts/test-deploy-plan.sh` (CI의 deploy-scripts 잡도 돌린다).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
plan="$here/deploy-plan.sh"
failed=0

# check <이름> <기대 출력(server web order 한 줄)> <바뀐 파일(줄바꿈)> [환경 변수 KEY=VAL...]
check() {
  local name="$1" expect="$2" files="$3"
  shift 3
  local got
  got="$(printf '%s\n' "$files" | env "$@" bash "$plan" 2>/dev/null | paste -sd' ' -)"
  if [ "$got" = "$expect" ]; then echo "ok   $name"; else echo "FAIL $name: 기대 '$expect' / 실제 '$got'"; failed=1; fi
}

S='server=true web=false order=server-first'
W='server=false web=true order=server-first'
B='server=true web=true order=server-first'
none='server=false web=false order=server-first'

check "서버만 바뀜" "$S" 'server/app/src/Main.kt'
check "서버 DB changelog" "$S" 'server/db/changelog/0010.yaml'
check "웹만 바뀜" "$W" 'web/src/app/page.tsx'
check "웹 의존성" "$W" 'pnpm-lock.yaml'
check "문서만 바뀜: 배포 없음" "$none" 'docs/setup/x.md
README.md'
check "계약은 둘 다" "$B" 'contracts/openapi.yaml'
check "서버+웹 → 서버 먼저(기본)" "$B" 'server/app/A.kt
web/src/B.ts'
check "라벨이 있으면 웹 먼저" 'server=true web=true order=web-first' 'server/app/A.kt
web/src/B.ts' PR_LABELS='bug
deploy:web-first'
check "쉼표 구분 라벨" 'server=true web=true order=web-first' 'server/app/A.kt
web/src/B.ts' PR_LABELS='bug, deploy:web-first'
check "비슷한 라벨은 무시" "$B" 'server/app/A.kt
web/src/B.ts' PR_LABELS='deploy:web-first-not,web-first'
check "웹 되돌리기 스크립트 변경은 웹만(web/*)" "$W" 'web/scripts/worker-version.sh'
check "한쪽만 바뀌면 라벨이 있어도 그쪽만" 'server=false web=true order=web-first' 'web/src/B.ts' PR_LABELS='deploy:web-first'
check "dev 산출물은 서버+웹" "$B" 'data/artifacts/dev/manifest.json'
check "서버 산출물 발행 스크립트는 서버만" "$S" 'scripts/publish-artifacts.sh'
check "서버 워크플로 변경은 서버만" "$S" '.github/workflows/deploy-server.yml'
check "웹 워크플로 변경은 웹만" "$W" '.github/workflows/deploy-web.yml'
check "오케스트레이터 변경은 배포 없음" "$none" '.github/workflows/deploy.yml
scripts/deploy-plan.sh'
check "빈 입력" "$none" ''
check "수동: 둘 다 + 웹 먼저" 'server=true web=true order=web-first' '' TARGETS=both ORDER=web-first
check "수동: 서버만" 'server=true web=false order=server-first' 'web/x' TARGETS=server
check "수동: 순서 지정은 라벨보다 우선" 'server=true web=true order=server-first' '' TARGETS=both ORDER=server-first PR_LABELS='deploy:web-first'

# 잘못된 값은 실패
if printf '' | TARGETS=nope bash "$plan" >/dev/null 2>&1; then echo "FAIL 잘못된 TARGETS가 통과함"; failed=1; else echo "ok   잘못된 TARGETS는 실패"; fi

exit $failed
