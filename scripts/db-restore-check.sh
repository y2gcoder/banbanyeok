#!/usr/bin/env bash
# 백업 덤프가 실제로 복원되는지 임시 로컬 Postgres 17에 복원해 확인한다(운영 DB는 건드리지 않는다).
# 사용: bash scripts/db-restore-check.sh <덤프 파일>
# 확인: 테이블 존재, 행 수(값은 출력하지 않는다), Liquibase 이력(changeset 수). 끝나면 임시 컨테이너를 지운다.
set -euo pipefail

dump="${1:?usage: db-restore-check.sh <덤프 파일>}"
[[ -s "$dump" ]] || { echo "덤프 파일이 없거나 비어 있습니다: $dump" >&2; exit 2; }
image="${PG_IMAGE:-postgres:17.6}"
dumpdir="$(cd "$(dirname "$dump")" && pwd)"
name="$(basename "$dump")"
container="bby-restore-check-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$container" -e POSTGRES_PASSWORD=restore-check-only -e POSTGRES_DB=restore \
  -v "$dumpdir:/backup:ro" "$image" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$container" pg_isready -U postgres -d restore >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d restore >/dev/null

# 덤프는 `CREATE SCHEMA public`을 담고 있어서 빈 public을 먼저 지운다(새 DB의 기본 public은 비어 있다).
# 소유자·권한 없이 복원한다.
docker exec "$container" psql -U postgres -d restore -q -c 'DROP SCHEMA public'
docker exec "$container" pg_restore --no-owner --no-privileges --exit-on-error -U postgres -d restore "/backup/$name"
echo "복원 완료. 확인:"
docker exec "$container" psql -U postgres -d restore -At -F ' ' -c \
  "SELECT 'anon_users', count(*) FROM anon_users
   UNION ALL SELECT 'rooms', count(*) FROM rooms
   UNION ALL SELECT 'participants', count(*) FROM participants
   UNION ALL SELECT 'liquibase_changesets', count(*) FROM databasechangelog" | sed 's/^/  /'
docker exec "$container" psql -U postgres -d restore -At -c \
  "SELECT 'trigger participants_limit: ' || count(*) FROM pg_trigger WHERE tgname = 'participants_limit'" | sed 's/^/  /'
echo "검증 통과"
