#!/usr/bin/env bash
# 공개 웹 프록시에서 서버가 실제 읽는 manifest를 조회한다. 실패하면 빈 값(릴리즈 노트에 확인 불가).
# 비밀 없는 읽기 전용 요청. 배포 전후 모두 같은 주소를 쓴다.
set -euo pipefail
if [ -z "${SITE_DOMAIN:-}" ]; then exit 0; fi
if ! [[ "$SITE_DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]]; then exit 0; fi
version="$(curl --fail --silent --show-error --max-time 30 --retry 2 \
  -H 'Cache-Control: no-cache' "https://$SITE_DOMAIN/api/v1/manifest" \
  | jq -er '.dataVersion | strings' 2>/dev/null)" || exit 0
if [[ "$version" =~ ^[0-9]{8}\.[0-9]{1,3}$ ]]; then printf '%s' "$version"; fi
