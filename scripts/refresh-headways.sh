#!/usr/bin/env bash
# 실제 시간표 기반 배차 간격 갱신: (원본이 없으면 받기) → 서울 열린데이터광장 키로 refresh(build→validate 포함) → 웹 생성물 재생성.
# 키는 1Password(op)에서 실행 시점에만 주입된다(.env.tpl의 op:// 참조). 사용: mise run data:refresh-headways
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v op >/dev/null 2>&1; then
  echo "오류: 1Password CLI(op)가 필요합니다. 설치 후 데스크톱 앱 연동을 켜세요(README의 '비밀값')." >&2
  exit 1
fi
if ! op whoami >/dev/null 2>&1; then
  echo "오류: op에 로그인되어 있지 않습니다. 1Password 데스크톱 앱을 잠금 해제하거나 'op signin'을 실행하세요." >&2
  echo "      계정이 여럿이면 mise.local.toml의 OP_ACCOUNT로 개인 계정을 고정합니다(mise.local.toml.example)." >&2
  exit 1
fi

# 새 worktree에는 data/raw(gitignore)가 없어 refresh가 원본 검증에서 실패한다. 'all'과 같은 기준으로 먼저 받는다(키 불필요).
if [[ ! -f data/raw/kric.xlsx ]]; then
  echo "data/raw가 없어 원본을 먼저 받습니다(fetch). data/config/source-manifest.json의 수집 기록이 갱신됩니다."
  ./gradlew :pipeline:run --args=fetch --console=plain -q
fi

op run --env-file=.env.tpl -- ./gradlew :pipeline:run --args=refresh --console=plain

if [[ ! -d web/node_modules ]]; then
  echo "web 의존성이 없어 먼저 설치합니다(pnpm install --frozen-lockfile)."
  pnpm install --frozen-lockfile
fi
pnpm --filter web gen
echo "완료. 변경된 data/config·data/artifacts/dev·web 생성물을 검토한 뒤 커밋하세요."
