#!/usr/bin/env bash
# GCP 부트스트랩(P8a): 서버·DB 배포에 필요한 리소스와 최소 권한을 만든다. 사람(프로젝트 owner)이 한 번 실행한다.
#
#   bash infra/gcp/bootstrap.sh            # 실행
#   DRY_RUN=1 bash infra/gcp/bootstrap.sh  # 쓰기 명령을 실행하지 않고 출력만 한다(읽기 확인은 실제로 한다)
#
# 성질
#  - 멱등: 이미 있으면 건너뛰고(없으면 만들고), 권한 바인딩은 add-iam-policy-binding(이미 있으면 변화 없음)으로 건다.
#  - 비밀값은 다루지 않는다: Secret Manager의 `database-password`, `token-pepper`는 이미 있어야 하며 존재만 확인하고 접근 권한만 준다.
#  - 서비스 계정 키(JSON)를 만들지 않는다. 프로젝트 전체 owner/editor 역할을 주지 않는다. 가능한 한 리소스 단위로 바인딩한다.
#  - 상시 유료 리소스(Cloud SQL, min instances ≥ 1 등)를 만들지 않는다.
# 권한 표와 근거: docs/setup/p8a-notes.md
set -euo pipefail

PROJECT="${PROJECT_ID:-banbanyeok-7eoxn}"
REGION="${REGION:-asia-northeast3}"
DRY_RUN="${DRY_RUN:-0}"

AR_REPO="server"                                  # Artifact Registry docker 저장소 (이미지: server, migrate)
AR_KEEP_RECENT="3"                                # 이미지(패키지)별 최근 N개 유지
ARTIFACT_BUCKET="${GCP_ARTIFACT_BUCKET:-${PROJECT}-artifacts}"
BACKUP_BUCKET="${GCP_BACKUP_BUCKET:-${PROJECT}-backups}"
BACKUP_RETENTION_DAYS="30"

SERVICE="server"                                  # Cloud Run 서비스
JOB_MIGRATE="migrate"                             # Cloud Run Job: Liquibase 마이그레이션
JOB_CLEANUP="cleanup"                             # Cloud Run Job: 만료 정리 + DB 깨우기
SCHEDULER_JOB="cleanup-daily"                     # Cloud Scheduler (매일 04:00 KST)
HELLO_IMAGE="us-docker.pkg.dev/cloudrun/container/hello"   # 자리 표시 서비스 이미지(첫 배포가 교체한다)
HELLO_JOB_IMAGE="us-docker.pkg.dev/cloudrun/container/job" # 자리 표시 Job 이미지

SA_RUNTIME="server-runtime"                       # 서비스 + cleanup Job의 실행 계정
SA_MIGRATOR="db-migrator"                         # migrate Job의 실행 계정(DB 비밀번호만)
SA_BACKUP="db-backup"                             # 백업 워크플로(GitHub OIDC)가 가장하는 계정
SA_SCHEDULER="scheduler-invoker"                  # Cloud Scheduler가 cleanup Job을 실행할 때 쓰는 계정
SA_DEPLOYER="github-deployer"                     # 배포 워크플로가 가장하는 계정(이미 있음)

email() { echo "$1@${PROJECT}.iam.gserviceaccount.com"; }

step() { printf '\n== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }

# 쓰기 명령: DRY_RUN이면 출력만 한다.
g() {
  printf '   + gcloud %s\n' "$*"
  [[ "$DRY_RUN" == 1 ]] || gcloud "$@"
}
# 읽기 확인(항상 실행). 성공하면 0.
exists() { "$@" >/dev/null 2>&1; }
# IAM 전파 지연(방금 만든 계정을 바로 참조하면 실패할 수 있다) 대비 재시도.
retry() {
  local n=0
  until "$@"; do
    n=$((n + 1))
    (( n < 6 )) || return 1
    note "재시도 $n/5 (IAM 전파 대기)"
    sleep 5
  done
}
gr() { # 재시도하는 쓰기 명령
  printf '   + gcloud %s\n' "$*"
  [[ "$DRY_RUN" == 1 ]] || retry gcloud "$@"
}

# ---------------------------------------------------------------- 사전 점검
step "사전 점검"
command -v gcloud >/dev/null || { echo "gcloud가 필요합니다" >&2; exit 1; }
account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1 || true)"
[[ -n "$account" ]] || { echo "gcloud auth login이 필요합니다" >&2; exit 1; }
[[ "$account" != *gserviceaccount.com ]] || { echo "사람 계정(owner)으로 실행하세요(서비스 계정 불가)" >&2; exit 1; }
exists gcloud projects describe "$PROJECT" || { echo "프로젝트 $PROJECT 에 접근할 수 없습니다" >&2; exit 1; }
export CLOUDSDK_CORE_PROJECT="$PROJECT"
note "프로젝트 $PROJECT, 리전 $REGION, DRY_RUN=$DRY_RUN"

