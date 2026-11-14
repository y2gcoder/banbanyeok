#!/usr/bin/env bash
# Cloud Monitoring 알림 정책: Scheduler가 실행하는 Cloud Run Job(cleanup, db-backup)의 실행 실패와 Scheduler 호출 실패를 이메일로 알린다.
# bootstrap.sh와 따로 둔 이유: 모니터링은 REST(curl)로 호출해야 하고(gcloud monitoring은 beta 구성요소), bootstrap은 gcloud만 쓰는
# 인프라 골격이라 섞지 않는다. 멱등: 같은 표시 이름의 정책이 있으면 건너뛴다. 이메일 채널은 표시 이름으로 찾는다(주소는 저장소에 없다).
#   bash infra/gcp/monitoring-jobs.sh            # 실행 (프로젝트 owner)
#   DRY_RUN=1 bash infra/gcp/monitoring-jobs.sh  # 만들 정책 JSON만 출력
# 정책 둘(같은 이메일 채널):
#  ① "작업 실행 실패": run.googleapis.com/job/completed_execution_count 중 result=failed 인 실행이 5분 구간에 1건 이상(Job별 그룹).
#  ② "Scheduler 호출 실패": cloud_scheduler_job 로그에 ERROR 이상이 있으면(로그 기반. 이 프로젝트에는 Scheduler 지표 설명자가 없어
#     지표 대신 로그를 쓴다). Job이 아예 시작되지 못한 경우를 잡는다.
# 한계: 주 1회 Job이 "아예 안 돈" 경우는 지표 부재 조건의 최대 기간(약 1일)을 넘어 잡지 못한다 → 운영 점검(p8a-notes 3.6).
set -euo pipefail

PROJECT="${PROJECT_ID:-banbanyeok-7eoxn}"
CHANNEL_NAME="${ALERT_CHANNEL_NAME:-운영자 메일}"
DRY_RUN="${DRY_RUN:-0}"

for tool in curl python3; do command -v "$tool" >/dev/null || { echo "$tool 이(가) 필요합니다" >&2; exit 1; }; done
token="$(gcloud auth print-access-token)"
api="https://monitoring.googleapis.com/v3/projects/${PROJECT}"
call() { curl -sS --fail-with-body -H "Authorization: Bearer ${token}" -H "x-goog-user-project: ${PROJECT}" -H 'Content-Type: application/json' "$@"; }

channel="$(call "${api}/notificationChannels" | python3 -I -c '
import json, sys
name = sys.argv[1]
hits = [c["name"] for c in json.load(sys.stdin).get("notificationChannels", []) if c.get("displayName") == name and c.get("type") == "email"]
print(hits[0] if hits else "")' "$CHANNEL_NAME")"
[[ -n "$channel" ]] || { echo "이메일 알림 채널 '$CHANNEL_NAME'을 찾지 못했습니다" >&2; exit 1; }

# 멱등: 같은 표시 이름의 정책이 있으면 건너뛴다.
existing_names="$(call "${api}/alertPolicies" | python3 -I -c '
import json, sys
print("\n".join(p.get("displayName", "") for p in json.load(sys.stdin).get("alertPolicies", [])))')"

policies="$(python3 -I - "$channel" <<'PY'
import json, sys
channel = sys.argv[1]
doc = (
    "Cloud Run Job(cleanup 또는 db-backup) 실행이 실패했거나 Scheduler가 Job을 부르지 못했습니다.\n\n"
    "- 실행 목록: `gcloud run jobs executions list --job=<이름> --region=asia-northeast3`\n"
    "- 로그: Cloud Logging의 `resource.type=\"cloud_run_job\"` 또는 `cloud_scheduler_job`\n"
    "- 백업이면 최신 파일 확인: `gcloud storage ls -l gs://banbanyeok-7eoxn-backups/db/`\n"
    "- 절차: docs/setup/p8a-notes.md 3.5·3.6절"
)
documentation = {"mimeType": "text/markdown", "content": doc}
base = {"combiner": "OR", "enabled": True, "notificationChannels": [channel], "documentation": documentation}
jobs = {
    **base,
    "displayName": "반반역 작업 실행 실패(cleanup·db-backup)",
    "alertStrategy": {"autoClose": "86400s"},
    "conditions": [{
        "displayName": "Cloud Run Job 실행 실패",
        "conditionThreshold": {
            "filter": 'metric.type="run.googleapis.com/job/completed_execution_count" '
            'AND resource.type="cloud_run_job" AND metric.label.result="failed" '
            'AND resource.label.job_name=one_of("cleanup","db-backup")',
            "comparison": "COMPARISON_GT",
            "thresholdValue": 0,
            "duration": "0s",
            "aggregations": [{"alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_SUM", "crossSeriesReducer": "REDUCE_SUM",
                              "groupByFields": ["resource.label.job_name"]}],
            "trigger": {"count": 1},
        },
    }],
}
scheduler = {
    **base,
    "displayName": "반반역 Scheduler 호출 실패(cleanup-daily·db-backup-weekly)",
    "alertStrategy": {"notificationRateLimit": {"period": "3600s"}, "autoClose": "86400s"},
    "conditions": [{
        "displayName": "Scheduler 로그 ERROR",
        "conditionMatchedLog": {
            "filter": 'resource.type="cloud_scheduler_job" AND severity>=ERROR '
            'AND resource.labels.job_id=("cleanup-daily" OR "db-backup-weekly")',
        },
    }],
}
print(json.dumps([jobs, scheduler], ensure_ascii=False))
PY
)"

if [[ "$DRY_RUN" == 1 ]]; then
  echo "$policies" | python3 -I -m json.tool --no-ensure-ascii
  exit 0
fi
count="$(python3 -I -c 'import json,sys; print(len(json.loads(sys.argv[1])))' "$policies")"
for i in $(seq 0 $((count - 1))); do
  name="$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])[int(sys.argv[2])]["displayName"])' "$policies" "$i")"
  if grep -qxF "$name" <<<"$existing_names"; then
    echo "이미 있음: $name (건너뜀)"
    continue
  fi
  body="$(python3 -I -c 'import json,sys; print(json.dumps(json.loads(sys.argv[1])[int(sys.argv[2])], ensure_ascii=False))' "$policies" "$i")"
  call -X POST "${api}/alertPolicies" -d "$body" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print("만듦:", d.get("displayName"), d["name"].split("/")[-1])'
done
