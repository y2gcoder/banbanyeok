# P8a 서버·DB 배포 작업 노트 (Cloud Run + Supabase + GCS)

작성 2026-11-14. 우선순위 문서: [01-synthesis](../01-synthesis.md) → [S1 노트](s1-notes.md) → [P3 노트](p3-notes.md)(7·8·9절). 웹(Cloudflare)은 P8b 범위다.

## 1. 구성

```
GitHub Actions ──(OIDC/WIF, 키 없음)──▶ github-deployer ─┬─▶ Artifact Registry  server/server, server/migrate (최근 3개)
  deploy-server.yml                                       ├─▶ Cloud Run Job  migrate  (Liquibase, db-migrator 계정)
                                                          ├─▶ GCS 산출물 버킷  versions/<버전>/<종류>.<해시16>.<확장자> + manifest.json
                                                          └─▶ Cloud Run 서비스 server (server-runtime 계정, min 0)
Cloud Scheduler cleanup-daily (04:00 KST) ─▶ Cloud Run Job cleanup (서버 이미지 + 인자 cleanup) ─▶ Supabase(세션 풀러)
GitHub Actions db-backup.yml (주 1회+수동, db-backup 계정) ─▶ pg_dump 17 ─▶ gs://…-backups/db/ (비공개, 30일 후 삭제)
```

| 리소스 | 이름 | 비고 |
|---|---|---|
| 프로젝트·리전 | `banbanyeok-7eoxn` · `asia-northeast3` | |
| Artifact Registry | `server` (docker) | 이미지 `server`, `migrate`. 정리 정책: 이미지별 최근 3개 유지, 나머지 삭제 |
| Cloud Run 서비스 | `server` | 1 vCPU · 512Mi · 동시성 40 · max 2 · min 0 · startup CPU boost · gen2 · 공개 호출 |
| Cloud Run Job | `migrate`, `cleanup` | `migrate`: 1 vCPU·1Gi·재시도 0. `cleanup`: 서버 이미지, 재시도 1 |
| Cloud Scheduler | `cleanup-daily` | `0 4 * * *` Asia/Seoul → `cleanup:run` |
| 서비스 계정 | `server-runtime`, `db-migrator`, `db-backup`, `scheduler-invoker`, `github-deployer`(기존) | 아래 권한 표 |
| 버킷 | `…-artifacts`(기존), `…-backups`(신규) | 둘 다 비공개(공개 접근 차단 강제), 균일 접근 |

## 2. 부여한 권한 (누가·무엇에·왜)

프로젝트 수준 `owner`/`editor`는 아무에게도 주지 않았다. 프로젝트 수준 바인딩은 `github-deployer`의 `serviceUsageConsumer` 하나뿐이다(gcloud가 프로젝트의 API를 호출하려면 필요한 "API 사용" 권한이며 리소스 권한이 없다). 나머지는 모두 리소스(서비스·Job·비밀·버킷·저장소·계정) 단위다. 서비스 계정 키(JSON)는 만들지 않았다.

| 주체 | 역할 | 대상(리소스) | 왜 |
|---|---|---|---|
| `server-runtime` | `secretmanager.secretAccessor` | 비밀 `database-password`, `token-pepper` | 서비스·cleanup Job이 시작할 때 DB 비밀번호와 토큰 pepper를 읽는다 |
| `server-runtime` | `storage.objectViewer` | 버킷 `…-artifacts` | 서버가 시작할 때 manifest와 산출물을 읽는다(쓰기 없음) |
| `db-migrator` | `secretmanager.secretAccessor` | 비밀 `database-password` | migrate Job이 Liquibase 비밀번호만 읽는다(pepper 접근 없음) |
| `db-backup` | `secretmanager.secretAccessor` | 비밀 `database-password` | 백업 워크플로가 pg_dump 비밀번호를 읽는다 |
| `db-backup` | `storage.objectCreator`, `storage.objectViewer` | 버킷 `…-backups` | 덤프를 올리고 크기를 확인한다. **삭제·덮어쓰기 권한 없음**(삭제는 수명 주기 규칙만) |
| `db-backup` ← GitHub OIDC | `iam.workloadIdentityUser` | 계정 `db-backup` | 배포 계정과 **분리**: 배포 워크플로가 DB 비밀번호를 읽을 수 없고, 백업 워크플로가 배포할 수 없다. 주체 집합은 `github-deployer`와 같은 저장소 ID 조건 |
| `github-deployer` | `run.developer` | 서비스 `server`, Job `migrate`, Job `cleanup` | 리비전·Job 배포, Job 실행·대기, 트래픽 전환. 서비스 IAM 정책 변경(`setIamPolicy`)은 불가 |
| `github-deployer` | `artifactregistry.writer` | 저장소 `server` | 이미지 푸시 |
| `github-deployer` | `storage.objectUser` | 버킷 `…-artifacts` | 산출물 발행(생성·덮어쓰기)과 오래된 버전 정리(삭제) |
| `github-deployer` | `iam.serviceAccountUser` | 계정 `server-runtime`, `db-migrator` | 리비전·Job에 실행 계정을 지정(actAs) |
| `github-deployer` | `serviceusage.serviceUsageConsumer` | 프로젝트 | gcloud/클라이언트가 프로젝트 API를 호출 |
| `scheduler-invoker` | `run.invoker` | Job `cleanup` | Cloud Scheduler가 이 Job만 실행 |
| `allUsers` | `run.invoker` | 서비스 `server`만 | 비회원 공개 API(인증은 앱의 익명 토큰) |