for secret in database-password token-pepper; do
  exists gcloud secrets describe "$secret" || { echo "비밀 $secret 이(가) 없습니다. 값은 사람이 먼저 만들어야 합니다(이 스크립트는 값을 다루지 않음)" >&2; exit 1; }
  [[ -n "$(gcloud secrets versions list "$secret" --filter='state=ENABLED' --limit=1 --format='value(name)')" ]] \
    || { echo "비밀 $secret 에 활성 버전이 없습니다" >&2; exit 1; }
  note "비밀 $secret: 존재, 활성 버전 있음"
done
exists gcloud iam service-accounts describe "$(email "$SA_DEPLOYER")" || { echo "$SA_DEPLOYER 서비스 계정이 없습니다" >&2; exit 1; }
exists gcloud storage buckets describe "gs://$ARTIFACT_BUCKET" || { echo "산출물 버킷 $ARTIFACT_BUCKET 이 없습니다" >&2; exit 1; }

# ---------------------------------------------------------------- API
step "API 활성화(이미 켜져 있으면 변화 없음)"
g services enable \
  run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com storage.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com serviceusage.googleapis.com \
  cloudresourcemanager.googleapis.com logging.googleapis.com cloudscheduler.googleapis.com

# ---------------------------------------------------------------- Artifact Registry
step "Artifact Registry 저장소 $AR_REPO (docker, $REGION)"
if exists gcloud artifacts repositories describe "$AR_REPO" --location="$REGION"; then
  note "이미 있음"
else
  g artifacts repositories create "$AR_REPO" --repository-format=docker --location="$REGION" \
    --description="banbanyeok 서버·마이그레이션 이미지" --disable-vulnerability-scanning
fi
policy_file="$(mktemp)"
trap 'rm -f "$policy_file" "${lifecycle_file:-}"' EXIT
# 이미지(패키지)마다 최근 N개를 남기고 나머지는 지운다(Keep이 Delete보다 우선한다).
cat > "$policy_file" <<EOF
[
  {"name": "delete-all-but-recent", "action": {"type": "Delete"}, "condition": {"tagState": "any"}},
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": ${AR_KEEP_RECENT}}}
]
EOF
g artifacts repositories set-cleanup-policies "$AR_REPO" --location="$REGION" --policy="$policy_file"
if [[ "$DRY_RUN" != 1 ]]; then
  dry="$(gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" --format='value(cleanupPolicyDryRun)')"
  if [[ "$dry" == "True" || "$dry" == "true" ]]; then
    note "정리 정책이 dry-run 상태라 해제합니다"
    gcloud artifacts repositories set-cleanup-policies "$AR_REPO" --location="$REGION" --no-dry-run
  fi
fi

# ---------------------------------------------------------------- 서비스 계정
step "서비스 계정"
sa_desc() {
  case "$1" in
    "$SA_RUNTIME") echo "Cloud Run 서비스 server와 cleanup Job의 실행 계정" ;;
    "$SA_MIGRATOR") echo "Cloud Run Job migrate의 실행 계정(DB 비밀번호만 읽는다)" ;;
    "$SA_BACKUP") echo "DB 백업 워크플로(GitHub OIDC)가 가장하는 계정" ;;
    "$SA_SCHEDULER") echo "Cloud Scheduler가 cleanup Job을 실행할 때 쓰는 계정" ;;
  esac
}
for sa in "$SA_RUNTIME" "$SA_MIGRATOR" "$SA_BACKUP" "$SA_SCHEDULER"; do
  if exists gcloud iam service-accounts describe "$(email "$sa")"; then
    note "$sa: 이미 있음"
  else
    g iam service-accounts create "$sa" --display-name="$(sa_desc "$sa")"
  fi
done

# ---------------------------------------------------------------- 버킷
step "백업 버킷 gs://$BACKUP_BUCKET (비공개, 균일 접근, ${BACKUP_RETENTION_DAYS}일 후 삭제, soft delete 끔)"
if exists gcloud storage buckets describe "gs://$BACKUP_BUCKET"; then
  note "이미 있음"
else
  g storage buckets create "gs://$BACKUP_BUCKET" --location="$REGION" --uniform-bucket-level-access \
    --public-access-prevention --soft-delete-duration=0s
