#!/usr/bin/env bash
# 읽기 전용 날짜 태그 계획. fetch-depth: 0으로 태그를 받은 저장소에서 실행한다.
# HEAD_SHA(기본 HEAD), RELEASE_TIME(테스트용 Unix 초, 기본 현재 시각).
# 출력: skip, tag, previous. 같은 커밋의 태그가 하나라도 있으면 재실행을 생략한다.
set -euo pipefail
head_sha="$(git rev-parse --verify "${HEAD_SHA:-HEAD}^{commit}")"
if [ -n "$(git tag --points-at "$head_sha")" ]; then
  echo 'skip=true'
  exit 0
fi
day="$(python3 -I - "${RELEASE_TIME:-}" <<'PY'
import datetime, sys, zoneinfo
now = datetime.datetime.fromtimestamp(float(sys.argv[1]), datetime.timezone.utc) if sys.argv[1] else datetime.datetime.now(datetime.timezone.utc)
print(now.astimezone(zoneinfo.ZoneInfo('Asia/Seoul')).strftime('%Y.%m.%d'))
PY
)"
prefix="v$day"
next=0
while IFS= read -r tag; do
  if [ "$tag" = "$prefix" ]; then
    if [ "$next" -eq 0 ]; then next=1; fi
  elif [[ "$tag" == "$prefix".* && "${tag#"$prefix".}" =~ ^[1-9][0-9]*$ ]]; then
    suffix="${tag##*.}"
    if [ "$suffix" -ge "$next" ]; then next=$((suffix + 1)); fi
  fi
done < <(git tag --list)
tag="$prefix"
if [ "$next" -gt 0 ]; then tag+=".$next"; fi
# 현재 커밋의 이력에 있는 가장 최근 날짜 태그. 다른 브랜치의 태그를 비교 기준으로 삼지 않는다.
previous=''
while IFS= read -r candidate; do
  if [[ "$candidate" =~ ^v[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[1-9][0-9]*)?$ ]]; then
    previous="$candidate"
    break
  fi
done < <(git tag --merged "$head_sha" --sort=-version:refname)
printf 'skip=false\ntag=%s\nprevious=%s\n' "$tag" "$previous"