알아 둘 점
- **WIF 조건은 저장소 ID뿐**이라 이 저장소의 모든 워크플로·브랜치가 `github-deployer`와 `db-backup`을 가장할 수 있다(퍼블릭 저장소이지만 쓰기 권한이 있는 사람만 워크플로를 바꿀 수 있고, 포크의 PR은 OIDC 토큰을 받지 못한다). 더 좁히려면 공급자 속성 조건에 `assertion.ref == 'refs/heads/main'`이나 GitHub Environment(필수 승인자)를 추가한다. 이번 검증은 브랜치에서 배포해야 해서 넣지 않았다 → 결정 필요 1.
- 프로젝트 기본 Compute 서비스 계정에는 GCP 기본값으로 `roles/editor`가 붙어 있다. 우리 서비스·Job은 모두 `server-runtime`/`db-migrator`를 명시해서 쓰므로 영향이 없지만, 다른 리소스를 만들 때 기본 계정을 쓰지 않도록 주의한다(필요하면 editor를 회수).
- 자리표시 서비스·Job을 부트스트랩이 먼저 만드는 이유: 리소스 단위 IAM은 리소스가 있어야 걸 수 있고, 배포 계정에는 프로젝트 전체 `run.admin`을 주지 않기 위해서다.

## 3. 결정과 근거

### 3.1 마이그레이션: 서버 이미지에 `migrate` 하위 명령을 넣지 않고 전용 이미지로 (근거 있는 변경)

`server/db/Dockerfile`: 로컬 compose와 **같은 공식 `liquibase/liquibase:4.33.0`(다이제스트 고정)** 위에 `server/db/changelog`만 얹는다. Cloud Run Job `migrate`가 환경 변수(`LIQUIBASE_COMMAND_URL/USERNAME`, 비밀번호는 Secret Manager 참조)로 실행한다.

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

`deploy-server.yml`: 인증 → 서버 이미지(AppCDS 학습 포함)·마이그레이션 이미지 빌드·푸시 → `migrate` Job 갱신·실행·대기 → 산출물 발행 → **후보 리비전을 트래픽 0·태그 `candidate`로 배포** → 후보 URL에서 스모크(`scripts/smoke-server.sh`: healthz, manifest 버전, 추천 1건, 없는 방 404로 DB 읽기, 방 생성·조회·삭제로 DB 쓰기·pepper) → 트래픽 전환 → 공개 URL 재확인 → `cleanup` Job 갱신. 후보 스모크가 실패하면 트래픽이 바뀌지 않는다. 전환 뒤 확인이 실패하면 직전 리비전으로 되돌린다. 동시 실행은 `concurrency: deploy-server`(대기, 취소 없음)로 막는다.

트리거: `workflow_dispatch` + main 푸시 중 `server/**`(changelog 포함)·`contracts/**`·`shared/**`·`build-logic/**`·`gradle/**`·`data/artifacts/dev/**`·발행 스크립트·워크플로 자신. 새 데이터 발행은 새 리비전을 낸다(P3 8절 권고 1: 리비전이 곧 데이터 버전).

주의: 산출물을 발행(manifest 교체)한 뒤 배포가 실패하면, **이전 리비전의 새 인스턴스**가 새 manifest를 읽을 수 있다(시작 때 manifest를 읽기 때문). 형식 호환(`schemaVersion`)은 서버가 검증하고 실패하면 시작하지 않는다. 스모크 전에 발행하는 순서라서 생기는 틈이며, 위험이 작다고 보고 두었다 → 결정 필요 5.

