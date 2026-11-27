#!/usr/bin/env bash
# 백업을 되살린 새 DB(NEW_DB)를 지금까지 운영한 기존 DB(OLD_DB)와 대조해, 백업 뒤 기존 DB에서 지워진 방과 익명 사용자를 새 DB에서도
# 지운다(docs/setup/p8a-notes.md 3.6절 복원 절차 4(d)). 새 DB는 백업 시점의 행만 가지므로, 새 DB에 있고 기존 DB에 없는 행은 백업 뒤 지워진
# 것(앱의 방 삭제, 만료 정리, 삭제 요청)이다. 방·익명 사용자 삭제는 앱도 행 삭제(참여자는 함께 지워짐)뿐이라 SQL로 똑같이 할 수 있다.
# 참여자만 나간 방(나가기·강퇴)은 앱이 그 방의 우대 대상·사다리 명단도 함께 고치므로 이 스크립트는 지우지 않고 건수만 알린다(그 방은
# 연결 보류·별도 승인, 4(d)). 기존 DB가 그런 삭제의 기록으로 믿을 만할 때만 쓴다(기존 DB가 행을 잃어서 복원하는 경우에는 "없음"이 삭제를
# 뜻하지 않는다).
#
# 사용: OLD_DB='<기존 DB libpq 연결 문자열>' NEW_DB='<새 DB 연결 문자열>' bash scripts/db-restore-reconcile.sh [--apply]
#   비밀번호는 연결 문자열에 넣지 말고 ~/.pgpass(PGPASSFILE)로 준다. 기존 DB는 읽기만 한다.
#   기본은 건수만 보고 새 DB를 바꾸지 않는다(한 트랜잭션을 ROLLBACK). --apply면 같은 트랜잭션에서 지우고 COMMIT한다.
#   --apply는 NEW_DB에 복원 대상 표시(COMMENT ON DATABASE ... IS 'banbanyeok-restore-target')가 있고 OLD_DB에는 없을 때만 한다.
#   두 변수를 바꿔 넣어 운영 DB에서 지우는 실수를 막는다. 표시는 마지막 대조 뒤, 전환 전에 지운다(p8a 3.6절 4(e)).
#   또 OLD_DB의 마지막 방 활동이 NEW_DB보다 늦어야 하고(백업 뒤에도 운영된 DB), 지울 방이 새 DB 방의 절반 이하여야 한다. 둘 다 잘못 고른
#   OLD_DB를 거르는 점검일 뿐 증명이 아니다. OLD_DB가 지금 트래픽을 받는 DB(저장소 변수 DATABASE_URL)인지는 운영자가 확인한다.
#   출력은 건수뿐이다(ID·이름 등 값은 출력하지 않는다).
set -euo pipefail

apply=false
case "${1:-}" in
  --apply) apply=true ;;
  "") ;;
  *) echo "usage: OLD_DB=... NEW_DB=... db-restore-reconcile.sh [--apply]" >&2; exit 2 ;;
esac
: "${OLD_DB:?OLD_DB(기존 DB 연결 문자열)가 필요합니다}"
: "${NEW_DB:?NEW_DB(새 DB 연결 문자열)가 필요합니다}"
psql_bin="${PSQL:-psql}"

marker='banbanyeok-restore-target'
db_comment() {
  "$psql_bin" "$1" -X -q -At -v ON_ERROR_STOP=1 \
    -c "SELECT coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = current_database()"
}
new_comment="$(db_comment "$NEW_DB")"
old_comment="$(db_comment "$OLD_DB")"
if [[ "$new_comment" != "$marker" || "$old_comment" == "$marker" ]]; then
  if $apply; then
    echo "NEW_DB에 복원 대상 표시가 없거나 OLD_DB에 표시가 있습니다. 두 연결이 바뀌지 않았는지 확인하세요. --apply를 거부합니다." >&2
    exit 1
  fi
  echo "주의: NEW_DB에 복원 대상 표시가 없거나 OLD_DB에 있습니다(--apply는 거부됩니다)." >&2
