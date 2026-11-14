#!/usr/bin/env bash
# TAGO 지하철정보(수도권 범위) 원시 응답을 data/raw/tago/에 이어받기로 캐시하고 S6 영수증을 갱신한다.
# 키는 1Password(op)에서 실행 시점에만 주입된다(.env.tpl의 TAGO_SERVICE_KEY). 키가 필요한 명령은 이것뿐이며
# build/validate/all은 캐시만 읽는다. 하루 호출 한도(개발계정 약 10,000건)에 닿으면 종료코드 2로 멈추고,
# 같은 명령을 다시 실행하면 받은 쪽은 건너뛴다. 사용: bash scripts/fetch-tago.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v op >/dev/null 2>&1; then
  echo "오류: 1Password CLI(op)가 필요합니다(README의 '비밀값')." >&2
  exit 1
fi
op run --env-file=.env.tpl -- ./gradlew :pipeline:run --args=tago-fetch --console=plain