### 3.4 산출물 발행

`./gradlew :pipeline:run --args="stage-release build/release"`(`mise run release:stage`)가 `data/artifacts/dev`(검증을 통과한 dev 산출물)를 **계약 형식**(contracts/data-format.md §4.3, §5)으로 바꾼다: `versions/<dataVersion>/<종류>.<sha256 앞 16자>.<확장자>`(예: `od.7ba35164a95367c8.bin`) + 그 경로를 가리키는 `manifest.json`. dev manifest는 평평한 경로(`od.bin`)라서 이 변환 단계가 필요하다. 내용(해시·길이)은 그대로이고, 변환 결과를 서버와 같은 `DataSetLoader`로 다시 검증한 뒤 manifest를 **마지막에** 쓴다(단위 테스트 4개).

`scripts/publish-artifacts.sh <버킷> build/release 10`이 업로드한다: ① 해시 이름 파일(불변, `--no-clobber`, `Cache-Control: immutable`) → ② `manifest.json`(마지막, `no-cache`; GCS 객체 덮어쓰기는 원자적) → ③ 올라간 manifest 대조와 파일 수 확인 → ④ 최근 10개 버전만 남기고 정리(현재 버전은 절대 삭제하지 않음). 이미 같은 manifest면 건너뛰고, 버킷의 `dataVersion`이 더 새로우면 거부한다(오래된 브랜치 배포가 데이터를 되돌리는 사고 방지, 롤백은 `FORCE=1`). 서버 prod는 `ARTIFACT_GCS_BUCKET`의 `manifest.json`(접두사 없음)을 읽고 경로를 키로 그대로 읽으므로 형식이 맞다(통합 확인은 8절).

보관 10개의 근거: 방은 최대 30일(데이터 버전이 방에 기록됨)이고 산출물은 한 버전이 약 1MB라 보관 비용이 사실상 0이다.

### 3.5 매일 정리와 Supabase 깨우기

`cleanup` Job = 서버 이미지 + 인자 `cleanup`. 만료된 방(참여자는 CASCADE)과 90일 비활동 익명 사용자를 지운다. **실제 DB 질의가 나간다**: `rooms`·`anon_users` 테이블에 대한 DELETE 두 문장(만료 인덱스 사용). DB에 닿지 못하면 JVM이 비정상 종료해 Job 실행이 실패로 기록된다(조용히 끝나지 않음).

