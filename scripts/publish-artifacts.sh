#!/usr/bin/env bash
# 파이프라인 산출물을 GCS 버킷에 발행한다. 입력은 `./gradlew :pipeline:run --args="stage-release build/release"`의 출력 디렉터리.
# 순서: ① 해시 이름 파일(versions/<dataVersion>/…, 불변) 업로드 → ② manifest.json 업로드(마지막, 객체 덮어쓰기는 원자적)
#       → ③ 올라간 manifest 대조 → ④ 최근 N개 버전만 남기고 정리.
# 서버는 시작할 때 manifest.json을 읽고 그 경로의 파일을 검증하므로, manifest가 마지막에 바뀌는 한 중간 상태는 보이지 않는다.
# 사용: bash scripts/publish-artifacts.sh <bucket> [stage_dir=build/release] [keep=10]
# 환경: FORCE=1이면 버킷의 manifest보다 오래된 dataVersion으로도 발행한다(롤백 용도).
set -euo pipefail
cd "$(dirname "$0")/.."

bucket="${1:?usage: publish-artifacts.sh <bucket> [stage_dir] [keep]}"
stage="${2:-build/release}"
keep="${3:-10}"
[[ "$keep" =~ ^[0-9]+$ && "$keep" -ge 2 ]] || { echo "keep은 2 이상의 정수여야 합니다" >&2; exit 2; }
[[ -f "$stage/manifest.json" ]] || { echo "$stage/manifest.json이 없습니다(먼저 stage-release)" >&2; exit 2; }

json_field() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"; }
# YYYYMMDD.N → 비교 가능한 수 (N이 두 자리 이상이어도 맞다)
version_key() { local d="${1%%.*}" n="${1##*.}"; echo $((10#$d * 1000 + 10#$n)); }

version="$(json_field "$stage/manifest.json" dataVersion)"
[[ "$version" =~ ^[0-9]{8}\.[0-9]{1,3}$ ]] || { echo "dataVersion 형식 오류: $version" >&2; exit 2; }
dest="gs://$bucket"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if gcloud storage cat "$dest/manifest.json" > "$tmp/remote.json" 2>/dev/null; then
  remote_version="$(json_field "$tmp/remote.json" dataVersion)"
  if cmp -s "$tmp/remote.json" "$stage/manifest.json"; then
    echo "이미 발행됨: $version (변경 없음)"
    published_same=1
  elif (( $(version_key "$remote_version") > $(version_key "$version") )) && [[ "${FORCE:-}" != 1 ]]; then
    echo "버킷의 dataVersion($remote_version)이 발행하려는 $version보다 새롭습니다. 롤백이면 FORCE=1." >&2
    exit 1
  fi
else
  echo "버킷에 manifest.json이 아직 없습니다(첫 발행)"
fi

if [[ "${published_same:-}" != 1 ]]; then
  echo "① 해시 이름 파일 업로드 (기존 파일은 건너뜀)"
  (cd "$stage" && gcloud storage cp --no-clobber --recursive \
    --cache-control="public, max-age=31536000, immutable" versions "$dest/")
  echo "② manifest.json 업로드(마지막)"
  gcloud storage cp --cache-control="no-cache" "$stage/manifest.json" "$dest/manifest.json"
  echo "③ 대조"
  gcloud storage cat "$dest/manifest.json" | cmp - "$stage/manifest.json"
  expected="$(find "$stage/versions/$version" -type f | wc -l | tr -d ' ')"
  actual="$(gcloud storage ls "$dest/versions/$version/" | grep -c . || true)"
  [[ "$expected" == "$actual" ]] || { echo "버전 디렉터리 파일 수가 다릅니다($expected != $actual)" >&2; exit 1; }
fi

echo "④ 최근 $keep개 버전만 보관"
current_key="$(version_key "$version")"
gcloud storage ls "$dest/versions/" | sed -E 's#.*/versions/([^/]+)/?$#\1#' | grep -E '^[0-9]{8}\.[0-9]{1,3}$' \
  | sort -t. -k1,1n -k2,2n > "$tmp/versions.txt" || true
total="$(grep -c . "$tmp/versions.txt" || true)"
if (( total > keep )); then
  head -n $((total - keep)) "$tmp/versions.txt" | while read -r old; do
    # 방금 발행한(현재 manifest가 가리키는) 버전은 어떤 경우에도 지우지 않는다.
    if (( $(version_key "$old") == current_key )); then continue; fi
    echo "삭제: versions/$old"
    gcloud storage rm --recursive "$dest/versions/$old/"
  done
fi
echo "발행 완료: dataVersion=$version (보관 버전 ${total}개 중 최근 $keep개 유지)"