fi
lifecycle_file="$(mktemp)"
cat > "$lifecycle_file" <<EOF
{"rule": [{"action": {"type": "Delete"}, "condition": {"age": ${BACKUP_RETENTION_DAYS}}}]}
EOF
g storage buckets update "gs://$BACKUP_BUCKET" --lifecycle-file="$lifecycle_file" --public-access-prevention
# 백업에는 개인정보가 들어 있다. 어떤 경우에도 공개되지 않게 막는다.

step "산출물 버킷 공개 차단 확인·적용"
g storage buckets update "gs://$ARTIFACT_BUCKET" --public-access-prevention

# ---------------------------------------------------------------- Cloud Run 자리 표시 리소스
# 리소스 단위 IAM(서비스·Job에 바인딩)을 걸려면 리소스가 먼저 있어야 한다. 자리 표시 이미지로 만들고 첫 배포 워크플로가 교체한다.
# 비용은 0이다(min 0, 요청 없음).
step "Cloud Run 자리 표시 서비스·Job (첫 배포가 실제 이미지로 교체)"
if exists gcloud run services describe "$SERVICE" --region="$REGION"; then
  note "서비스 $SERVICE: 이미 있음"
else
  gr run deploy "$SERVICE" --image="$HELLO_IMAGE" --region="$REGION" --service-account="$(email "$SA_RUNTIME")" \
    --min-instances=0 --max-instances=1 --no-allow-unauthenticated
fi
if exists gcloud run jobs describe "$JOB_MIGRATE" --region="$REGION"; then
  note "Job $JOB_MIGRATE: 이미 있음"
else
  gr run jobs create "$JOB_MIGRATE" --image="$HELLO_JOB_IMAGE" --region="$REGION" \
    --service-account="$(email "$SA_MIGRATOR")" --max-retries=0
fi
if exists gcloud run jobs describe "$JOB_CLEANUP" --region="$REGION"; then
  note "Job $JOB_CLEANUP: 이미 있음"
else
  gr run jobs create "$JOB_CLEANUP" --image="$HELLO_JOB_IMAGE" --region="$REGION" \
    --service-account="$(email "$SA_RUNTIME")" --max-retries=0
fi

# ---------------------------------------------------------------- IAM: 런타임 계정
step "IAM: $SA_RUNTIME (비밀 2개 읽기, 산출물 버킷 읽기)"
gr secrets add-iam-policy-binding database-password --member="serviceAccount:$(email "$SA_RUNTIME")" \
  --role=roles/secretmanager.secretAccessor
gr secrets add-iam-policy-binding token-pepper --member="serviceAccount:$(email "$SA_RUNTIME")" \
  --role=roles/secretmanager.secretAccessor
gr storage buckets add-iam-policy-binding "gs://$ARTIFACT_BUCKET" --member="serviceAccount:$(email "$SA_RUNTIME")" \
  --role=roles/storage.objectViewer

step "IAM: $SA_MIGRATOR (DB 비밀번호만 읽기)"
gr secrets add-iam-policy-binding database-password --member="serviceAccount:$(email "$SA_MIGRATOR")" \
  --role=roles/secretmanager.secretAccessor

step "IAM: $SA_BACKUP (DB 비밀번호 읽기, 백업 버킷 쓰기·읽기. 삭제 권한 없음)"
gr secrets add-iam-policy-binding database-password --member="serviceAccount:$(email "$SA_BACKUP")" \
  --role=roles/secretmanager.secretAccessor
gr storage buckets add-iam-policy-binding "gs://$BACKUP_BUCKET" --member="serviceAccount:$(email "$SA_BACKUP")" \
  --role=roles/storage.objectCreator
gr storage buckets add-iam-policy-binding "gs://$BACKUP_BUCKET" --member="serviceAccount:$(email "$SA_BACKUP")" \
  --role=roles/storage.objectViewer
# GitHub OIDC(WIF) 가장 권한: github-deployer와 같은 풀·같은 저장소 ID 조건(주체 집합)을 그대로 쓴다.
wif_member="$(gcloud iam service-accounts get-iam-policy "$(email "$SA_DEPLOYER")" --flatten='bindings[].members' \
  --filter='bindings.role=roles/iam.workloadIdentityUser AND bindings.members~^principalSet' \
  --format='value(bindings.members)' | head -n1)"
[[ -n "$wif_member" ]] || { echo "$SA_DEPLOYER 의 workloadIdentityUser 주체 집합을 찾지 못했습니다" >&2; exit 1; }
gr iam service-accounts add-iam-policy-binding "$(email "$SA_BACKUP")" --member="$wif_member" \
  --role=roles/iam.workloadIdentityUser

