#!/usr/bin/env bash
# 운영 DB를 pg_dump(Postgres 17 클라이언트, 커스텀 형식, public 스키마만)로 파일 하나에 덤프하고 목차를 검증한다.
# 사용: bash scripts/db-backup.sh <출력 파일>
# 환경: DATABASE_URL(jdbc:postgresql://host:port/db?sslmode=require), DATABASE_USER, PGPASSWORD.
#   비밀번호는 환경 변수로만 받는다(명령행·로그에 나오지 않는다). 이 스크립트는 값을 출력하지 않는다.
#   PG_DOCKER_NETWORK: 로컬 검증용(compose 네트워크 이름). PG_IMAGE: 클라이언트 이미지(기본 postgres:17.6).
#   PG_LOCAL=1: docker 대신 이 환경의 pg_dump·pg_restore(17)를 쓴다(Cloud Run Job 이미지 안에서 실행할 때).
# 개인정보(출발역·이름)가 들어 있으므로 파일은 비공개 버킷에만 둔다(docs/setup/p8a-notes.md).
set -euo pipefail

out="${1:?usage: db-backup.sh <출력 파일>}"
: "${DATABASE_URL:?DATABASE_URL이 필요합니다}" "${DATABASE_USER:?DATABASE_USER가 필요합니다}"
[[ -n "${PGPASSWORD:-}" ]] || { echo "PGPASSWORD가 필요합니다(값은 출력하지 않습니다)" >&2; exit 2; }
image="${PG_IMAGE:-postgres:17.6}"

# jdbc:postgresql://host:port/db?query → 호스트·포트·DB·sslmode
rest="${DATABASE_URL#jdbc:postgresql://}"
[[ "$rest" != "$DATABASE_URL" ]] || { echo "DATABASE_URL은 jdbc:postgresql:// 로 시작해야 합니다" >&2; exit 2; }
hostport="${rest%%/*}"
dbq="${rest#*/}"
host="${hostport%%:*}"
port="${hostport#*:}"; [[ "$port" != "$hostport" ]] || port=5432
db="${dbq%%\?*}"
sslmode="require"
if [[ "$dbq" == *\?* ]]; then
  for kv in $(tr '&' ' ' <<<"${dbq#*\?}"); do [[ "$kv" == sslmode=* ]] && sslmode="${kv#sslmode=}"; done
fi

mkdir -p "$(dirname "$out")"
outdir="$(cd "$(dirname "$out")" && pwd)"
name="$(basename "$out")"

if [[ "${PG_LOCAL:-}" == 1 ]]; then
  export PGHOST="$host" PGPORT="$port" PGDATABASE="$db" PGUSER="$DATABASE_USER" PGSSLMODE="$sslmode"
  run_dump() { pg_dump "$@"; }
  run_restore_list() { pg_restore --list "$outdir/$name"; }
  dump_target="$outdir/$name"
else
  network=()
  [[ -z "${PG_DOCKER_NETWORK:-}" ]] || network=(--network "$PG_DOCKER_NETWORK")
  common=(--rm --user "$(id -u):$(id -g)" "${network[@]}"
    -e PGPASSWORD -e PGHOST="$host" -e PGPORT="$port" -e PGDATABASE="$db" -e PGUSER="$DATABASE_USER" -e PGSSLMODE="$sslmode"
    -v "$outdir:/backup")
  run_dump() { docker run "${common[@]}" "$image" pg_dump "$@"; }
  run_restore_list() {
    docker run --rm --user "$(id -u):$(id -g)" -v "$outdir:/backup" "$image" pg_restore --list "/backup/$name"
  }
  dump_target="/backup/$name"
fi

echo "pg_dump 시작: ${host}:${port}/${db} (스키마 public, 형식 custom)"
run_dump --format=custom --compress=6 --no-owner --no-privileges --schema=public --file="$dump_target"
size="$(wc -c < "$out" | tr -d ' ')"
echo "덤프 완료: ${size} bytes"

# 목차 검증: 서비스 테이블과 마이그레이션 이력 테이블이 있어야 한다.
toc="$(run_restore_list)"
for table in anon_users rooms participants databasechangelog; do
  grep -Eq "TABLE public $table " <<<"$toc" || { echo "덤프 목차에 $table 테이블이 없습니다" >&2; exit 1; }
done
echo "목차 검증 통과: 테이블 4개 확인, 항목 $(grep -vc '^;' <<<"$toc")개"
