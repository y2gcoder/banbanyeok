# P8a 서버·DB 배포 작업 노트 (Cloud Run + Supabase + GCS)

작성 2026-11-14, P8a-2 개정 2026-11-15(콜드스타트 개선 3.10절, 백업을 Cloud Run Job으로 3.6절, WIF를 main으로 한정). 우선순위 문서: [01-synthesis](../01-synthesis.md) → [S1 노트](s1-notes.md) → [P3 노트](p3-notes.md)(7·8·9절). 웹(Cloudflare)은 P8b 범위다.

## 1. 구성

```
GitHub Actions ──(OIDC/WIF, 키 없음)──▶ github-deployer ─┬─▶ Artifact Registry  server/server, server/migrate (최근 3개)
  deploy-server.yml                                       ├─▶ Cloud Run Job  migrate  (Liquibase, db-migrator 계정)
                                                          ├─▶ GCS 산출물 버킷  versions/<버전>/<종류>.<해시16>.<확장자> + manifest.json
                                                          └─▶ Cloud Run 서비스 server (server-runtime 계정, min 0)
Cloud Scheduler cleanup-daily (04:00 KST) ─▶ Cloud Run Job cleanup (서버 이미지 + 인자 cleanup) ─▶ Supabase(세션 풀러)
Cloud Scheduler db-backup-weekly (월 03:17 KST) ─▶ Cloud Run Job db-backup (backup 이미지, db-backup 계정) ─▶ pg_dump 17 ─▶ gs://…-backups/db/ (비공개, 30일 후 삭제)
  (수동: gh workflow run db-backup.yml 은 이 Job을 실행하고 기다리기만 한다 — GitHub 러너는 DB 비밀번호·덤프를 만지지 않는다)
```

| 리소스 | 이름 | 비고 |
|---|---|---|
| 프로젝트·리전 | `banbanyeok-7eoxn` · `asia-northeast3` | |
| Artifact Registry | `server` (docker) | 이미지 `server`, `migrate`, `backup`. 정리 정책: 이미지별 최근 3개 유지, 나머지 삭제 |
| Cloud Run 서비스 | `server` | 1 vCPU · 512Mi · 동시성 40 · max 2 · min 0 · startup CPU boost · gen2 · 공개 호출 |
| Cloud Run Job | `migrate`, `cleanup`, `db-backup` | `migrate`: 1 vCPU·1Gi·재시도 0. `cleanup`: 서버 이미지, 재시도 1. `db-backup`: backup 이미지(postgres:17.6-alpine), 512Mi, 재시도 1, 15분 |
| Cloud Scheduler | `cleanup-daily`, `db-backup-weekly` | `0 4 * * *`·`17 3 * * 1` Asia/Seoul → 각 Job `:run`. 무료 3개 한도 중 2개 |
| 서비스 계정 | `server-runtime`, `db-migrator`, `db-backup`, `scheduler-invoker`, `github-deployer`(기존) | 아래 권한 표 |
| 버킷 | `…-artifacts`(기존), `…-backups`(신규) | 둘 다 비공개(공개 접근 차단 강제), 균일 접근 |

## 2. 부여한 권한 (누가·무엇에·왜)

프로젝트 수준 `owner`/`editor`는 아무에게도 주지 않았다. 프로젝트 수준 바인딩은 `github-deployer`의 `serviceUsageConsumer` 하나뿐이다(gcloud가 프로젝트의 API를 호출하려면 필요한 "API 사용" 권한이며 리소스 권한이 없다). 나머지는 모두 리소스(서비스·Job·비밀·버킷·저장소·계정) 단위다. 서비스 계정 키(JSON)는 만들지 않았다.

| 주체 | 역할 | 대상(리소스) | 왜 |
|---|---|---|---|
| `server-runtime` | `secretmanager.secretAccessor` | 비밀 `database-password`, `token-pepper`, `proxy-shared-secret` | 서비스·cleanup Job이 시작할 때 DB 비밀번호와 토큰 pepper를, 서비스가 웹 프록시 공유 비밀을 읽는다 |
| `server-runtime` | `storage.objectViewer` | 버킷 `…-artifacts` | 서버가 시작할 때 manifest와 산출물을 읽는다(쓰기 없음) |
| `db-migrator` | `secretmanager.secretAccessor` | 비밀 `database-password` | migrate Job이 Liquibase 비밀번호만 읽는다(pepper 접근 없음) |
| `db-backup` | `secretmanager.secretAccessor` | 비밀 `database-password` | db-backup Job이 pg_dump 비밀번호를 읽는다 |
| `db-backup` | `storage.objectCreator`, `storage.objectViewer` | 버킷 `…-backups` | 덤프를 올리고 크기를 확인한다. **삭제·덮어쓰기 권한 없음**(삭제는 수명 주기 규칙만) |
| `scheduler-invoker` | `run.invoker` | Job `db-backup` | Cloud Scheduler가 이 Job만 실행(위 `cleanup`과 같은 계정) |
| `github-deployer` | `run.developer` | 서비스 `server`, Job `migrate`·`cleanup`·`db-backup` | 리비전·Job 배포, Job 실행·대기, 트래픽 전환. 서비스 IAM 정책 변경(`setIamPolicy`)은 불가 |
| `github-deployer` | `artifactregistry.writer` | 저장소 `server` | 이미지 푸시 |
| `github-deployer` | `storage.objectUser` | 버킷 `…-artifacts` | 산출물 발행(생성·덮어쓰기)과 오래된 버전 정리(삭제) |
| `github-deployer` | `storage.legacyBucketReader` | 버킷 `…-backups` | 백업 신선도 점검이 객체 목록(이름·크기·시각)만 읽는다. 객체 내용(덤프)은 읽지 못한다 |
| `github-deployer` | `iam.serviceAccountUser` | 계정 `server-runtime`, `db-migrator`, `db-backup` | 리비전·Job에 실행 계정을 지정(actAs) |
| `github-deployer` | `serviceusage.serviceUsageConsumer` | 프로젝트 | gcloud/클라이언트가 프로젝트 API를 호출 |
| `scheduler-invoker` | `run.invoker` | Job `cleanup` | Cloud Scheduler가 이 Job만 실행 |
| `allUsers` | `run.invoker` | 서비스 `server`만 | 비회원 공개 API(인증은 앱의 익명 토큰) |

알아 둘 점
- **WIF는 main 브랜치로 한정**했다(P8a-2): 공급자 `banbanyeok-repo`의 속성 조건이 `assertion.repository_id=='<저장소 ID>' && assertion.ref=='refs/heads/main'`이라 main(푸시·예약·main에서 실행한 수동 실행)만 `github-deployer`를 가장할 수 있다. 다른 브랜치·PR·포크의 워크플로는 토큰을 받지 못한다. `db-backup` 계정은 이제 GitHub가 가장하지 않는다(Cloud Run Job 실행 계정이라 WIF 권한을 회수했다). main 밖에서 GCP를 쓰는 워크플로: `deploy-server.yml`(main 푸시는 해당 없음, **브랜치에서 `workflow_dispatch`나 임시 push 트리거로 돌리면 실패**), `db-backup.yml`·`gcp-auth-check.yml`(수동 실행은 main에서만). 브랜치에서 배포 실험이 필요하면 `WIF_REF=any bash infra/gcp/bootstrap.sh`로 풀었다가 끝나면 기본값으로 다시 실행한다.
- 프로젝트 기본 Compute 서비스 계정에는 GCP 기본값으로 `roles/editor`가 붙어 있다. 우리 서비스·Job은 모두 `server-runtime`/`db-migrator`를 명시해서 쓰므로 영향이 없지만, 다른 리소스를 만들 때 기본 계정을 쓰지 않도록 주의한다(필요하면 editor를 회수).
- 자리표시 서비스·Job을 부트스트랩이 먼저 만드는 이유: 리소스 단위 IAM은 리소스가 있어야 걸 수 있고, 배포 계정에는 프로젝트 전체 `run.admin`을 주지 않기 위해서다.

## 3. 결정과 근거

### 3.1 마이그레이션: 서버 이미지에 `migrate` 하위 명령을 넣지 않고 전용 이미지로 (근거 있는 변경)

`server/db/Dockerfile`: 로컬 compose와 **같은 공식 Community `liquibase/liquibase:5.0.4`(다이제스트 고정)** 위에 고정 PostgreSQL JDBC 42.7.14와 `server/db/changelog`를 얹는다(2026-11-24, [ADR-0003](../adr/0003-liquibase-community-5.md)). Cloud Run Job `migrate`가 환경 변수(`LIQUIBASE_COMMAND_URL/USERNAME`, 비밀번호는 Secret Manager 참조)로 실행한다.

