#!/usr/bin/env bash
# 백업 덤프가 실제로 복원되는지 임시 로컬 Postgres 17에 복원해 확인한다(운영 DB는 건드리지 않는다).
# 사용: bash scripts/db-restore-check.sh <덤프 파일>
# 확인: 테이블·행 수(값은 출력하지 않는다)·Liquibase 이력과 배포와 같은 migrate(status/validate/update).
# ADR-0012 3단계 CHECK는 숨긴 참가자 행을 거절하고, 4단계는 실제 CHECK를 확인한 뒤 열을 지운다.
# update 뒤 카탈로그에서 public.participants 테이블이 있고 hidden 열은 없는지 확인하고 임시 컨테이너를 지운다.
set -euo pipefail

dump="${1:?usage: db-restore-check.sh <덤프 파일>}"
[[ -s "$dump" ]] || { echo "덤프 파일이 없거나 비어 있습니다: $dump" >&2; exit 2; }
image="${PG_IMAGE:-postgres:17.6}"
dumpdir="$(cd "$(dirname "$dump")" && pwd)"
name="$(basename "$dump")"
container="bby-restore-check-$$"
migration_image="bby-restore-migrate:check-$$"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; docker image rm "$migration_image" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$container" -e POSTGRES_PASSWORD=restore-check-only -e POSTGRES_DB=restore \
  -v "$dumpdir:/backup:ro" "$image" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$container" pg_isready -U postgres -d restore >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d restore >/dev/null

# 덤프는 `CREATE SCHEMA public`을 담고 있어서 복원 대상(방금 만든 빈 DB)의 빈 public을 먼저 지운다.
# 소유자·권한 없이, 오류가 나면 즉시 멈추고 한 트랜잭션으로 복원한다(실패하면 아무것도 남지 않는다).
docker exec "$container" psql -U postgres -d restore -q -c 'DROP SCHEMA public'
if ! docker exec "$container" pg_restore --no-owner --no-privileges --exit-on-error --single-transaction \
  -U postgres -d restore "/backup/$name"; then
  echo "복원 실패: 이 덤프를 되살린 DB는 운영에 연결하지 않는다(docs/setup/p8a-notes.md 복원 절차)" >&2
  exit 1
fi
echo "복원 완료. 확인:"
docker exec "$container" psql -U postgres -d restore -At -F ' ' -c \
  "SELECT 'anon_users', count(*) FROM anon_users
   UNION ALL SELECT 'rooms', count(*) FROM rooms
   UNION ALL SELECT 'participants', count(*) FROM participants
   UNION ALL SELECT 'liquibase_changesets', count(*) FROM databasechangelog" | sed 's/^/  /'
docker exec "$container" psql -U postgres -d restore -At -c \
  "SELECT 'trigger participants_limit: ' || count(*) FROM pg_trigger WHERE tgname = 'participants_limit'" | sed 's/^/  /'
# 운영·compose와 같은 Liquibase 5.0.4 + PostgreSQL JDBC 이미지로 복원 이력을 검증한다.
docker build -q -f "$repo_root/server/db/Dockerfile" -t "$migration_image" "$repo_root" >/dev/null
for command in status validate update; do
  if ! docker run --rm --network "container:$container" "$migration_image" \
    --search-path=/liquibase/changelog --changelog-file=master.sql \
    --url=jdbc:postgresql://localhost:5432/restore --username=postgres --password=restore-check-only "$command"; then
    echo "migrate $command 실패: 이 덤프를 되살린 DB는 운영에 연결하지 않는다(docs/setup/p8a-notes.md 복원 절차)" >&2
    exit 1
  fi
done
if ! docker exec -i "$container" psql -U postgres -d restore -X -q -v ON_ERROR_STOP=1 < "$repo_root/scripts/db-guard-check.sql"; then
  echo "가드 확인 실패: 이 덤프를 되살린 DB는 운영에 연결하지 않는다(docs/setup/p8a-notes.md 복원 절차)" >&2
  exit 1
fi
echo "검증 통과"