Supabase 무료는 "7일간 활동이 적으면" 일시정지된다. [공식 문서](https://supabase.com/docs/guides/platform/free-project-pausing)는 "하루에 사용자 요청 몇 건이면 보통 충분"이라고만 하고 정확한 기준을 공개하지 않는다. 상수만 돌려주는 RPC 호출은 활동으로 안 잡힌 사례가 커뮤니티에 있다([토론](https://github.com/orgs/supabase/discussions/53090), 공식 답변 아님). 우리의 DELETE는 실제 테이블 질의이므로 보완 없이 깨우기 역할을 한다고 판단하지만 **보장은 아니다**. 안전망은 (a) 실제 사용자 트래픽, (b) 정지 약 1주 전 소유자에게 오는 경고 메일, (c) 필요하면 Scheduler 일정을 하루 2회로 늘리는 것(무료 3개 한도 안). → 결정 필요 4.

개인정보 방침 4항의 "만료 후 5일 이내 삭제"와 맞다(매일 1회).

### 3.6 백업: GitHub Actions 예약 워크플로를 택함 (Cloud Run Job 대신)

`db-backup.yml`(월요일 03:17 KST + 수동) → `scripts/db-backup.sh`: Postgres 17.6 클라이언트(`postgres:17.6` 이미지)로 `pg_dump --format=custom --no-owner --no-privileges --schema=public` → 목차 검증(서비스 테이블 3개 + `databasechangelog`) → `gs://…-backups/db/banbanyeok-<UTC시각>.dump`. 비밀번호는 Secret Manager에서 읽어 한 스텝의 셸 변수에만 두고 `::add-mask::`로 가리며 환경 변수 이름만 docker에 넘긴다(명령행·로그에 없음). Supabase의 다른 스키마(auth, storage 등)는 우리 데이터가 아니라서 `public`만 받는다.

Actions를 택한 이유: 이미지를 따로 만들거나 Docker Hub 이미지를 AR로 미러링할 필요가 없고, `pg_dump -Fc`는 되감기(seek)가 필요해 Cloud Storage FUSE에 바로 쓸 수 없어 Job 쪽이 더 복잡하다. 대가는 **공개 저장소는 60일간 활동이 없으면 예약 워크플로가 자동 비활성화**된다는 점이다(조용히 멈춤). 저장소에 커밋이 계속 있으면 문제없고, 백업 최신 파일 시각을 가끔 확인하거나 이후 Cloud Scheduler로 옮길 수 있다 → 결정 필요 3.

보존: 버킷 수명 주기로 30일 후 삭제, soft delete 끔(삭제한 백업이 7일 더 남지 않게). 백업에는 개인정보(출발역, 이름, 토큰 해시)가 있으므로 비공개 버킷(공개 접근 차단 강제)에만 두고 `db-backup` 계정에만 쓰기·읽기를 준다.

**복원 절차**
1. 백업 고르기: `gcloud storage ls -l gs://banbanyeok-7eoxn-backups/db/`, 받기: `gcloud storage cp gs://banbanyeok-7eoxn-backups/db/<파일> .`
2. 로컬 검증(운영 DB를 건드리지 않음): `mise run db:restore-check -- <파일>` — 임시 Postgres 17 컨테이너에 복원하고 테이블·행 수(값은 출력하지 않음)·Liquibase 이력·트리거를 확인한 뒤 컨테이너를 지운다.
3. 실제 복구(새 DB 또는 비운 DB에): `pg_restore --no-owner --no-privileges --exit-on-error -d "<연결>" <파일>`. 대상에 이미 `public` 스키마가 있으면 `CREATE SCHEMA public` 한 건만 실패하므로 `--exit-on-error`를 빼거나 빈 `public`을 먼저 `DROP SCHEMA public`한다. 복구 뒤 서버의 `DATABASE_URL`·`DATABASE_USER`(저장소 변수)와 비밀번호(Secret Manager)를 새 DB로 바꾸고 재배포한다. Liquibase 이력 테이블이 같이 복원되므로 `migrate`는 변경 없이 끝난다.
4. 부분 복구(방 하나 등)는 로컬에 복원한 뒤 필요한 행을 `COPY`/`INSERT`로 옮긴다.

**개인정보 방침과 어긋나는 점(결정 필요 2)**: 방침 4항의 "데이터베이스 백업 | {백업 보존 기간}"은 비어 있고, 같은 항에서 "요청하면 지체 없이 삭제"를 약속한다. 백업은 30일 보관이므로 ① 방침에 `백업 보존 기간: 30일`을 적고 ② 삭제 요청·만료로 DB에서 지운 정보가 **백업에는 최대 30일 남는다**(방은 최대 30일 + 정리 5일 이내 삭제 → 가장 긴 경우 DB 밖에서 최대 약 65일 보관)는 문장을 넣을지 정해야 한다. 방침은 직접 고치지 않았다.

### 3.7 배차 갱신 태스크 (7번)

`mise run data:refresh-headways` = `scripts/refresh-headways.sh`: `op` 설치·로그인 확인(명확한 오류) → `data/raw/kric.xlsx`가 없으면 `fetch`(키 불필요; `all`과 같은 기준)로 원본을 먼저 받음 → `op run --env-file=.env.tpl -- ./gradlew :pipeline:run --args=refresh`(build→validate 포함) → `web/node_modules`가 없으면 설치 → `pnpm --filter web gen`. 새 worktree에서 `fetch`는 `data/config/source-manifest.json`의 수집 기록을 갱신하므로 diff를 검토한다. `mise run data:refresh`(키 없음)는 그대로다.

## 4. 레이트 리밋 키 권고 (8번)

문제: 웹은 Cloudflare 뒤에서 서버 API를 **같은 출처 rewrite**로 부른다. Cloud Run이 직접 연결로 보는 상대는 Cloudflare 쪽이고, 그 앞단(GFE)이 붙이는 `X-Forwarded-For`의 **마지막 값**이 그 직접 연결의 IP다.

조사한 사실
- Cloud Run: 앞단이 `X-Forwarded-For`에 직접 연결 IP를 **덧붙인다**. 클라이언트가 보낸 값은 그 앞에 남으므로 **마지막 항목만 신뢰**할 수 있다(앞의 항목은 위조 가능).
- Ktor의 `request.local.remoteAddress`는 GFE 내부 주소라 `peer`(기본값)로 두면 **모든 사용자가 한 버킷**을 공유한다. 그래서 배포 워크플로는 기본값을 `xff-last`로 설정한다(`RATE_LIMIT_CLIENT_IP_SOURCE` 저장소 변수로 덮어쓸 수 있음).
- Cloudflare: `CF-Connecting-IP`는 Cloudflare가 원 사용자 IP로 설정한다([공식](https://developers.cloudflare.com/fundamentals/reference/http-headers/)). Workers의 외부(비 Cloudflare 고객) 서브요청에서는 **Worker 스크립트가 클라이언트 IP 헤더를 통제**하고, 원 요청 헤더를 그대로 넘기면 같은 값이 간다.

권고 (P8b에서 구현, 서버 코드는 작음)
1. **키 = 신뢰된 에지가 넘긴 클라이언트 IP, 신뢰 근거 = 공유 비밀 헤더.** rewrite를 하는 Worker/OpenNext가 요청마다 `X-Edge-Secret: <비밀>`(Wrangler secret)과 `X-Client-IP: <CF-Connecting-IP>`를 붙인다. 서버는 비밀이 일치할 때만 `X-Client-IP`를 키로 쓰고, 아니면 `xff-last`로 되돌아간다. 비밀이 틀리거나 없으면 값을 무시하므로 Cloud Run URL을 직접 부르는 공격자가 헤더를 위조해 한도를 우회할 수 없다(자기 IP 한도에 걸림).
2. 헤더 이름만 믿는 `header:CF-Connecting-IP` 설정은 **쓰지 않는다**: Cloud Run은 공개 호출이 가능해서 누구나 그 헤더를 보낼 수 있다.
3. 대안: Cloud Run ingress를 막고(내부+LB) Cloudflare만 통과시키는 방법은 외부 HTTPS LB가 상시 비용(월 약 $18)이라 0원 목표에 어긋난다. 비밀 헤더 방식이 비용 0이다.
4. 한계: 속도 제한은 인스턴스 메모리라 인스턴스당 따로 센다(최대 2대). 사용자 IP 대신 Cloudflare 에이전트 IP를 쓰는 폴백(`xff-last`)에서는 같은 Cloudflare 출구 IP를 쓰는 사용자들이 버킷을 공유할 수 있다.

이번 PR의 서버 코드는 바꾸지 않았다. 배포는 `xff-last`로 안전하게 시작한다.

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
# 백업 수동 실행 / 목록
gh workflow run db-backup.yml; gcloud storage ls -l gs://banbanyeok-7eoxn-backups/db/
# 이전 리비전으로 즉시 롤백
gcloud run revisions list --service server --region asia-northeast3
gcloud run services update-traffic server --region asia-northeast3 --to-revisions <리비전>=100
# 데이터 롤백(이전 manifest 재발행): 이전 커밋에서 stage-release 후 FORCE=1 bash scripts/publish-artifacts.sh <버킷>
```

## 7. 버전 근거

새로 도입한 외부 버전은 이미지 둘이며 둘 다 7일 이상 지난 안정판이다. GitHub Actions 액션은 기존 워크플로와 같은 커밋 SHA 고정을 재사용했다(새 액션 없음). `gcloud`와 `jq`는 GitHub 호스트 러너(ubuntu-latest)에 설치된 것을 쓴다.

| 항목 | 값 | 근거 |
|---|---|---|
| `liquibase/liquibase` | `4.33.0` @ `sha256:e116c935…` | S1 노트의 Liquibase 4.33.0(2025-07-09, [release](https://github.com/liquibase/liquibase/releases/tag/v4.33.0)). compose와 동일. 5.x는 라이선스가 바뀌어 제외(카탈로그 주석). 다이제스트는 `docker buildx imagetools inspect`로 확인 |
| `postgres` (pg_dump 클라이언트·복원 검증) | `17.6` | S1 노트(2025-08-14, [릴리스 노트](https://www.postgresql.org/docs/17/release-17-6.html)). compose·통합 테스트와 같은 버전 |
| Cloud Run 기능 | startup CPU boost, `--no-traffic --tag`, `--env-vars-file`, `--set-secrets` | [공식 문서](https://cloud.google.com/run/docs/configuring/services/cpu#startup-boost) / [트래픽 관리](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration) |

## 8. 검증 결과

(실제 배포 후 채움)

## 9. 결정 필요

(배포 후 확정)
