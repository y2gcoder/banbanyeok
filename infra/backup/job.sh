#!/usr/bin/env bash
# Cloud Run Job `db-backup`의 진입점: 운영 DB pg_dump(17) → 로컬 임시 파일 → GCS 백업 버킷 → 올라간 크기 대조.
# 환경(Cloud Run Job이 주입): DATABASE_URL·DATABASE_USER(변수), PGPASSWORD(Secret Manager 참조), BACKUP_BUCKET.
# 비밀번호와 액세스 토큰은 어디에도 출력하지 않는다. 실행 계정(db-backup)은 DB 비밀번호 읽기와 백업 버킷 생성·조회만 가능하다.
# 로컬 검증용: GCS_API_HOST(기본 https://storage.googleapis.com)와 GCS_NO_AUTH=1(에뮬레이터)로 업로드 경로를 시험한다.
set -euo pipefail

: "${BACKUP_BUCKET:?BACKUP_BUCKET이 필요합니다}"
api="${GCS_API_HOST:-https://storage.googleapis.com}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="banbanyeok-${stamp}.dump"
object="db/${name}"
file="/tmp/${name}"
trap 'rm -f "$file"' EXIT

PG_LOCAL=1 bash /app/db-backup.sh "$file"
local_size="$(wc -c < "$file" | tr -d ' ')"

auth=()
if [[ "${GCS_NO_AUTH:-}" != 1 ]]; then
  # 메타데이터 서버의 서비스 계정 토큰(Cloud Run 실행 계정). 값은 변수에만 두고 출력하지 않는다.
  token_json="$(curl -sS -f -H 'Metadata-Flavor: Google' \
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token')"
  token="$(sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p' <<<"$token_json")"
  [[ -n "$token" ]] || { echo "액세스 토큰을 받지 못했습니다" >&2; exit 1; }
  auth=(-H "Authorization: Bearer ${token}")
fi

echo "업로드: gs://${BACKUP_BUCKET}/${object}"
# 이미 같은 이름이 있으면 덮어쓰지 않는다(ifGenerationMatch=0). 이름에 초 단위 시각이 들어가 보통은 겹치지 않는다.
curl -sS -f --max-time 600 -X POST "${auth[@]}" -H 'Content-Type: application/octet-stream' --data-binary "@${file}" \
  "${api}/upload/storage/v1/b/${BACKUP_BUCKET}/o?uploadType=media&ifGenerationMatch=0&name=db%2F${name}" > /dev/null

remote_size="$(curl -sS -f "${auth[@]}" "${api}/storage/v1/b/${BACKUP_BUCKET}/o/db%2F${name}?fields=size" \
  | sed -n 's/.*"size": *"\([0-9]*\)".*/\1/p')"
[[ "$remote_size" == "$local_size" ]] || { echo "업로드 크기가 다릅니다(local=${local_size}, remote=${remote_size:-?})" >&2; exit 1; }
echo "백업 완료: ${object} ${remote_size} bytes"
