#!/usr/bin/env bash
# 권역 색인(부산권 공개) 웹 빌드를 Worker로 공개하기 전에 서버가 권역 세대(manifest 5세대)를 실었는지 확인한다(ADR-0008).
# .github/workflows/deploy-web.yml이 wrangler deploy 전에 순서 옵션과 상관없이 부른다.
#   수도권 색인(권역 공개 전, 되돌리기 포함): 확인 없이 통과. 어느 세대의 서버와도 맞는다.
#   권역 색인: SERVER_ORIGIN이 없으면 실패(5세대를 확인할 수 없다), 있으면 <서버>/v1/manifest가 5세대가 될 때까지 기다린다.
#   INDEX(역 색인 경로, 기본 src/lib/stations/index.gen.json), INTERVAL·MAX_WAIT는 wait-data-version.sh에 넘긴다.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
index="${INDEX:-$here/../src/lib/stations/index.gen.json}"
if [[ "$(jq -r 'has("regions")' "$index")" != true ]]; then
  echo "ok   수도권 색인: 권역 서버 선행 확인 없음"
  exit 0
fi
if [[ -z "${SERVER_ORIGIN:-}" ]]; then
  echo "FAIL 권역 색인인데 SERVER_ORIGIN이 없어 서버의 권역 세대를 확인할 수 없습니다. 웹을 공개하지 않습니다."
  exit 1
fi
REGIONAL=true EXPECTED="$(jq -r .dataVersion "$index")" MANIFEST_URL="${SERVER_ORIGIN%/}/v1/manifest" \
  bash "$here/wait-data-version.sh"
