#!/usr/bin/env bash
# scripts/publish-artifacts.sh를 가짜 gcloud(로컬 폴더를 버킷으로 쓴다)로 확인한다. 실제 GCS·인증은 쓰지 않는다.
# 수도권만 발행, 권역 세대 함께 발행, 같은 내용 재발행, 권역 포인터만 바뀐 재발행, 권역 없는 다음 발행(버킷의 권역은 그대로),
# 권역 버전 보관 개수 정리를 본다.
set -euo pipefail
cd "$(dirname "$0")/.."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
bucket_dir="$work/bucket"
mkdir -p "$bucket_dir" "$work/bin"

cat > "$work/bin/gcloud" <<'FAKE'
#!/usr/bin/env bash
# gcloud storage {cat,cp,ls,rm}의 이 스크립트가 쓰는 형태만 흉내 낸다. gs://test/<key> → $BUCKET_DIR/<key>.
set -euo pipefail
[[ "$1" == storage ]] || { echo "fake gcloud: $*" >&2; exit 2; }
shift
command="$1"
shift
args=()
for arg in "$@"; do [[ "$arg" == --* ]] || args+=("$arg"); done
local_path() { echo "$BUCKET_DIR/${1#gs://test/}"; }
case "$command" in
  cat) cat "$(local_path "${args[0]}")" ;;
  cp)
    target="$(local_path "${args[${#args[@]}-1]}")"
    if [[ " $* " == *" --recursive "* ]]; then
      mkdir -p "$target"
      if [[ " $* " == *" --no-clobber "* ]]; then cp -R -n "${args[0]}" "$target" 2>/dev/null || true; else cp -R "${args[0]}" "$target"; fi
    else
      mkdir -p "$(dirname "$target")"
      cp "${args[0]}" "$target"
    fi
    ;;
  ls)
    dir="$(local_path "${args[0]}")"
    [[ -d "$dir" ]] || exit 1
    for entry in "$dir"/*; do
      [[ -e "$entry" ]] || continue
      name="${args[0]%/}/$(basename "$entry")"
      if [[ -d "$entry" ]]; then echo "$name/"; else echo "$name"; fi
    done
    ;;
  rm) rm -rf "$(local_path "${args[0]}")" ;;
  *) echo "fake gcloud: storage $command" >&2; exit 2 ;;
esac
FAKE
chmod +x "$work/bin/gcloud"
export PATH="$work/bin:$PATH" BUCKET_DIR="$bucket_dir"

# 발행 형식 stage 하나: manifest.json + versions/<v>/od.<v>.bin, regional이면 regional/manifest.v5.json + regional/versions/<v>/od.<v>.bin.
stage() {
  local dir="$work/stage-$1-$2" version="$1" regional="$2" pointer="${3:-}"
  mkdir -p "$dir/versions/$version"
  echo "od $version" > "$dir/versions/$version/od.$version.bin"
  printf '{"dataVersion": "%s"}\n' "$version" > "$dir/manifest.json"
  if [[ "$regional" == yes ]]; then
    mkdir -p "$dir/regional/versions/$version"
    echo "regional od $version" > "$dir/regional/versions/$version/od.$version.bin"
    printf '{"dataVersion": "%s", "schemaVersion": 5%s}\n' "$version" "$pointer" > "$dir/regional/manifest.v5.json"
  fi
  echo "$dir"
}

fail() { echo "FAIL $*" >&2; exit 1; }
publish() { bash scripts/publish-artifacts.sh test "$1" 2 2>&1 || { echo "publish failed" >&2; return 1; }; }

out="$(publish "$(stage 20261101.1 no)")"
[[ -f "$bucket_dir/manifest.json" && ! -e "$bucket_dir/regional" ]] || fail "수도권만: 권역 파일이 생겼다"
echo "ok 수도권만 발행하면 버킷에 권역 파일이 없다"

out="$(publish "$(stage 20261102.1 yes)")"
cmp -s "$bucket_dir/regional/manifest.v5.json" "$work/stage-20261102.1-yes/regional/manifest.v5.json" || fail "권역 포인터가 없다"
[[ -f "$bucket_dir/regional/versions/20261102.1/od.20261102.1.bin" ]] || fail "권역 파일이 없다"
echo "ok 권역 세대를 함께 발행한다"

out="$(publish "$work/stage-20261102.1-yes")"
[[ "$out" == *"이미 발행됨"* ]] || fail "같은 내용 재발행이 다시 올렸다: $out"
echo "ok 같은 내용이면 다시 올리지 않는다"

out="$(publish "$(stage 20261102.1 yes ', "note": 1')")"
[[ "$out" != *"이미 발행됨"* ]] || fail "권역 포인터만 바뀐 재발행을 건너뛰었다"
grep -q note "$bucket_dir/regional/manifest.v5.json" || fail "바뀐 권역 포인터가 올라가지 않았다"
echo "ok 권역 포인터만 바뀌어도 다시 올린다"

# 부산만 다시 만든 세대: 수도권 파일은 같고 권역 파일은 새 해시 이름 하나뿐이다(옛 이름은 stage에 없다).
rebuilt="$work/stage-rebuilt"
mkdir -p "$rebuilt/versions/20261102.1" "$rebuilt/regional/versions/20261102.1"
cp "$work/stage-20261102.1-yes/versions/20261102.1/od.20261102.1.bin" "$rebuilt/versions/20261102.1/"
cp "$work/stage-20261102.1-yes/manifest.json" "$rebuilt/manifest.json"
echo "regional od rebuilt" > "$rebuilt/regional/versions/20261102.1/od.rebuilt.bin"
printf '{"dataVersion": "20261102.1", "schemaVersion": 5, "rebuilt": 1}\n' > "$rebuilt/regional/manifest.v5.json"
out="$(publish "$rebuilt")"
[[ -f "$bucket_dir/regional/versions/20261102.1/od.rebuilt.bin" ]] || fail "같은 버전의 새 권역 파일이 올라가지 않았다: $out"
grep -q rebuilt "$bucket_dir/regional/manifest.v5.json" || fail "같은 버전으로 다시 만든 권역 포인터가 올라가지 않았다"
echo "ok 부산만 다시 만든 같은 버전의 권역 세대도 발행한다(옛 해시 파일이 함께 있어도)"

before="$(cat "$bucket_dir/regional/manifest.v5.json")"
out="$(publish "$(stage 20261103.1 no)")"
[[ "$(cat "$bucket_dir/regional/manifest.v5.json")" == "$before" ]] || fail "권역 없는 발행이 버킷의 권역 포인터를 바꿨다"
echo "ok 권역 없는 다음 발행은 버킷의 권역 파일을 건드리지 않는다"

publish "$(stage 20261104.1 yes)" > /dev/null
publish "$(stage 20261105.1 yes)" > /dev/null
regional_versions="$(find "$bucket_dir/regional/versions" -mindepth 1 -maxdepth 1 -exec basename {} \; | sort | tr '\n' ' ')"
[[ "$regional_versions" == "20261104.1 20261105.1 " ]] || fail "권역 버전 정리: $regional_versions"
capital_versions="$(find "$bucket_dir/versions" -mindepth 1 -maxdepth 1 -exec basename {} \; | sort | tr '\n' ' ')"
[[ "$capital_versions" == "20261104.1 20261105.1 " ]] || fail "수도권 버전 정리: $capital_versions"
echo "ok 권역 버전도 최근 N개만 남긴다"