- 서버 이미지의 콜드스타트 예산이 빠듯하다(boost 켠 Ktor AppCDS 실측 p90 1.39초). liquibase-core를 넣으면 JAR이 늘고(snakeyaml·jaxb 등) 클래스패스와 AppCDS 아카이브가 바뀌며 이미지가 커진다. 마이그레이션은 배포 때 한 번만 쓰는 코드다.
- 개발(`mise run dev:migrate`)과 운영이 같은 Liquibase 버전·같은 명령(`--changelog-file=master.sql update`)이라 "로컬에서만 되는" 차이가 없다.
- 서버 이미지를 먼저 만들지 않아도 마이그레이션할 수 있고, 마이그레이션 코드의 취약점·의존성이 서버 런타임으로 들어오지 않는다.
- 대가: Docker Hub의 공식 이미지에 의존한다(CI 러너에서 pull). 다이제스트를 고정했고 `postgres` 이미지는 이미 CI 통합 테스트가 같은 방식으로 쓴다.

검증(로컬): 이 이미지를 빌드해 빈 Postgres 17.6에 실행 → changeset 2개 적용(`Run: 2`), 다시 실행 → `Database is up to date`(멱등).

규칙: 배포 순서는 migrate 성공 → 앱 배포. 이전 리비전이 새 스키마에서도 동작하도록 changeset은 추가 위주(컬럼 삭제·이름 변경은 두 번에 나눠서)로 쓴다. 첫 마이그레이션 적용 전에는 서버가 Supabase에 새 테이블이 없다는 오류를 낼 수 있다.

### 3.2 Cloud Run 사양

| 항목 | 값 | 근거 |
|---|---|---|
| CPU·메모리 | 1 vCPU · 512Mi | JVM `-Xmx256m` + 메타스페이스 + CDS 매핑(약 30MB) + Netty·스레드 스택. P3/스파이크가 같은 512Mi·gen2로 콜드스타트를 쟀다. 1Gi는 쓰지 않는다(요청 비용만 늘어남) |
| 동시성 | 40 | 계산이 OD 표 조회라 요청당 CPU·메모리가 작다. Hikari 풀 4개가 DB 접속을 제한하므로 동시 요청이 풀을 기다려도 `connectionTimeout 10s` 안이다. 80(기본)이면 한 인스턴스에서 풀 대기가 길어질 수 있어 낮췄다 |
| 최대 인스턴스 | 2 | DB 연결 상한: 풀 4 × 2 = 8 < 무료 Supabase 세션 풀러 기본 풀 크기. 비용 상한이기도 하다. 속도 제한·멱등성 캐시는 인스턴스 메모리라(P3 9절) 인스턴스가 많을수록 약해진다 |
| 최소 인스턴스 | 0 | 비용 0원 목표. 콜드스타트는 입력 화면이 `/healthz`로 미리 깨워서 숨긴다 |
| startup CPU boost | 켬 | 스파이크에서 boost 켠 수치로 결정했다 |
| 요청 제한 시간 | 30초 | 최악의 느린 경로(DB 깨우기 + 계산)도 수 초 안. 길게 둘 이유가 없다 |
| 시크릿 | `--set-secrets …:latest` | 값이 이미지·변수·로그에 없다. pepper를 바꾸면 모든 토큰이 무효가 되므로(P3 9절) 회전은 의도적으로만 한다 |
| 시작 프로브 | 기본 TCP | `/healthz`가 DB와 무관하게 응답하므로 HTTP 프로브의 이득이 작다 |
| 공개 | allUsers invoker | 앞단이 Cloudflare지만 Cloud Run은 직접도 호출 가능. 레이트 리밋 절 참고 |

### 3.3 배포 흐름과 롤백

