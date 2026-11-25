#!/usr/bin/env bash
# 수도권은 data/raw/tago/와 S6, 부산권은 data/raw/tago-busan/과 S6-busan을 쓴다.
# 키는 1Password(op)에서 실행 시점에만 주입된다(.env.tpl의 TAGO_SERVICE_KEY). 키가 필요한 명령은 이것뿐이며
# build/validate/all은 캐시만 읽는다. 하루 호출 한도(개발계정 약 10,000건)에 닿으면 멈추고,
# 같은 명령을 다시 실행하면 받은 쪽은 건너뛴다. 사용: bash scripts/fetch-tago.sh [busan]
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v op >/dev/null 2>&1; then
  echo "오류: 1Password CLI(op)가 필요합니다(README의 '비밀값')." >&2
  exit 1
fi
if [[ $# -gt 1 || (${1-} != "" && ${1-} != busan) ]]; then
    echo "사용법: bash scripts/fetch-tago.sh [busan]" >&2
    exit 1
fi
op run --env-file=.env.tpl -- ./gradlew :pipeline:run --args="tago-fetch${1:+ $1}" --console=plain
