#!/usr/bin/env bash
# 파이프라인 산출물을 GCS 버킷에 발행한다. 입력은 `./gradlew :pipeline:run --args="stage-release build/release"`의 출력 디렉터리.
# 순서: ① 해시 이름 파일(versions/<dataVersion>/…, 불변) 업로드 → ② manifest.v4.json(세대 4, 노선 그래프 포함, 있으면)
#       → manifest.v3.json(세대 3, 막차 표 포함, 있으면) → manifest.v2.json(세대 2, 구분 행렬 포함, 있으면) → manifest.json(세대 1, 마지막, 객체 덮어쓰기는 원자적)
#       → ③ 올라간 manifest 대조 → ④ 최근 N개 버전만 남기고 정리.
# 권역 세대(regional/manifest.v5.json, ADR-0008)가 stage에 있으면 ①에서 regional/versions/<dataVersion>/…을 먼저, 세대별 manifest보다
# 앞서 regional/manifest.v5.json을 올리고 ③·④도 같이 한다. REGIONAL_ARTIFACTS=true 서버만 이 포인터를 읽는다. stage에 없으면
# 버킷의 권역 파일은 건드리지 않는다(되돌릴 때 아직 트래픽을 받는 권역 리비전이 새 인스턴스를 띄워도 기동하게).
# 서버는 시작할 때 자기가 아는 가장 높은 세대의 manifest부터 읽고 그 경로의 파일을 검증하므로, manifest.json이 마지막에
# 바뀌는 한 중간 상태는 보이지 않는다(높은 세대는 manifest.json과 dataVersion이 같을 때만 쓰인다). 아래 세대를 늘 함께 올려
# 새 세대를 모르는 옛 리비전도 계속 기동한다(배포 틈·되돌리기, t2-notes 8절).
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

# 높은 세대 manifest(v4, v3, v2). 있으면 올리고, 없으면(옛 세대 데이터로 되돌리기) 버킷에 남은 것을 지운다.
newer=(manifest.v4.json manifest.v3.json manifest.v2.json)
regional=regional/manifest.v5.json

newer_same() {
  local name
  for name in "${newer[@]}"; do
    [[ ! -f "$stage/$name" ]] && continue
    gcloud storage cat "$dest/$name" 2>/dev/null | cmp -s - "$stage/$name" || return 1
  done
  if [[ -f "$stage/$regional" ]]; then
    gcloud storage cat "$dest/$regional" 2>/dev/null | cmp -s - "$stage/$regional" || return 1
  fi
  return 0
}

if gcloud storage cat "$dest/manifest.json" > "$tmp/remote.json" 2>/dev/null; then
  remote_version="$(json_field "$tmp/remote.json" dataVersion)"
  if cmp -s "$tmp/remote.json" "$stage/manifest.json" && newer_same; then
    echo "이미 발행됨: $version (변경 없음)"
    published_same=1
  elif (( $(version_key "$remote_version") > $(version_key "$version") )) && [[ "${FORCE:-}" != 1 ]]; then
    echo "버킷의 dataVersion($remote_version)이 발행하려는 ${version}보다 새롭습니다. 롤백이면 FORCE=1." >&2
    exit 1
  fi
else
  echo "버킷에 manifest.json이 아직 없습니다(첫 발행)"
fi

if [[ "${published_same:-}" != 1 ]]; then
  echo "① 해시 이름 파일 업로드 (기존 파일은 건너뜀)"
  (cd "$stage" && gcloud storage cp --no-clobber --recursive \
    --cache-control="public, max-age=31536000, immutable" versions "$dest/")
  if [[ -f "$stage/$regional" ]]; then
    echo "① 권역 해시 이름 파일 업로드 (기존 파일은 건너뜀)"
    (cd "$stage/regional" && gcloud storage cp --no-clobber --recursive \
      --cache-control="public, max-age=31536000, immutable" versions "$dest/regional/")
    echo "② $regional 업로드"
    gcloud storage cp --cache-control="no-cache" "$stage/$regional" "$dest/$regional"
  fi
  for name in "${newer[@]}"; do
    if [[ -f "$stage/$name" ]]; then
      echo "② $name 업로드"
      gcloud storage cp --cache-control="no-cache" "$stage/$name" "$dest/$name"
    else
      # 그 세대가 없는 데이터(옛 세대로 되돌리기)면 남은 것을 지운다. 서버도 dataVersion이 다른 높은 세대는 쓰지 않는다.
      gcloud storage rm "$dest/$name" 2>/dev/null || true
    fi
  done
  echo "② manifest.json 업로드(세대 1, 마지막)"
  gcloud storage cp --cache-control="no-cache" "$stage/manifest.json" "$dest/manifest.json"
  echo "③ 대조"
  gcloud storage cat "$dest/manifest.json" | cmp - "$stage/manifest.json"
  for name in "${newer[@]}"; do
    if [[ -f "$stage/$name" ]]; then
      gcloud storage cat "$dest/$name" | cmp - "$stage/$name"
    fi
  done
  expected="$(find "$stage/versions/$version" -type f | wc -l | tr -d ' ')"
  actual="$(gcloud storage ls "$dest/versions/$version/" | grep -c . || true)"
  [[ "$expected" == "$actual" ]] || { echo "버전 디렉터리 파일 수가 다릅니다($expected != $actual)" >&2; exit 1; }
  if [[ -f "$stage/$regional" ]]; then
    gcloud storage cat "$dest/$regional" | cmp - "$stage/$regional"
    expected="$(find "$stage/regional/versions/$version" -type f | wc -l | tr -d ' ')"
    actual="$(gcloud storage ls "$dest/regional/versions/$version/" | grep -c . || true)"
    [[ "$expected" == "$actual" ]] || { echo "권역 버전 디렉터리 파일 수가 다릅니다($expected != $actual)" >&2; exit 1; }
  fi
fi

echo "④ 최근 ${keep}개 버전만 보관"
current_key="$(version_key "$version")"
prune() {
  local prefix="$1" list="$tmp/${1//\//_}.txt"
  gcloud storage ls "$dest/$prefix/" 2>/dev/null | sed -E "s#.*/$prefix/([^/]+)/?\$#\\1#" | grep -E '^[0-9]{8}\.[0-9]{1,3}$' \
    | sort -t. -k1,1n -k2,2n > "$list" || true
  total="$(grep -c . "$list" || true)"
  if (( total > keep )); then
    head -n $((total - keep)) "$list" | while read -r old; do
      # 방금 발행한(현재 manifest가 가리키는) 버전은 어떤 경우에도 지우지 않는다.
      if (( $(version_key "$old") == current_key )); then continue; fi
      echo "삭제: $prefix/$old"
      gcloud storage rm --recursive "$dest/$prefix/$old/"
    done
  fi
}
prune versions
kept="$total"
if [[ -f "$stage/$regional" ]]; then prune regional/versions; fi
echo "발행 완료: dataVersion=$version (보관 버전 ${kept}개 중 최근 ${keep}개 유지)"