`deploy-server.yml`: 인증 → 서버 이미지(AppCDS 학습 포함)·마이그레이션 이미지 빌드·푸시 → `migrate` Job 갱신·실행·대기 → 산출물 발행 → **후보 리비전을 트래픽 0·태그 `candidate`로 배포** → 후보 URL에서 스모크(`scripts/smoke-server.sh`: `/v1/healthz`(아래 참고), manifest 버전, 추천 1건, 없는 방 404로 DB 읽기, 방 생성·조회·삭제로 DB 쓰기·pepper) → 트래픽 전환 → 공개 URL 재확인 → `cleanup` Job 갱신. 후보 스모크가 실패하면 트래픽이 바뀌지 않는다. 전환 뒤 확인이 실패하면 직전 리비전으로 되돌린다. 사람이 리비전을 골라 되돌릴 때는 [ADR-0011](../adr/0011-host-entered-draw-room.md)의 제약을 지킨다: 방장이 대신 넣은 방이 하나라도 만들어진 뒤에는 링크 미리보기 가림(#227)이 없는 리비전으로 되돌리지 않는다(마지막 그런 방이 만료·정리될 때까지, 최대 35일). 동시 실행은 `concurrency: deploy-server`(대기, 취소 없음)로 막는다. main push 때는 `deploy.yml`이 웹과의 순서를 맞춰 이 워크플로를 부른다([d104-notes.md](d104-notes.md)).

트리거: `workflow_dispatch` + main 푸시 중 `server/**`(changelog 포함)·`contracts/**`·`shared/**`·`build-logic/**`·`gradle/**`·`data/artifacts/dev/**`·발행 스크립트·워크플로 자신. 새 데이터 발행은 새 리비전을 낸다(P3 8절 권고 1: 리비전이 곧 데이터 버전).

주의: 산출물을 발행(manifest 교체)한 뒤 배포가 실패하면, **이전 리비전의 새 인스턴스**가 새 manifest를 읽을 수 있다(시작 때 manifest를 읽기 때문). 형식 호환(`schemaVersion`)은 서버가 검증하고 실패하면 시작하지 않는다. 스모크 전에 발행하는 순서라서 생기는 틈이며, 위험이 작다고 보고 두었다 → 결정 필요 5.

#### 리비전 롤백과 `meeting_band`(W3, changeset `20261116-meeting-band`)

마이그레이션은 앞으로만 적용하고, 문제가 생기면 **리비전만** 이전으로 돌린다(아래 6절 명령). 이 changeset 뒤에 이전 리비전(W3 이전 서버)으로 돌리면
이전 서버는 `rooms.meeting_band`를 모르므로 다음이 생긴다. 데이터는 그대로 남아 있어 새 리비전으로 다시 올리면 원래대로 돌아온다.

1. **시간대만 고른 방**(`meeting_time` null, `meeting_band` 있음)을 이전 서버는 시간대 없이 읽어 **낮**으로 계산한다. 방 응답에도 `meetingBand`가 없어
   웹 요약은 날짜만 보인다.
2. 그런 방에 이전 서버로 `meetingTime`을 넣는 PATCH가 오면, 이전 서버는 `meeting_band`를 지우지 않는다. 그래서 CHECK
   `rooms_meeting_band_without_time`에 걸려 **500**이 된다. 지금 웹에는 방 약속을 고치는 화면이 없어, 실제로는 API를 직접 부르는 경우뿐이다.
   시간대 없는 방과 새 방 만들기에는 영향이 없다.
3. 롤백 중에 새 웹이 `meetingBand`를 보내도 이전 서버는 모르는 키를 무시한다(`ignoreUnknownKeys`). 그래서 시간대만 고른 새 방은 낮으로 저장된다.

롤백을 오래 둘 때 영향 범위: `SELECT count(*) FROM rooms WHERE meeting_band IS NOT NULL;`. Liquibase rollback(`DROP COLUMN meeting_band`)은 시간대
정보를 지우고, CHECK를 잠시 내리면 어긋난 행이 생긴다. 그래서 둘 다 쓰지 않고, 고친 새 리비전으로 다시 올리는 것을 기본으로 한다.

### 3.4 산출물 발행

`./gradlew :pipeline:run --args="stage-release build/release"`(`mise run release:stage`)가 `data/artifacts/dev`(검증을 통과한 dev 산출물)를 **계약 형식**(contracts/data-format.md §4.3, §5)으로 바꾼다: `versions/<dataVersion>/<종류>.<sha256 앞 16자>.<확장자>`(예: `od.7ba35164a95367c8.bin`) + 그 경로를 가리키는 `manifest.json`. dev manifest는 평평한 경로(`od.bin`)라서 이 변환 단계가 필요하다. 내용(해시·길이)은 그대로이고, 변환 결과를 서버와 같은 `DataSetLoader`로 다시 검증한 뒤 manifest를 **마지막에** 쓴다(단위 테스트 4개).

`scripts/publish-artifacts.sh <버킷> build/release 10`이 업로드한다: ① 해시 이름 파일(불변, `--no-clobber`, `Cache-Control: immutable`) → ② `manifest.json`(마지막, `no-cache`; GCS 객체 덮어쓰기는 원자적) → ③ 올라간 manifest 대조와 파일 수 확인 → ④ 최근 10개 버전만 남기고 정리(현재 버전은 절대 삭제하지 않음). 이미 같은 manifest면 건너뛰고, 버킷의 `dataVersion`이 더 새로우면 거부한다(오래된 브랜치 배포가 데이터를 되돌리는 사고 방지, 롤백은 `FORCE=1`). 서버 prod는 `ARTIFACT_GCS_BUCKET`의 `manifest.json`(접두사 없음)을 읽고 경로를 키로 그대로 읽으므로 형식이 맞다(통합 확인은 8절).

보관 10개의 근거: 방은 최대 30일(데이터 버전이 방에 기록됨)이고 산출물은 한 버전이 약 1MB라 보관 비용이 사실상 0이다.

### 3.5 매일 정리와 Supabase 깨우기

`cleanup` Job = 서버 이미지 + 인자 `cleanup`. 만료된 방(참여자는 CASCADE)과 90일 비활동 익명 사용자를 지운다. **실제 DB 질의가 나간다**: `rooms`·`anon_users` 테이블에 대한 DELETE 두 문장(만료 인덱스 사용). DB에 닿지 못하면 JVM이 비정상 종료해 Job 실행이 실패로 기록된다(조용히 끝나지 않음).

Supabase 무료는 "7일간 활동이 적으면" 일시정지된다. [공식 문서](https://supabase.com/docs/guides/platform/free-project-pausing)는 "하루에 사용자 요청 몇 건이면 보통 충분"이라고만 하고 정확한 기준을 공개하지 않는다. 상수만 돌려주는 RPC 호출은 활동으로 안 잡힌 사례가 커뮤니티에 있다([토론](https://github.com/orgs/supabase/discussions/53090), 공식 답변 아님). 우리의 DELETE는 실제 테이블 질의이므로 보완 없이 깨우기 역할을 한다고 판단하지만 **보장은 아니다**. 안전망은 (a) 실제 사용자 트래픽, (b) 정지 약 1주 전 소유자에게 오는 경고 메일, (c) 필요하면 Scheduler 일정을 하루 2회로 늘리는 것(무료 3개 한도 안). → 결정 필요 4.

개인정보 방침 4항의 "만료 후 5일 이내 삭제"와 맞다(매일 1회).

### 3.6 백업: 서울 Cloud Run Job + Cloud Scheduler (P8a-2에서 GitHub Actions에서 옮김)

`db-backup` Job(이미지 `…/server/backup`, 계정 `db-backup`)이 `infra/backup/job.sh`를 실행한다: `scripts/db-backup.sh`(`PG_LOCAL=1`)로 `pg_dump --format=custom --no-owner --no-privileges --schema=public` → 목차 검증(서비스 테이블 3개 + `databasechangelog`) → 메타데이터 서버 토큰으로 GCS JSON API에 올림(`ifGenerationMatch=0`, 덮어쓰기 없음) → 올라간 크기를 다시 읽어 대조 → `gs://…-backups/db/banbanyeok-<UTC시각>.dump`. 비밀번호는 Secret Manager 참조(`PGPASSWORD`)로만 주입되고 토큰·비밀번호는 출력하지 않는다. 주 1회 Cloud Scheduler `db-backup-weekly`(월요일 03:17 KST, `17 3 * * 1`)가 실행한다. Scheduler는 `cleanup-daily`와 합쳐 2개라 무료 3개 한도 안이다.

**바뀐 사실(개인정보 방침의 수탁자·보유 서술용)**
- 실행 위치: GitHub Actions 러너 → **Google Cloud Run Job(서울, asia-northeast3)**. 백업 중 DB 비밀번호와 덤프(개인정보)는 GitHub 러너에 오지 않는다. GitHub는 백업과 관련해 개인정보를 처리하지 않는다(수동 실행 워크플로 `db-backup.yml`은 Job을 실행하고 끝나길 기다리기만 한다).
- 이미지: `postgres:17.6-alpine`(다이제스트 고정, 2025-08-14 릴리스 계열) + `curl` + 우리 스크립트 두 개. Postgres 17 클라이언트(`pg_dump`, `pg_restore`).
- 저장: `gs://banbanyeok-7eoxn-backups`(서울, 비공개·공개 접근 차단 강제·균일 접근·soft delete 끔), 보존 30일(버킷 수명 주기로 자동 삭제). 변경 없음.
- 권한: 쓰기·읽기만(`objectCreator`+`objectViewer`), 삭제·덮어쓰기 불가. 실행 계정은 `db-backup` 하나.
- 스케줄 변경: 주 1회 월요일 03:17 KST(이전과 같음), 실행 주체만 Scheduler.

옮긴 이유: (1) GitHub가 개인정보 수탁자에서 빠진다, (2) 공개 저장소의 60일 비활동 예약 정지 문제가 사라진다. 대가: backup 이미지를 AR에 하나 더 둔다(작음, `curl` 때문에 `apk add`를 빌드 때 한다). `pg_dump -Fc`를 Cloud Storage FUSE에 직접 쓰지 않고 Job 안의 임시 파일(메모리 파일시스템)에 쓴 뒤 올리므로 덤프 크기가 Job 메모리(512Mi)를 넘지 않는 동안만 된다(무료 DB 500MB 한도에서 압축 덤프는 그보다 훨씬 작다. 커지면 메모리를 올린다).

이미지와 Job 갱신은 `deploy-server.yml`이 한다(실행은 하지 않음). 로컬 검증: backup 이미지를 빌드하고 compose Postgres + fake-gcs-server 에뮬레이터로 `job.sh`를 실행해 덤프→업로드→크기 대조까지 통과(`GCS_API_HOST`, `GCS_NO_AUTH=1` 시험 훅).

**운영 점검**: 8일 초과는 `backup-freshness.yml`(6.1절)이 매일 자동으로 알린다. 손으로 볼 때는: `gcloud storage ls -l gs://banbanyeok-7eoxn-backups/db/ | sort -k2 | tail -3`. Scheduler가 실패하면 `gcloud run jobs executions list --job=db-backup --region=asia-northeast3`의 실패 실행으로 보이고, 실패하면 6.1절의 알림(Scheduler 호출 실패, 작업 실행 실패)이 메일과 Slack으로 온다.

**복원 절차**
1. 백업 고르기: `gcloud storage ls -l gs://banbanyeok-7eoxn-backups/db/`, 받기: `gcloud storage cp gs://banbanyeok-7eoxn-backups/db/<파일> .`
2. 로컬 검증(운영 DB를 건드리지 않음): `mise run db:restore-check -- <파일>`. 임시 Postgres 17 컨테이너의 빈 DB에 오류 즉시 중단·한 트랜잭션으로 복원하고, 테이블·행 수(값은 출력하지 않음)·Liquibase 이력·트리거, 배포와 같은 migrate(`status`·`validate`·`update`), 아래 4(c)의 가드 확인을 본 뒤 컨테이너를 지운다. 하나라도 실패하면 exit 1이고 그 덤프로 운영 연결을 진행하지 않는다.
3. **복원 대상은 언제나 새로 만든 격리 DB다. 지금 트래픽을 받는 운영 DB는 어떤 경우에도 복원 대상이 아니다**(2026-11-28 개정, #182·ADR-0012 3단계). 새 DB에 기본 `public`이 있으면, 그 DB가 방금 만든 빈 DB인지 확인한 뒤 그 DB에서만 `DROP SCHEMA public`으로 준비한다. 복원은 늘 `pg_restore --no-owner --no-privileges --exit-on-error --single-transaction -d "<새 DB 연결>" <파일>`이다. `--exit-on-error`를 빼지 않는다(빼면 SQL 오류가 나도 복원이 계속되고, 뒤의 Liquibase는 복원된 이력만 보고 건너뛴다). 오류가 나면 그 DB는 연결하지 않고 지운 뒤 새 DB로 처음부터 한다. 이 단계에서는 서버의 변수·비밀과 Job 설정을 바꾸지 않는다(운영 트래픽은 지금 DB에 남는다).
4. **운영에 연결하기 전에, 새 DB에서 차례로**:
   (a) 만료된 방·익명 사용자를 지운다. 같은 서버 이미지의 `cleanup` 명령을 새 DB 연결로 실행한다(로컬이면 `server/app/build/install/app/bin/app cleanup`에 새 DB의 `DATABASE_URL`·`DATABASE_USER`·`DATABASE_PASSWORD`). 백업 시점에는 살아 있던 방이 이미 만료됐을 수 있다.
   (b) 배포와 **같은 migrate**(마이그레이션 이미지 `server/db/Dockerfile`, 명령 `update`)를 새 DB에 돌린다. 숨김을 받던 때(ADR-0007 이전)의 백업이라 숨긴 참가자 행이 남아 있으면 ADR-0012 3단계의 `participants_hidden_retired` 제약에서 실패한다. 그 changeset은 되돌려져 행은 바뀌지 않고 오류에는 제약 이름만 나온다. 다만 Liquibase는 changeset마다 따로 커밋하므로, 그 앞에 밀린 changeset(이 제약보다 오래된 백업)은 적용된 채 멈춘다. 격리된 새 DB라 운영에는 닿지 않고, 다음에 통과하는 migrate가 어차피 적용할 것들이다. 이때 행을 고치거나 지워 통과시키지 않는다. 연결하지 않고, 그 방이 만료돼 (a)가 지운 뒤 다시 돌린다.
   (c) **가드 확인**: `psql "<새 DB 연결>" -X -q -v ON_ERROR_STOP=1 -f scripts/db-guard-check.sql`. migrate 성공이나 Liquibase 이력으로 대신하지 않는다(이력이 있어도 제약이 없거나 검증되지 않은 덤프가 있을 수 있다). 이 파일은 `pg_catalog`에서 `public.participants`의 `participants_hidden_retired`가 CHECK인지, 검증됐는지(`convalidated`), 식이 `CHECK ((hidden IS NOT TRUE))`인지, 숨긴 행이 0인지 보고 값은 출력하지 않는다. 실패하면 연결하지 않는다.
   (d) **삭제 대조**: 복원은 백업 뒤의 삭제를 되돌린다. 백업 뒤 기존 DB에서 지워진 것(앱의 방 삭제·나가기·강퇴, 만료 정리, 삭제 요청 처리)을 새 DB에 반영한다.
   - 기존 DB가 읽히고, 거기서 "없음"이 삭제를 뜻할 때(기존 DB가 행을 잃어서 복원하는 경우가 아닐 때): `OLD_DB='<기존 DB>' NEW_DB='<새 DB>' bash scripts/db-restore-reconcile.sh`로 건수를 보고 `--apply`로 반영한 뒤 다시 돌려 `*_deleted_since_backup`이 모두 0인지 본다. 기존 DB는 읽기만 하고, 출력은 건수뿐이다. 비밀번호는 `~/.pgpass`로 준다. 기존 DB에서 방을 하나도 읽지 못하면 `--apply`를 거부한다. 백업 시점 이후 접수한 삭제 요청(privacy@) 목록도 따로 대조해, 그 방·참여자가 새 DB에 없는지 확인한다.
   - 기존 DB를 읽을 수 없거나 그 "없음"을 삭제로 믿을 수 없으면: 앱에서 직접 지운 건은 지금 관측할 수 있는 자료로 대조할 수 없다. 서버 코드는 지운 방·참여자 ID를 따로 기록하지 않고, 통계는 건수뿐이다. 플랫폼의 요청 로그에 경로가 남을 수는 있지만 이 절차에서 확인한 자료가 아니고 보존 기간·접근 권한에 묶인다. 이때는 삭제 요청 목록만 다시 처리할 수 있다. 이 한계를 기록하고 연결을 보류하며, 연결 여부는 운영자의 별도 승인으로 정한다.
   (e) **전환 경계**: 배포 Job이 만드는 후보 URL이 열리기 전에 (d)의 마지막 대조를 마친다. 그 뒤 트래픽 전환까지 기존 DB는 계속 쓰기를 받으므로 그 사이 생기는 삭제의 공백을 이렇게 닫는다. 삭제 요청(privacy@)은 마지막 대조 시점부터 보류 목록에 쌓고 기존 DB와 새 DB 양쪽에 처리한다. 앱의 직접 삭제는 기존 DB에만 생기므로, 마지막 대조부터 전환까지 기존 서비스의 쓰기를 멈춰야(점검 공지 후 중단) 닫힌다. 이 저장소에는 쓰기만 멈추는 기능이 없고 서비스 중단은 운영자의 결정이므로, 그 승인 없이 공백을 둔 채 전환하지 않는다. 쓰기를 멈춘 뒤 (d)를 한 번 더 돌려 0건이고 (c)가 다시 통과해야 (f)로 간다.
   (f) **자격(비밀) 유지와 재배포**: 지금 배포의 서버·migrate·cleanup·db-backup은 모두 Secret Manager `database-password:latest`를 쓴다. Cloud Run은 인스턴스가 시작될 때 그 값을 읽으므로, `latest`를 새 DB의 비밀번호로 바꾸면 이전 리비전의 새 인스턴스(재시작·확장)와 배포 실패 때의 자동 롤백(트래픽만 이전 리비전으로 돌림)도 새 비밀번호로 기존 DB에 붙으려다 실패한다. `DATABASE_URL`·`DATABASE_USER`는 리비전마다 고정이라 롤백하면 기존 DB를 가리킨다.
   - 보통 전환(이 워크플로)은 새 DB가 기존 DB와 **같은 비밀번호**로 접속될 때만 한다(사용자 이름은 달라도 된다). 그러면 Secret은 바꾸지 않고 저장소 변수 `DATABASE_URL`(필요하면 `DATABASE_USER`)만 새 DB로 바꿔 main 배포를 돌린다. 배포 Job이 migrate(변경 없음)를 돌리고 그 성공 뒤에만 후보를 만들고, 스모크가 통과해야 트래픽을 옮긴다. 기존 DB와 그 자격은 롤백이 더 필요 없다고 판단할 때까지 그대로 둔다.
   - 비밀번호가 다르면 공통 `latest` 흐름으로는 전환과 롤백 동안 두 DB의 자격을 함께 유지할 수 없다. 보통 전환으로 진행하지 않는다. 버전을 고정한 비밀 참조나 DB별 비밀을 쓰는 별도 전환(워크플로 변경 포함)을 따로 검토·준비한 뒤에 한다. 기존 비밀 버전을 끄거나 지우는 일은 롤백 창이 닫힌 뒤에 한다.
   (a)~(e)를 마치기 전에는 새 DB로 서비스를 열지 않는다.
5. 부분 복구(방 하나 등)도 덤프는 3과 같은 방식으로 격리된 DB에 복원하고, 운영 DB에는 고른 행만 옮긴다. 옮기기 전에 운영 DB에서 4(c)의 가드 확인(읽기만 한다)이 통과해야 하고, 옮기는 `INSERT`는 한 트랜잭션으로 한다(숨긴 참가자 행은 운영 DB의 제약이 거절한다). 부분 복구는 운영 DB가 잃은 행을 되살리는 일이라 "운영 DB에 없음"이 삭제인지 유실인지 구별되지 않는다. 옮길 행마다 백업 이후 삭제 요청 목록과 대조하고, 앱에서 직접 지운 행인지는 4(d)의 한계대로 확인할 수 없음을 기록해 별도 승인을 받은 뒤 옮긴다.
6. ADR-0012 4단계(열 DROP)가 배포되면 `participants_hidden_retired`도 열과 함께 없어진다. 그때 4(c)의 확인(`scripts/db-guard-check.sql`, `db-restore-check.sh`)을 "`participants`에 `hidden` 열이 없다"로 바꾸고, 열이 남은 덤프를 4단계 이후 판에 붙일 때는 같은 migrate가 4단계 changeset까지 통과해야 한다. 바꿀 자리는 이 두 파일과 이 절이다.

**개인정보 방침과의 관계**: main의 방침은 4항에 "데이터베이스 백업: 백업한 날부터 30일. 백업에 남은 정보는 보존 기간이 지나면 차례로 지워집니다"를 적었고 구현(수명 주기 30일)과 맞는다. DB에서 지운(만료·삭제 요청) 정보가 백업에는 최대 30일 남고, 방은 최대 30일 + 정리 5일 이내 삭제이므로 DB 밖 보관은 가장 긴 경우 약 65일이다. 방침의 GitHub 행(백업 수탁)은 위 "바뀐 사실"대로 지울 수 있다(별도 방침 작업에서 처리).

### 3.7 배차 갱신 태스크 (7번)

`mise run data:refresh-headways` = `scripts/refresh-headways.sh`: `op` 설치·로그인 확인(명확한 오류) → `data/raw/kric.xlsx`가 없으면 `fetch`(키 불필요; `all`과 같은 기준)로 원본을 먼저 받음 → `op run --env-file=.env.tpl -- ./gradlew :pipeline:run --args=refresh`(build→validate 포함) → `web/node_modules`가 없으면 설치 → `pnpm --filter web gen`. 새 worktree에서 `fetch`는 `data/config/source-manifest.json`의 수집 기록을 갱신하므로 diff를 검토한다. `mise run data:refresh`(키 없음)는 그대로다.

### 3.8 로그 저장 위치 (서울)

기본 Cloud Logging 버킷 `_Default`·`_Required`는 `location=global`이라 개인정보 처리방침의 "로그 저장 위치"를 서울로 쓸 수 없다. `bootstrap.sh`가 (1) 서울 버킷 `default-seoul`(보존 30일)을 만들고, (2) `_Default` 싱크의 대상을 그 버킷으로 바꾸며, (3) `gcloud logging settings update --storage-location=asia-northeast3`(이후 만드는 버킷의 기본 위치, 프로젝트 수준에서 지원되지 않으면 경고만)를 멱등하게 시도한다.
- 일반 로그(Cloud Run 요청·앱 로그)는 이후 서울 버킷에 저장된다. 이미 global `_Default`에 쌓인 로그는, 새 로그가 더 이상 들어오지 않으므로 그 버킷의 보존을 **1일로 줄여**(`gcloud logging buckets update _Default --location=global --retention-days=1`, 부트스트랩에 멱등 단계로 포함, 코디네이터가 실행) 빨리 사라지게 했다. `settings update --storage-location`은 프로젝트 수준에서 지원되지 않아(조직·폴더 전용) 건너뛰었다.
- **`_Required`(감사 로그: 관리자 활동·시스템 이벤트)는 보존 400일, 잠김이라 위치도 보존도 바꿀 수 없고 `global`에 저장된다.** 감사 로그에는 리소스 변경 기록과 호출한 계정이 들어 있고 서비스 이용자(방·출발역) 정보는 없다. 방침에는 "일반 로그: 서울, 감사 로그: Google 관리 global"로 구분해 쓰는 것을 권한다 → 결정 필요 6.
- 서버 로그는 요청 방식·방 ID를 가린 경로·응답 코드만 남긴다(방침 2항과 같음). Cloud Run이 요청 로그에 붙이는 접속 IP·User-Agent는 `run.googleapis.com/requests` 로그에 들어간다.

### 3.9 Cloud Run `/healthz` 예약 경로 (실측으로 발견)

Cloud Run 앞단(Google Front End)은 `/healthz` 경로를 예약해서 요청이 앱에 닿기 전에 `404 (Not Found)!!1` HTML을 돌려준다(요청 로그도 남지 않는다). 첫 배포의 스모크가 이 때문에 실패했다. 계약(`openapi.yaml`)이 이미 `/v1/healthz`를 같은 응답으로 정의하므로 **배포된 서버는 `/v1/healthz`로 확인**한다(스모크·콜드스타트 측정·웹 프리워밍 모두). 웹의 `/api/healthz` rewrite 대상도 `/v1/healthz`여야 한다(P8b에 전달함). 컨테이너 안(AppCDS 학습, 로컬)에서는 `/healthz`도 그대로 동작한다.

### 3.10 콜드스타트 개선 (P8a-2, 목표: 새 인스턴스 첫 `/v1/healthz` p50 2초 이하)

**결과(실측, 새 인스턴스 6회씩, 같은 방법)**: p50 **3.69초 → 1.87초**, p90 **4.29초 → 2.18초** → 목표 달성. 방법은 8절의 "트래픽 0 리비전 6개를 35분 방치한 뒤 태그 URL 첫 요청"(`scripts/measure-coldstart-revisions.sh`)이고 로그로 매번 새 인스턴스임을 확인했다.

| 측정(초, curl total, 클라이언트 위치 포함) | 개선 전 p50 / p90 | 개선 후 p50 / p90 |
|---|---|---|
| **콜드 첫 `/v1/healthz`** | 3.69 / 4.29 (3.09~4.47) | **1.87 / 2.18** (1.66~2.36) |
| 이어서 첫 DB 읽기(없는 방 404) | 0.67 / 0.70 | **0.24 / 0.27** |
| 이어서 추천 1건 | 0.22 / 0.23 | **0.15 / 0.16** |
| 웜 `/v1/healthz`(기준) | 0.09 / 0.16 | 0.09 / 0.09 |
| 서버 쪽 첫 요청 지연(Cloud Run 요청 로그 `httpRequest.latency`) | 3.29 / 3.87 (2.72~4.10) | **1.61 / 1.89** (1.38~2.09) |

**1단계: 단계별 시간부터 쟀다**(`StartupTimeline` 로그, 값은 단계 이름과 ms뿐). 새 리비전을 배포하면 그 첫 인스턴스의 시작 로그가 바로 나오므로(방치 없이) 실험마다 단계 시간을 얻었다. 인스턴스 시작 → 시작 프로브 성공까지:

| 단계(대표 인스턴스 1대, ms) | 개선 전 | 개선 후 | 한 일 |
|---|---|---|---|
| 컨테이너 시작 → `main` 진입 | 460~480 | 460~500 | (바꾸지 못함: 샌드박스·JVM 부팅) |
| 로깅 초기화(`logback.xml` XML 파싱) | 855 (직렬) | 약 400, **작업과 겹침** | 설정을 코드로(`FastLogbackConfigurator`, ServiceLoader), 시작 작업 스레드와 병렬 |
| GCS 클라이언트 생성(옵션 + ADC 탐색 + 서비스) | 630~750 | **0** | 공식 클라이언트 제거 → JSON API 직접 호출(`GcsArtifactStore`, 메타데이터 서버 토큰) |
| manifest 읽기(토큰 + TLS + 요청) | 510~550 | 약 650 (토큰 약 230 + 첫 응답 약 400) | 위에서 옮겨 온 비용(첫 요청의 TLS·토큰은 남는다) |
| 나머지 산출물 2개 | 105(직렬이면 더) | 90~130, 병렬 | 세 파일을 동시에 읽음 |
| 산출물 검증(해시·구조) | 150~200 | 90~130 | 학습(AppCDS)에 운영과 같은 경로를 넣음 |
| DB 풀 생성 | 35 | 병렬 | 산출물 읽기와 겹침. **첫 연결을 뒤에서 미리 맺음**(첫 DB 요청 0.67 → 0.24초) |
| Ktor 시작 | 170~200 | 120~170 | |
| 프로브 성공 | 약 100 | 약 60~90 | |
| **합계(인스턴스 시작 → 준비)** | **약 3.1~3.25초** | **약 1.9~2.0초** | |

**효과가 있었던 것**: 공식 GCS 클라이언트를 JSON API 직접 호출로 바꿈(약 −0.8초, 가장 큼), 로깅 XML 제거와 시작 작업 병렬화(약 −0.45초), 산출물 3개 병렬 읽기, DB 첫 연결 미리 맺기(첫 DB 요청 −0.4초). **효과가 없었거나 해로웠던 것**(결과를 남겨 같은 길을 다시 가지 않게):
- **서버를 먼저 띄우고 데이터는 뒤에서 로드**(건강 확인은 즉시 응답): 구현·테스트까지 했지만 **Cloud Run 요청 기반 CPU 스로틀 때문에 역효과**였다. 첫 응답 뒤 요청이 없으면 CPU가 거의 0이 돼 뒤에서 하던 로드가 약 1.5초가 아니라 **8.5초**(다음 요청이 올 때까지)로 늘었다. 되돌렸다(코드 없음). `--no-cpu-throttling`(인스턴스 기반 과금)으로 풀 수는 있으나 유휴 인스턴스(최대 15분+)까지 과금돼 0원 목표에 어긋나 채택하지 않았다.
- JVM 플래그 `-XX:TieredStopAtLevel=1 -XX:+UseSerialGC`: 차이가 잡음 안(3.13 vs 3.25초). 해롭지 않아 남겼다.
- AppCDS 학습에 GCS 경로(fake-gcs-server `1.56.1`, 2026-08-24)를 넣음: 공식 클라이언트 시절 클라이언트 생성이 1.36 → 1.05초로 줄었지만 전체는 잡음 안. 클라이언트 제거 뒤에도 같은 경로로 학습해서 HTTP·JSON 클래스를 아카이브에 넣는다(아카이브 29 → 39MB는 SDK 클래스 때문이었음).
- `GOOGLE_CLOUD_PROJECT`로 프로젝트 ID 조회 생략, Cloud Run CPU 2, 메타데이터 서버를 이름 대신 고정 주소(DNS 생략), 첫 읽기 전 TLS 미리 연결(`GcsArtifactStore.warmUp`): 모두 측정 가능한 효과가 없었다. CPU 2는 되돌렸고 `GOOGLE_CLOUD_PROJECT`는 클라이언트 제거로 필요 없어 뺐다. 메타데이터 고정 주소와 `warmUp`은 해롭지 않아 남겼지만 다음에 코드를 줄일 때 **제거 후보**다.

**남은 시간**: 컨테이너 시작 → main(약 0.5초)과 첫 GCS 요청의 토큰·TLS(약 0.65초)가 이제 가장 큰 덩어리다. 더 줄이려면 manifest를 이미지에 넣어 시작 때 GCS를 건너뛰는 방법(데이터 갱신 = 새 이미지)이나 min 1이 있고, 둘 다 현재 정책(산출물은 GCS 발행, 비용 0원)과 맞바꾸는 일이라 하지 않았다.

**코드·설정 변경 요약**: `StartupTimeline`(단계 로그), `FastLogbackConfigurator`(+`logback.xml` 삭제), `GcsArtifactStore`/`MetadataTokenProvider`(JSON API, SDK는 통합 테스트 전용), `ArtifactLoader` 병렬 읽기, `CompositionRoot`/`Main`(조립을 별도 스레드로, DB 연결 미리), `AppConfig.ARTIFACT_GCS_ENDPOINT`(운영에서는 금지, AppCDS 학습·에뮬레이터 전용), Dockerfile(학습에 fake-gcs-server), `run.sh` 플래그. 산출물 형식·API·시작 실패 동작(검증 실패 시 시작 안 함)은 그대로다. **운영 GCS 인증은 Cloud Run 실행 계정의 메타데이터 토큰뿐**이다(이전에도 키 파일은 읽지 않았다). 로컬에서 실제 GCS를 읽으려면 에뮬레이터(`ARTIFACT_GCS_ENDPOINT`)를 쓴다.

**웹 확인(읽기만)**: 홈 입력 화면(`home-form.tsx`)만 `warmUpServer()`를 부른다. **방 참여 화면은 웹에 아직 없다**(R1 작업자가 만들고 거기서 `warmUpServer()`를 넣기로 함). 친구가 공유 링크(`/s?…`)로 처음 들어오는 화면은 서버 컴포넌트가 서버를 바로 부르므로(결과 prefetch와 `generateMetadata`의 3초 제한) 미리 깨울 기회가 없다. 이번 개선으로 새 인스턴스의 첫 요청이 약 1.6~1.9초라 그 3초 제한 안에 들어온다(개선 전 p50 3.3초는 제한을 넘겼다). `web/src`는 고치지 않았다.

### 3.11 후속 점검 (P8a-3: 독립 검토 반영)

**JVM 플래그 `-XX:TieredStopAtLevel=1`(C1 전용)의 워밍 후 비용 — 측정했고 플래그를 유지한다.** 우려는 C2로 올라가지 못해 데워진 뒤 `/v1/recommend`가 느려지는 것이었다. 같은 이미지(`server/Dockerfile`, 로컬 Docker Desktop arm64 네이티브, `--cpus=1 --memory=512m`)를 플래그 있음(C1) / 없음(기본 티어드)으로 띄워 같은 추천 요청(서울 역 300개에서 무작위 2명, fair·fast)을 보냈다. 클라이언트는 파이썬 keep-alive 연결이라 측정치에는 요청 왕복(수백 µs)이 섞여 있다. 2회 반복.

| 항목 | C1 전용(현재) | 기본(티어드) |
|---|---|---|
| 컨테이너 시작 → 첫 `/v1/healthz` 200 (2회, ms) | 649 / 411 | 730 / 722 |
| 첫 추천 요청 (2회, ms) | 13 / 13 | 69 / 15 |
| 요청 1~100 p50 / p95 (ms) | 0.8 / 1.2~1.5 | 1.0 / 1.8~2.2 |
| 요청 101~300 p50 / p95 | 0.5 / 0.6~0.7 | 0.5 / 0.8~0.9 |
| 요청 301~600 p50 / p95 | 0.5 / 0.5~0.6 | 0.4~0.5 / 0.6~1.0 |
| 워밍 후 순차 3000건 p50 / p95 / p99 | 0.44 / 0.57~0.62 / 0.80~0.86 | **0.32~0.33 / 0.48 / 0.70~0.75** |
| 연결 4개 × 1500건 p50 / p95 / p99 | 0.56~0.57 / 0.85~0.98 / 1.6~1.7 | 0.51 / 0.80~0.90 / 1.6~2.7 |

결론: 워밍 후 C1의 추천은 p50이 약 **0.1ms**(0.44 vs 0.33ms) 느릴 뿐이고 p95·p99는 같은 범위다. 사용자가 보는 지연(왕복 수십~수백 ms)에 비해 무시할 수 있고, 최대 2인스턴스·낮은 트래픽이라 처리량 상한도 문제가 아니다. 반면 콜드스타트는 컨테이너 시작→healthz가 C1이 **약 100~300ms 짧다**(로컬 측정, Cloud Run에서는 앞서 X1이 잡음 안이었다). 한 번만 쓰이는 시작 구간이 이득이라 플래그를 유지한다. 부하가 커져 CPU 바운드가 되면(수백 rps) 플래그를 빼는 쪽을 다시 본다(기본 티어드로 돌아가면 시작 구간 약 0.1~0.3초를 내준다). 한계: 로컬 arm64 Docker와 Cloud Run(amd64, gVisor)은 절대값이 다르다.

**그 밖의 코드 수정(독립 검토 반영)**
- SLF4J 초기화 경합: 조립 스레드가 DB 풀(Hikari)을 만들기 전에 main 스레드의 로깅 초기화 완료를 기다린다(`StartupTimeline.awaitLoggingReady`, 최대 10초). 산출물 읽기(GCS 토큰·TLS·왕복)는 로거를 쓰지 않아 계속 겹쳐 돈다(`CompositionRoot`가 `async(ioDispatcher)`로 시작). 로컬 3회 실행에서 `intercepted`·`Replaying`·SLF4J 경고 0건. Cloud Run에서의 콜드스타트 영향은 병합 후 배포의 시작 로그로 확인한다(예상: 변화 없음, DB 풀이 약 0.1초 늦게 시작해도 산출물 읽기 안에 끝남).
- `GcsArtifactStore` 재시도: 408·429·5xx·연결 오류를 재시도, **401이면 캐시된 토큰을 버리고 한 번만** 재시도(`MetadataTokenProvider.invalidate`), 그 밖의 4xx는 바로 실패. 단위 테스트 4개(작은 HTTP 서버).
- 응답에 `x-goog-generation` 헤더가 없으면 `ABSENT`(빈 값)로 취급하지 않고 실패시킨다(재시도 없는 `IllegalStateException`). 조건부 쓰기가 틀어지는 것을 막는다.
- `database-connection-warm` 로그는 연결이 실제로 맺어져 유효할 때만 남긴다. 시작 실패(`awaitAssembly` 실패) 때도 타임라인을 로그로 내보낸 뒤 종료한다.

**작업 실패 알림(적용됨, 2026-11-17 확인, #54)**: bootstrap에 넣지 않고 `infra/gcp/monitoring-jobs.sh`로 분리했다(모니터링은 REST라 gcloud 전용 bootstrap과 섞지 않음, 스크립트가 연결하는 채널은 메일뿐이고 표시 이름 `운영자 메일`로 조회, 주소는 저장소에 없음, 멱등. Slack 채널 연결은 6.1절). 정책 둘: ① `run.googleapis.com/job/completed_execution_count`의 `result=failed`가 5분 구간에 1건 이상(Job `cleanup`·`db-backup`별, 지표 존재 확인함), ② Scheduler 로그 ERROR 이상(cleanup-daily·db-backup-weekly; 이 프로젝트에는 Scheduler 지표 설명자가 없어 로그 기반). 한계: 주 1회 Job이 **아예 안 돈** 경우는 지표 부재 조건의 최대 기간(약 1일)을 넘어 잡지 못한다 → 3.6절의 최신 백업 점검을 유지. 두 정책은 이미 적용돼 있다(#54에서 확인). 다시 적용할 때는 코디네이터가 `bash infra/gcp/monitoring-jobs.sh`를 실행하고, 정책 JSON 확인은 `DRY_RUN=1`로 한다. 실패하면 응답 본문이 그대로 출력된다.

## 4. 레이트 리밋 키 권고 (8번)

문제: 웹은 Cloudflare 뒤에서 서버 API를 **같은 출처 rewrite**로 부른다. Cloud Run이 직접 연결로 보는 상대는 Cloudflare 쪽이고, 그 앞단(GFE)이 붙이는 `X-Forwarded-For`의 **마지막 값**이 그 직접 연결의 IP다.

조사한 사실
- Cloud Run: 앞단이 `X-Forwarded-For`에 직접 연결 IP를 **덧붙인다**. 클라이언트가 보낸 값은 그 앞에 남으므로 **마지막 항목만 신뢰**할 수 있다(앞의 항목은 위조 가능).
- Ktor의 `request.local.remoteAddress`는 GFE 내부 주소라 `peer`(기본값)로 두면 **모든 사용자가 한 버킷**을 공유한다. 그래서 배포 워크플로는 기본값을 `xff-last`로 설정한다(`RATE_LIMIT_CLIENT_IP_SOURCE` 저장소 변수로 덮어쓸 수 있음).
- Cloudflare: `CF-Connecting-IP`는 Cloudflare가 원 사용자 IP로 설정한다([공식](https://developers.cloudflare.com/fundamentals/reference/http-headers/)). Workers의 외부(비 Cloudflare 고객) 서브요청에서는 **Worker 스크립트가 클라이언트 IP 헤더를 통제**하고, 원 요청 헤더를 그대로 넘기면 같은 값이 간다.

**결정·구현(코디네이터 지시, 이 PR에 포함)**
1. 웹(P8b)의 Worker 프록시가 `/v1/*` 요청마다 `X-Banbanyeok-Proxy-Secret`(값 = Secret Manager `proxy-shared-secret`)과 `X-Banbanyeok-Client-IP`(= `CF-Connecting-IP`)를 붙인다.
2. 서버는 **`PROXY_SHARED_SECRET`이 설정되어 있고 헤더의 비밀이 상수 시간 비교로 맞을 때만** `X-Banbanyeok-Client-IP`(공백 제거, 최대 64자)를 속도 제한 키로 쓴다. 그 외에는 연결 IP를 쓴다: 배포 기본값 `RATE_LIMIT_CLIENT_IP_SOURCE=xff-last`(Cloud Run 앞단이 붙인 마지막 `X-Forwarded-For`). 비밀이 설정에 없으면(로컬) 두 헤더를 완전히 무시한다. 설정된 비밀이 32자 미만이면 시작하지 않는다(값은 메시지에 싣지 않음).
3. 그래서 Cloud Run URL(`*.run.app`)을 직접 부르는 쪽이 `X-Banbanyeok-Client-IP`를 위조해도 효과가 없다(비밀을 모르면 자기 연결 IP의 한도에 걸린다). `header:CF-Connecting-IP`처럼 **헤더 이름만 믿는 설정은 쓰지 않는다**(Cloud Run은 공개 호출이라 누구나 보낼 수 있다).
4. 대안과 기각 이유: Cloud Run ingress를 막고 Cloudflare만 통과시키는 방법(내부+외부 HTTPS LB)은 LB 상시 비용(월 약 $18)이 0원 목표에 어긋난다. 공유 비밀 방식은 비용 0이다.
5. 한계: 속도 제한은 인스턴스 메모리라 인스턴스당 따로 센다(최대 2대). 폴백(`xff-last`)에서는 같은 Cloudflare 출구 IP를 쓰는 사용자들이 한 버킷을 공유할 수 있다(정상 경로는 프록시 헤더라 해당 없음). 비밀을 회전하려면 Secret Manager에 새 버전을 넣고 서버·Worker를 함께 재배포한다(`:latest`는 리비전 시작 때 읽는다).

구현: `config/AppConfig.kt`(`ClientIpSource.proxySecret`), `http/RateLimiter.kt`(`trustedProxyClient`, 헤더 이름 상수), 테스트 `PluginsHttpTest`("proxy shared secret" 3개)·`ConfigTest`.

CORS: 같은 출처 rewrite는 서버 간 호출이라 브라우저 CORS가 필요 없다. prod 프로필은 값이 비면 시작하지 않으므로 워크플로는 `CORS_ALLOWED_ORIGINS` 저장소 변수(없으면 예약 TLD `https://web.banbanyeok.invalid` = 허용 오리진 없음)를 쓴다. P8b가 실제 도메인이 정해지면 변수를 설정한다.

## 5. 월 예상 비용 (2026-11 가격 기준 추정, 무료 구간 안이면 0)

| 항목 | 사용량 가정 | 무료 구간 | 예상 |
|---|---|---|---|
| Cloud Run 서비스 | 월 수만 요청, 요청당 수백 ms, min 0(요청 기반 과금) | 요청 200만·CPU 18만 vCPU-초·메모리 36만 GiB-초 | 0원 |
| Cloud Run Job | cleanup 매일 약 30~60초 + 배포마다 migrate 1분 | 위와 공유 | 0원 |
| Cloud Scheduler | 1개 | 계정당 3개 | 0원 |
| Artifact Registry | 이미지 6개(최근 3개 × 2), 레이어 공유로 약 1GB 이하 | 0.5GB | 월 $0.05 이하(약 70원) |
| GCS | 산출물 ≈ 10MB, 백업 ≈ 수 MB × 4~5개, 서울은 무료 구간 없음 | — | 월 $0.01 이하 |
| Secret Manager | 비밀 2개(활성 버전 2), 접근은 인스턴스 시작 때마다 | 버전 6개·접근 1만 회 | 0원 |
| 로깅 | 평문 한 줄 로그 | 월 50GiB | 0원 |
| Supabase | 무료 | — | 0원 |
| GitHub Actions | 퍼블릭 저장소 | 무료 | 0원 |

합계: 0~100원 안팎(월 예산 알림 5천 원의 2% 이하). 비용이 커질 수 있는 부분은 AR 저장(이미지 정리 정책이 상한), 인스턴스 폭주(max 2로 제한), Cloud Run Job 오작동 반복(재시도 0~1)이다.

## 6. 운영 명령 모음

```sh
# 배포(브랜치에서도 가능)
gh workflow run deploy-server.yml --ref <브랜치>; gh run watch
# 스모크(서비스 URL)
bash scripts/smoke-server.sh "$(gcloud run services describe server --region asia-northeast3 --format='value(status.url)')"
# cleanup Job 수동 실행 / 마이그레이션 수동 실행
gcloud run jobs execute cleanup --region asia-northeast3 --wait
gcloud run jobs execute migrate --region asia-northeast3 --wait
# 백업 수동 실행(Job 실행) / 목록
gcloud run jobs execute db-backup --region asia-northeast3 --wait   # 또는 gh workflow run db-backup.yml
gcloud storage ls -l gs://banbanyeok-7eoxn-backups/db/
# 이전 리비전으로 즉시 롤백(스키마는 그대로 둔다. W3 meeting_band 뒤의 롤백 영향은 3.3절)
gcloud run revisions list --service server --region asia-northeast3
gcloud run services update-traffic server --region asia-northeast3 --to-revisions <리비전>=100
# 데이터 롤백(이전 manifest 재발행): 이전 커밋에서 stage-release 후 FORCE=1 bash scripts/publish-artifacts.sh <버킷>
```

### 6.1 모니터링 (Cloud Monitoring, 코디네이터가 콘솔/REST로 설정 — `bootstrap.sh` 밖)

- 알림 채널: 2개. 이메일(운영자 메일)과 Slack 채널 `반반역 Slack`(운영자의 비공개 Slack 채널 `#banbanyeok-system-notice`로 보낸다). 아래 알림 정책 3개 모두 두 채널에 함께 연결돼 있다(2026-11-17, #54).
- 알림 정책 3개: ① "반반역 사이트 응답 없음"(아래), ② Cloud Scheduler 호출 실패, ③ Cloud Run Job 실행 실패(②·③은 3.11절의 `monitoring-jobs.sh`).
- 가동 확인(uptime check) 2개: `https://banbanyeok.app/api/healthz`(본문에 `ok` 포함), `https://banbanyeok.app/`(2xx). 5분 주기, 제한 시간 15초, 기본(전 지역).
- ① 정책 "반반역 사이트 응답 없음": `check_passed`가 false인 지역이 2곳 이상, 5분 지속이면 알림, 30분 뒤 자동 종료.
- 백업 신선도 점검(`.github/workflows/backup-freshness.yml`): 매일 09:00 KST에 `gs://…-backups/db/`의 가장 최근 `.dump`가 없거나 8일보다 오래됐으면 워크플로가 **실패**한다. 실패 알림은 GitHub Slack 앱이 main의 Actions 결과를 보내는 운영자 채널로 간다(웹훅 없음). Cloud Monitoring 알림은 실패한 실행만 잡고 아예 안 돈 경우는 못 잡는데, 이 점검이 그 구멍(스케줄러 일시 중지·삭제)을 메운다. 출력은 객체 이름·크기·나이뿐이다. 수동 확인은 `gh workflow run backup-freshness.yml`. 예약 실행은 저장소에 60일 활동이 없으면 GitHub이 멈추므로 그때는 이 점검도 멈춘다.
- Slack 채널에는 GitHub Slack 앱이 이 저장소를 넓게 구독하고 있다(앞으로 쓸 것을 대비한 의도적 설정). 워크플로 결과도 여기에 포함되며, 백업 신선도 점검 실패도 이 경로로 온다.
- 오류 추적(PostHog)은 알림 대상 2개("Issue created", "Issue reopened")를 같은 Slack 채널로 보낸다. 메시지는 기본 템플릿만 써서 개인정보 속성이 들어가지 않는다.
- 그 Slack 워크스페이스의 에이전트는 알림을 읽고 요약만 한다. 알림에는 외부에서 넣을 수 있는 글(이슈 제목, 오류 메시지 등)이 섞일 수 있으므로 알림 내용을 근거로 자동 실행하지 않는다.
- 부수 효과: `/api/healthz`(웹 프록시 → 서버 `/v1/healthz`)가 5분마다 여러 지역에서 오므로 **라이브 리비전의 인스턴스가 대부분 데워진 채로 유지**된다(콜드스타트 체감이 줄어듦, 비용은 무료 구간 안). 그래서 라이브 서비스의 체감 콜드스타트는 아래 실측(새 인스턴스의 첫 요청)보다 드물다. 측정용 태그 리비전에는 영향이 없다(그 URL로는 가동 확인이 가지 않는다).

## 7. 버전 근거

새로 도입한 외부 버전은 이미지 둘이며 둘 다 7일 이상 지난 안정판이다. GitHub Actions 액션은 기존 워크플로와 같은 커밋 SHA 고정을 재사용했다(새 액션 없음). `gcloud`와 `jq`는 GitHub 호스트 러너(ubuntu-latest)에 설치된 것을 쓴다.

| 항목 | 값 | 근거 |
|---|---|---|
| `liquibase/liquibase` | `5.0.4` @ `sha256:060f96ef…` | 2026-08-20 게시([release](https://github.com/liquibase/liquibase/releases/tag/v5.0.4)), 2026-11-24 확인. compose와 동일. 기존 5.x 제외 결정은 [ADR-0003](../adr/0003-liquibase-community-5.md)으로 대체(FSL 수용). 다이제스트는 `docker buildx imagetools inspect`로 확인 |
| `postgres:17.6-alpine`(backup Job 이미지, 다이제스트 고정), `postgres:17.6`(로컬 복원 검증) | `17.6` | S1 노트(2025-08-14, [릴리스 노트](https://www.postgresql.org/docs/17/release-17-6.html)). compose·통합 테스트와 같은 버전 |
| Cloud Run 기능 | startup CPU boost, `--no-traffic --tag`, `--env-vars-file`, `--set-secrets` | [공식 문서](https://cloud.google.com/run/docs/configuring/services/cpu#startup-boost) / [트래픽 관리](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration) |

## 8. 검증 결과

모두 실제 GCP·Supabase에서 실행했다(2026-11-14). 배포는 이 브랜치에서 GitHub Actions로 했다. 새 워크플로는 기본 브랜치에 없어 `workflow_dispatch`가 404여서(GitHub 제약) 첫 검증 동안만 브랜치 `push` 트리거를 임시로 두었고 PR에서는 제거했다.

| 확인 | 결과 |
|---|---|
| 배포 워크플로 전체 | 초록. 이미지 빌드(AppCDS 학습 포함)·푸시 → migrate Job(`Run: 2`, 이후 재실행은 변경 없음) → 산출물 발행 → 후보 리비전(트래픽 0) 스모크 → 전환 → 공개 URL 스모크 → cleanup Job 갱신 |
| 첫 시도 실패와 수정 | 후보 스모크가 `/healthz`에서 404로 실패 → 원인은 Cloud Run 앞단의 `/healthz` 예약(3.9절). 트래픽은 전환되지 않았다(후보 스모크가 막음). 스모크를 `/v1/healthz`로 바꿔 재배포해 통과 |
| 서비스 URL | `https://server-b3z6eb4wma-du.a.run.app` |
| `/v1/healthz`, `/v1/manifest` | 200, `ok` / `dataVersion=20261114.5`(발행 manifest 일치) |
| 추천 1건 | 02f+dd9, 공평 → 후보 3개, 1위 군자 |
| DB 읽기 | 없는 방 `GET /v1/rooms/abcdefghjk` → 404 `ROOM_NOT_FOUND`(500 아님 = Supabase 세션 풀러 연결·스키마 확인) |
| 방 생성·조회·삭제 | 201 → 200 → 204 → 다시 조회 404. 실제 Supabase에 쓰고 방장 토큰으로 바로 지움(토큰 출력 없음) |
| 산출물 버킷 | `manifest.json`(루트)과 `versions/20261114.5/*`(해시 이름 4개). 서버가 GCS에서 읽고 `Application started`까지 확인 |
| `cleanup` Job 수동 실행 | 성공(종료 코드 0). 로그 `cleanup: CleanupReport(rooms=0, anonUsers=0)`, DB 연결·질의 약 0.9초 → DB를 실제로 조회한다 |
| Scheduler 수동 실행 | `gcloud scheduler jobs run cleanup-daily` → Job 실행 성공(Scheduler → Job IAM 확인). 일정 `0 4 * * *` Asia/Seoul |
| (P8a 당시) 백업 워크플로 수동 실행 | 성공(이후 3.6절대로 Cloud Run Job으로 이전, 병합 후 순서로 재검증 예정). 파일 `banbanyeok-<UTC시각>.dump` **14,143 bytes**, 목차 검증 통과(테이블 4개, 항목 31개), 비밀번호가 로그에 없음 |
| 복원 검증 | 받은 실제 백업을 `mise run db:restore-check`로 로컬 Postgres 17에 복원 → 테이블 3개 + `databasechangelog`(changeset 2개) + `participants_limit` 트리거 확인(운영 DB는 아직 비어 있어 행 수는 0) |
| 로컬 사전 검증 | 마이그레이션 이미지(빈 Postgres 17.6, 재실행), 백업→복원(행이 있는 DB), 스모크(로컬 서버), `stage-release` 단위 테스트 4개, 속도 제한 신뢰 헤더 테스트 3개 |
| 정적 검사 | `ktlintCheck ktlintBuildScripts detekt detektBuildLogic`, 서버·파이프라인 테스트 통과. 새 suppress·baseline 없음. `shellcheck`(모든 새 스크립트), `actionlint` 통과 |

### 콜드스타트 실측: 개선 전 기준값(P8a, 개선 후 수치와 비교는 3.10절)

방법과 한계: Cloud Run은 마지막 요청 뒤 **17분이 지나도 인스턴스를 남기는 경우가 많았다**. 17분 간격으로 6번 재는 첫 시도에서는 1번만 진짜 콜드였다(나머지 5번은 웜 0.11~0.14초, 로그의 `Application started`는 1회뿐). 그 1번은 **4.22초**였다. 그래서 같은 이미지로 **리비전 6개**(`COLD_NONCE`만 다른 트래픽 0 리비전, 태그 URL)를 만들고 35분 방치한 뒤 각 태그의 첫 요청을 쟀다. 로그의 `Starting new instance`와 `Application started`가 요청마다 새로 찍혀 6번 모두 새 인스턴스의 첫 요청임을 확인했다(리비전을 새로 만든 첫 요청이라 이미지 레이어가 그 호스트에 없을 수도 있어 실제 콜드와 거의 같거나 약간 불리하다).

| 측정(초, curl total) | n | p50 | p90 | min | max |
|---|---|---|---|---|---|
| **콜드 첫 `/v1/healthz`** | 6 | **3.69** | **4.29** | 3.09 | 4.47 |
| 이어서 첫 DB 읽기(첫 Hikari 연결 + Supabase TLS) | 6 | 0.67 | 0.70 | 0.55 | 0.70 |
| 이어서 추천 1건 | 6 | 0.22 | 0.23 | 0.19 | 0.24 |
| 웜 `/v1/healthz`(기준: 클라이언트 왕복 포함) | 6 | 0.09 | 0.16 | 0.08 | 0.23 |

(첫 시도의 진짜 콜드 1건 4.22초를 합치면 n=7, 3.09~4.47초, p50 3.91초.)

로그로 본 콜드 한 번의 구성(요청 3.63초): 인스턴스 시작 → 첫 앱 로그까지 약 3.1초(컨테이너 기동·JVM·시크릿 주입·**GCS에서 산출물 4개(약 1MB) 읽기와 검증**·Hikari 설정) → Ktor 시작 약 0.4초 → 응답. 스파이크의 Ktor AppCDS p90 1.39초(DB·GCS 없음)보다 약 2.5~3초 더 걸린다. 원인 추정(**미검증**): 아카이브를 로컬 파일 저장소로 학습해서 GCS 클라이언트·인증 클래스가 아카이브에 없다(P3 노트 7절이 예견한 부분), 그리고 시작할 때 산출물 로드가 직렬로 있다. 단계별 시간은 따로 재지 않았다.

해석: 사용자 규칙(콜드 3초 초과·상시 비용이면 재검토)의 기준으로는 **p50이 3초를 넘는다**. 다만 이 수치는 "브라우저가 서버를 처음 깨우는 요청"이고, 설계상 입력 화면이 열릴 때 `/v1/healthz`로 미리 깨우므로 사용자가 체감하는 지연은 (입력하는 시간만큼) 가려진다. min 1은 0원 목표 위반이라 하지 않았다. → 결정 필요 7(수용 / AppCDS 학습에 GCS 경로 포함 후 재측정 / 산출물 지연 로드).

## 9. 결정 필요

P8a에서 올린 9건 중 코디네이터가 정한 것(2026-11-14): 1 WIF → 좁힘(아래), 2·6 방침 문구 → 방침 정리 작업자, 3 백업 60일 정지 → **백업을 Cloud Run Job으로 옮겨 해소**(3.6절), 4 Supabase → 경고 메일이 오면 대응, 5 발행-배포 틈 → 수용, 7 콜드스타트 → **해결**(3.10절, p50 1.87초), 8 SERVER_ORIGIN → `https://server-488867894170.asia-northeast3.run.app` 그대로, 9 갱신 정책 → 확정.

이번 작업의 남은 일과 제안:
1. **병합 후 순서**(이 PR은 라이브를 바꾸는 `bootstrap.sh` 실행이 필요하다): ① PR 병합 → main 배포가 backup 이미지를 AR에 올리고(`db-backup` Job은 아직 없어 "Job 갱신" 단계는 경고 후 건너뜀) 리뷰된 코드로 라이브를 덮는다 → ② `bash infra/gcp/bootstrap.sh` 실행(WIF를 `main` 한정으로 좁힘, `db-backup` Job·Scheduler `db-backup-weekly` 생성, 이전 GitHub 가장 권한 회수) → ③ `gh workflow run deploy-server.yml`(main에서)로 한 번 더 배포해 `db-backup` Job에 backup 이미지를 연결 → ④ `gcloud run jobs execute db-backup --region asia-northeast3 --wait`로 첫 백업을 실행하고 크기·`mise run db:restore-check` 복원을 확인. ②는 처음부터 main 한정이라 이후 브랜치에서 GCP를 쓸 수 없다(배포 검증은 main).
2. **개인정보 방침(별도 작업)**: 백업 수탁자에서 GitHub 행 삭제(3.6절 "바뀐 사실": 서울 Cloud Run Job, 이미지 `postgres:17.6-alpine`, 보존 30일 불변).
3. **작업 실패 알림**: 3.11절의 `infra/gcp/monitoring-jobs.sh`(Job 실행 실패 지표 + Scheduler 로그 알림)은 적용을 마쳤고, 메일과 Slack(6.1절)으로 온다. 주 1회 Job이 아예 안 도는 경우는 못 잡으므로 최신 백업 점검은 유지.
4. 선택 정리: `GcsArtifactStore.warmUp`과 메타데이터 고정 주소(3.10절, 효과 없음)는 다음에 코드를 줄일 때 제거 후보.