# ---------------------------------------------------------------- IAM: 배포 계정(github-deployer)
step "IAM: $SA_DEPLOYER (리소스 단위. owner/editor 없음)"
deployer="serviceAccount:$(email "$SA_DEPLOYER")"
gr run services add-iam-policy-binding "$SERVICE" --region="$REGION" --member="$deployer" --role=roles/run.developer
gr run jobs add-iam-policy-binding "$JOB_MIGRATE" --region="$REGION" --member="$deployer" --role=roles/run.developer
gr run jobs add-iam-policy-binding "$JOB_CLEANUP" --region="$REGION" --member="$deployer" --role=roles/run.developer
gr artifacts repositories add-iam-policy-binding "$AR_REPO" --location="$REGION" --member="$deployer" \
  --role=roles/artifactregistry.writer
gr storage buckets add-iam-policy-binding "gs://$ARTIFACT_BUCKET" --member="$deployer" --role=roles/storage.objectUser
# 리비전·Job이 쓸 실행 계정을 지정하려면 그 계정에 대한 actAs가 필요하다(계정 단위).
gr iam service-accounts add-iam-policy-binding "$(email "$SA_RUNTIME")" --member="$deployer" \
  --role=roles/iam.serviceAccountUser
gr iam service-accounts add-iam-policy-binding "$(email "$SA_MIGRATOR")" --member="$deployer" \
  --role=roles/iam.serviceAccountUser
# gcloud가 프로젝트의 API(Cloud Run 등)를 호출하려면 필요한 최소 역할(API 사용만 허용, 리소스 권한 없음).
gr projects add-iam-policy-binding "$PROJECT" --member="$deployer" --role=roles/serviceusage.serviceUsageConsumer \
  --condition=None

# ---------------------------------------------------------------- 공개 호출(서비스만)
step "Cloud Run 서비스 $SERVICE 공개 호출 허용(API는 비회원 공개, 인증은 앱 토큰)"
gr run services add-iam-policy-binding "$SERVICE" --region="$REGION" --member=allUsers --role=roles/run.invoker

# ---------------------------------------------------------------- Cloud Scheduler
step "Cloud Scheduler $SCHEDULER_JOB: 매일 04:00 KST에 Job $JOB_CLEANUP 실행"
gr run jobs add-iam-policy-binding "$JOB_CLEANUP" --region="$REGION" \
  --member="serviceAccount:$(email "$SA_SCHEDULER")" --role=roles/run.invoker
run_uri="https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${JOB_CLEANUP}:run"
scheduler_args=(--location="$REGION" --schedule="0 4 * * *" --time-zone="Asia/Seoul" --uri="$run_uri"
  --http-method=POST --message-body="{}"
  --oauth-service-account-email="$(email "$SA_SCHEDULER")" --attempt-deadline=180s --max-retry-attempts=1
  --description="만료된 방 정리 + 무료 DB 깨우기(7일 비활동 일시정지 방지)")
if exists gcloud scheduler jobs describe "$SCHEDULER_JOB" --location="$REGION"; then
  gr scheduler jobs update http "$SCHEDULER_JOB" "${scheduler_args[@]}" --update-headers="Content-Type=application/json"
else
  gr scheduler jobs create http "$SCHEDULER_JOB" "${scheduler_args[@]}" --headers="Content-Type=application/json"
fi

# ---------------------------------------------------------------- 마무리
step "완료. 다음은 사람이 할 일"
cat <<EOF
   1) GitHub 저장소 변수 설정(비밀 아님):
        gh variable set DATABASE_URL  --body 'jdbc:postgresql://<세션 풀러 호스트>:5432/postgres?sslmode=require'
        gh variable set DATABASE_USER --body '<풀러 사용자>'
        gh variable set CORS_ALLOWED_ORIGINS --body 'https://<웹 도메인>'   # 선택. 없으면 브라우저 직접 호출 허용 오리진 없음
      (GCP_PROJECT_ID, GCP_REGION, GCP_WIF_PROVIDER, GCP_DEPLOY_SA, GCP_ARTIFACT_BUCKET 은 이미 있음)
   2) 배포: gh workflow run deploy-server.yml --ref <브랜치>
   3) 확인(읽기 전용):
        gcloud run services get-iam-policy $SERVICE --region=$REGION
        gcloud run services describe $SERVICE --region=$REGION --format='value(status.url)'
        gcloud scheduler jobs describe $SCHEDULER_JOB --location=$REGION --format='value(schedule,timeZone,state)'
        gcloud artifacts repositories describe $AR_REPO --location=$REGION --format='value(cleanupPolicyDryRun)'
EOF
