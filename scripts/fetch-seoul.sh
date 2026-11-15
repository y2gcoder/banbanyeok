#!/usr/bin/env bash
# 서울 열린데이터광장 S5(서울교통공사 역별 시간표)를 data/raw/seoul/에 이어받기로 캐시하고 S5 영수증을 갱신한다.
# 범위: S3 구간(1~8호선) 역마다 요일 유형 3개(평일·토요일·휴일) × 방향 2개. 키는 1Password(op)에서 실행 시점에만
# 주입된다(.env.tpl의 SEOUL_OPENAPI_KEY). 한도에 닿으면 종료코드 2로 멈추고, 같은 명령을 다시 실행하면 받은 쪽은 건너뛴다.
# 받은 뒤 배차 재계산(키 불필요): ./gradlew :pipeline:run --args=headways. 사용: bash scripts/fetch-seoul.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v op >/dev/null 2>&1; then
  echo "오류: 1Password CLI(op)가 필요합니다(README의 '비밀값')." >&2
  exit 1
fi
if [[ ! -f data/raw/kric.xlsx ]]; then
  echo "data/raw가 없어 공개 원본을 먼저 받습니다(fetch, 키 불필요)."
  ./gradlew :pipeline:run --args=fetch --console=plain -q
fi
op run --env-file=.env.tpl -- ./gradlew :pipeline:run --args=seoul-fetch --console=plain