fi

work="$(mktemp -d)"
chmod 700 "$work"
trap 'rm -rf "$work"' EXIT

# 기존 DB의 키를 먼저 파일로 받는다. 읽기가 중간에 실패하면 여기서 멈추므로, 일부만 받은 목록으로 지우는 일이 없다.
export_keys() {
  "$psql_bin" "$OLD_DB" -X -q -v ON_ERROR_STOP=1 -c "COPY ($1) TO STDOUT" > "$work/$2"
}
export_keys "SELECT id, last_activity_at FROM rooms" rooms
export_keys "SELECT room_id, pid FROM participants" participants
export_keys "SELECT id FROM anon_users" anon_users
if [[ ! -s "$work/rooms" ]] && $apply; then
  echo "기존 DB에서 방을 하나도 읽지 못했습니다. 연결을 확인하세요. --apply를 거부합니다." >&2
  exit 1
fi

{
  echo 'BEGIN;'
  echo 'CREATE TEMP TABLE old_rooms (id text PRIMARY KEY, last_activity_at timestamptz NOT NULL) ON COMMIT DROP;'
  echo 'CREATE TEMP TABLE old_participants (room_id text, pid text, PRIMARY KEY (room_id, pid)) ON COMMIT DROP;'
  echo 'CREATE TEMP TABLE old_anon_users (id text PRIMARY KEY) ON COMMIT DROP;'
  for table in rooms participants anon_users; do
    echo "COPY old_$table FROM STDIN;"
    cat "$work/$table"
    echo '\.'
  done
  cat <<'SQL'
SELECT 'rooms_deleted_since_backup', count(*) FROM rooms r WHERE NOT EXISTS (SELECT 1 FROM old_rooms o WHERE o.id = r.id);
SELECT 'rooms_with_participants_removed_since_backup', count(DISTINCT p.room_id) FROM participants p
 WHERE EXISTS (SELECT 1 FROM old_rooms o WHERE o.id = p.room_id)
   AND NOT EXISTS (SELECT 1 FROM old_participants o WHERE o.room_id = p.room_id AND o.pid = p.pid);
SELECT 'anon_users_deleted_since_backup', count(*) FROM anon_users a WHERE NOT EXISTS (SELECT 1 FROM old_anon_users o WHERE o.id = a.id);
SELECT 'rooms_only_in_old_db', count(*) FROM old_rooms o WHERE NOT EXISTS (SELECT 1 FROM rooms r WHERE r.id = o.id);
SQL
  if $apply; then
    cat <<'SQL'
DO $$
BEGIN
    IF (SELECT max(last_activity_at) FROM rooms) >= (SELECT max(last_activity_at) FROM old_rooms) THEN
        RAISE EXCEPTION 'refusing --apply: OLD_DB shows no room activity after the restored data';
    END IF;
    IF 2 * (SELECT count(*) FROM rooms r WHERE NOT EXISTS (SELECT 1 FROM old_rooms o WHERE o.id = r.id))
       > (SELECT count(*) FROM rooms) THEN
        RAISE EXCEPTION 'refusing --apply: it would delete more than half of the restored rooms';
    END IF;
END;
$$;
DELETE FROM rooms r WHERE NOT EXISTS (SELECT 1 FROM old_rooms o WHERE o.id = r.id);
DELETE FROM anon_users a WHERE NOT EXISTS (SELECT 1 FROM old_anon_users o WHERE o.id = a.id);
COMMIT;
SQL
  else
    echo 'ROLLBACK;'
  fi
} | "$psql_bin" "$NEW_DB" -X -q -At -F ' ' -v ON_ERROR_STOP=1

if $apply; then
  echo "새 DB에 반영했습니다. 다시 실행해 deleted_since_backup 건수가 모두 0인지 보고, rooms_with_participants_removed_since_backup이 0이 아니면 그 방은 4(d)대로 연결을 보류합니다."
else
  echo "건수만 확인했습니다(새 DB는 바뀌지 않았습니다). 반영하려면 --apply."
fi
