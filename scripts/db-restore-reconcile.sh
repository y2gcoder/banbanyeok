#!/usr/bin/env bash
# 백업을 되살린 새 DB(NEW_DB)와 지금까지 운영한 기존 DB(OLD_DB)를 읽기만 해서 견주고, 백업 뒤 기존 DB에서 사라진 행의 건수만 알린다
# (docs/setup/p8a-notes.md 3.6절 복원 절차 4(d)·(e)). 아무것도 지우거나 고치지 않는다. 두 연결 모두 읽기 전용 트랜잭션으로 열고
# SELECT(\copy ... TO)만 한다. 키는 권한 700의 임시 디렉터리에서만 견주고 끝나면 지운다. 출력은 건수뿐이다(ID·이름은 내지 않는다).
#
# 사용: OLD_DB='<기존 DB libpq 연결 문자열>' NEW_DB='<새 DB 연결 문자열>' bash scripts/db-restore-reconcile.sh
#   비밀번호는 연결 문자열에 넣지 말고 ~/.pgpass(PGPASSFILE)로 준다.
# 종료 코드: 0 = 사라진 행 없음, 3 = 사라진 행 있음(후보 공개 보류), 1 = 입력 실패·원본 의심(후보 공개 보류), 2 = 사용법.
#   원본 의심은 점검일 뿐 증명이 아니다: 기존 DB에서 방을 읽지 못했거나, 기존 DB의 마지막 방 활동이 새 DB보다 늦지 않을 때(백업 뒤에도
#   운영된 DB로 보이지 않음, 예: 같은 백업을 또 복원한 DB나 두 연결을 바꿔 넣은 경우). OLD_DB가 지금 트래픽을 받는 DB인지는 운영자가 본다.
set -euo pipefail

[[ $# -eq 0 ]] || { echo "usage: OLD_DB=... NEW_DB=... db-restore-reconcile.sh" >&2; exit 2; }
: "${OLD_DB:?OLD_DB(기존 DB 연결 문자열)가 필요합니다}"
: "${NEW_DB:?NEW_DB(새 DB 연결 문자열)가 필요합니다}"
psql_bin="${PSQL:-psql}"
export PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c default_transaction_read_only=on"

work="$(mktemp -d)"
chmod 700 "$work"
trap 'rm -rf "$work"' EXIT

hold() {
  echo "보류: $1. 후보를 공개하지 않는다(p8a 3.6절 4(d))." >&2
  exit 1
}
# 한 DB의 키를 한 읽기 전용 트랜잭션(같은 스냅숏)에서 정렬해 받는다. 실패하면 그 자리에서 보류로 끝난다.
keys() {
  local db=$1 side=$2
  {
    echo 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'
    echo "\\copy (SELECT id FROM rooms ORDER BY id COLLATE \"C\") TO '$work/$side.rooms'"
    echo "\\copy (SELECT room_id || ' ' || pid AS k FROM participants ORDER BY room_id || ' ' || pid COLLATE \"C\") TO '$work/$side.participants'"
    echo "\\copy (SELECT id FROM anon_users ORDER BY id COLLATE \"C\") TO '$work/$side.anon_users'"
    echo "\\copy (SELECT coalesce(max(last_activity_at)::text, '') FROM rooms) TO '$work/$side.latest'"
    echo 'COMMIT;'
  } | "$psql_bin" "$db" -X -q -v ON_ERROR_STOP=1 > /dev/null || hold "$side DB를 읽지 못했다"
}
keys "$OLD_DB" old
keys "$NEW_DB" new

[[ -s "$work/old.rooms" ]] || hold "기존 DB에서 방을 하나도 읽지 못했다(연결을 확인한다)"
old_latest="$(cat "$work/old.latest")"
new_latest="$(cat "$work/new.latest")"
if [[ -n "$new_latest" ]]; then
  later="$("$psql_bin" "$NEW_DB" -X -q -At -v ON_ERROR_STOP=1 -c "SELECT '$old_latest'::timestamptz > '$new_latest'::timestamptz")" ||
    hold "활동 시각을 견주지 못했다"
  [[ "$later" == "t" ]] || hold "기존 DB의 마지막 방 활동이 새 DB보다 늦지 않다(백업 뒤에도 운영된 DB로 보이지 않는다)"
fi

# 새 DB(백업 시점)에 있고 기존 DB에 없는 행 = 백업 뒤 기존 DB에서 사라진 행. 참여자는 두 DB에 모두 있는 방의 것만 센다(방째 사라진
# 경우는 방에서 센다).
only_new() { LC_ALL=C comm -23 "$work/new.$1" "$work/old.$1"; }
LC_ALL=C comm -12 "$work/new.rooms" "$work/old.rooms" > "$work/both.rooms"
rooms_gone="$(only_new rooms | wc -l | tr -d ' ')"
participant_rooms="$(only_new participants | cut -d ' ' -f 1 | LC_ALL=C sort -u | LC_ALL=C comm -12 - "$work/both.rooms" | wc -l | tr -d ' ')"
anon_gone="$(only_new anon_users | wc -l | tr -d ' ')"
rooms_only_old="$(LC_ALL=C comm -13 "$work/new.rooms" "$work/old.rooms" | wc -l | tr -d ' ')"

echo "rooms_gone_since_backup $rooms_gone"
echo "rooms_with_participants_gone_since_backup $participant_rooms"
echo "anon_users_gone_since_backup $anon_gone"
echo "rooms_only_in_old_db $rooms_only_old"
if (( rooms_gone + participant_rooms + anon_gone > 0 )); then
  echo "보류: 백업 뒤 기존 DB에서 사라진 행이 새 DB에 남아 있다. 확정된 삭제만 승인된 절차로 처리하고 다시 대조한다(p8a 3.6절 4(d))." >&2
  exit 3
fi
echo "사라진 행 없음(rooms_only_in_old_db는 백업 뒤 기존 DB에 생긴 방으로, 이 복원으로는 되살아나지 않는다)."
