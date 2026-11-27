# 반반역

> 우리 어디서 만나면 딱 반반일까?

지리적 중간이 아니라 **대중교통 실제 이동 부담**으로 만날 지하철역을 추천합니다.

- 공평하게 / 빨리 만나기 / 오늘은 ○○ 쪽으로 — 세 가지 기준
- 사람별 소요시간·환승 횟수·추천 이유를 그대로 보여줍니다
- 설치·가입 없이 링크로 공유

현재 설계 단계입니다. 결정 사항은 [docs/01-synthesis.md](docs/01-synthesis.md)를 보세요.

## 개발 시작

필요한 것: [mise](https://mise.jdx.dev), Python 3.9 이상, 1Password 데스크톱 앱과 `op` CLI(비밀값이 필요한 작업에만).

```sh
mise install                       # JDK 25(앱·detekt), node 24, pnpm 12, gitleaks, lefthook를 mise.toml 버전대로 설치
cp mise.local.toml.example mise.local.toml   # 선택: 비밀값이 필요하면 개인 1Password 계정 고정
mise run hooks:install             # 커밋 전 gitleaks 검사 훅 설치(한 번만)
mise run doctor                    # JDK·node·pnpm·Docker 및 선택 1Password 확인

./gradlew build                    # 전체 빌드와 테스트(shared 모듈의 commonTest는 jvm으로 실행)
python3 -B -m unittest discover -s prototype -v   # Python 오라클 테스트
mise run test                      # 위 둘을 함께
```

저장소 구조(발췌):

| 경로 | 내용 |
|---|---|
| `contracts/` | 언어 중립 계약: 골든 시나리오·순위 스냅샷·링크 벡터, `openapi.yaml`(웹-서버 계약의 원본), `events.json`, `data-format.md`, `fixtures/` |
| `shared/` | KMP 공유 모듈(`schema`, `core`, `links`, `api-client`, `app-logic`, `analytics`). 타깃은 지금 jvm만 |
| `server/`, `pipeline/` | JVM 앱. 서버는 Ktor 모듈러 모놀리스(`server/{app,room,recommendation,artifact}`, [P3 노트](docs/setup/p3-notes.md)), 파이프라인은 Kotlin CLI |
| `build-logic/` | Gradle 컨벤션 플러그인(`banbanyeok.kotlin-jvm`, `kmp-library`, `server-app`, `cli-app`, …). 버전은 `gradle/libs.versions.toml` |
| `prototype/` | Python 참조 오라클과 계약 파일 생성기 |
| `data/registry/` | 역 코드 레지스트리(append-only). 실제 데이터는 파이프라인이 만든다 |

데이터를 갱신하려면 `mise run data:refresh`를 실행합니다. 파이프라인 `all` 실행 후 웹 역 인덱스를 재생성합니다. 키가 필요한 배차 갱신은 포함하지 않으며 `mise run dev:pipeline -- refresh`로 별도 실행합니다.

부산 원천 파서와 대조 도구는 `pipeline/busan/`에 있습니다. 그래프 PR(PR 3)에서 Kotlin 입력을 구현할 때 Python 대조 결과를 기준으로 검증하는 방안을 제안합니다.

골든 데이터를 바꿨다면(알고리즘 변경 포함) `mise run golden:regen`으로 스냅샷·픽스처·링크 벡터를 다시 만들고 **diff를 사람이 검토**한 뒤 커밋합니다. `mise run golden:check`는 파일을 바꾸지 않고 일치만 확인합니다.

### 비밀값

- 값의 원본은 개인 1Password의 `banbanyeok` vault입니다. 저장소에는 `op://` 참조만 있는 [`.env.tpl`](.env.tpl)이 있습니다.
- 비밀값이 필요한 실행만 `op run --env-file=.env.tpl -- <명령>`으로 감쌉니다. 실제 값을 파일에 적지 않습니다.
- 커밋 전 gitleaks 훅(`lefthook.yml`)과 CI(`secrets-scan.yml`)가 키 유출을 막습니다. 설정은 [`.gitleaks.toml`](.gitleaks.toml)입니다.

### 에이전트 작업자(코디네이터용)

GitHub 이슈를 구현·검증·교차 리뷰까지 진행하려면 Orca의 반반역 코디네이터에게 `software-factory #<이슈 번호>`를 요청합니다. `software-factory inspect #<이슈 번호>`는 진행 상태만 확인합니다. [소프트웨어 공장 스킬](.claude/skills/software-factory/SKILL.md)

Claude Code 작업자는 poteto-mode로 일합니다([AGENTS.md](AGENTS.md) '작업 관례'). 개인 `home` 레포 체크아웃이 있는 코디네이터는 그 레포의 `.claude/skills/orca-poteto-worker/SKILL.md`를 열고 `start.sh`로 작업자를 띄웁니다. 작업할 반반역 워크트리에서 실행하고 처음에는 `--dry-run`으로 대상과 명령을 확인합니다.

직접 띄울 때는 Orca에서 Claude Code를 `--surface terminal --json`으로 열고, 첫 입력에 `/pstack:poteto-mode <대기 지시>`를 보냅니다. 대기 지시에는 다음 메시지가 올 때까지 작업을 시작하지 말고 대기하라고 적습니다. Orca는 작업 지시서 앞에 안내문을 붙이므로 poteto-mode는 첫 터미널 입력에서 켜야 합니다. `--json` 응답에서 받은 핸들의 터미널이 `tui-idle`이 된 후, 같은 핸들을 `orca orchestration worker-start --terminal`에 넘겨 작업 지시를 보냅니다.

## 라이선스

코드는 [AGPL-3.0](LICENSE)입니다. 공공데이터 출처는 [data/ATTRIBUTION.md](data/ATTRIBUTION.md)를 보세요.

## 로컬 실행

사전 요구: Docker(Compose v2 포함, 실행 중), [mise](https://mise.jdx.dev), Python 3.9 이상.
일반 로컬 실행에는 1Password 로그인이나 `.env` 파일이 필요하지 않습니다.

```sh
mise run setup                 # 최초 한 번: 도구, pnpm 의존성, 훅
mise run doctor                # Docker 확인; 1Password는 선택 검사
mise run dev                   # db → migrate → seed → server + web
# 각각 실행하려면:
mise run dev:db
mise run dev:migrate
mise run dev:seed               # 예시 방 하나(참가자 3명, 새로 숨길 수 없어 모두 출발역 공개)와 curl 예시를 출력
mise run dev:server             # :server:app:run. compose DB + data/artifacts/dev로 실제 동작(/healthz, /v1/...)
mise run dev:web                # web/이 없으면 안내 후 종료
mise run dev:web:mock           # web/이 없으면 안내 후 종료
mise run dev:db -- down         # 컨테이너/네트워크 정리 (볼륨 보존)
mise run dev:db -- down -v      # 로컬 DB 데이터까지 삭제

./gradlew check                 # 단위 테스트 + ktlint + detekt + Konsist
./gradlew integrationTest       # Docker를 사용하는 통합 테스트(실제 Postgres, GCS 에뮬레이터, API 흐름)
bash scripts/build-server-image.sh   # 서버 배포 이미지(linux/amd64, AppCDS 학습 포함) 로컬 빌드
./gradlew ktlintFormat          # 포맷 수정
```

`bash scripts/dev.sh config`로 현재 프로젝트 이름과 포트를 확인합니다.
디렉토리 전체 경로의 체크섬에서 Compose 이름·볼륨·네트워크와 기본 포트를 파생하므로
다른 worktree를 동시에 실행할 수 있습니다. 체크섬 포트 충돌이나 다른 프로그램의 점유 시
`DB_PORT`, `SERVER_PORT`, `WEB_PORT` 환경 변수로 덮어씁니다(기본 범위 각각 20000–29999,
30000–39999, 40000–49999). 직접 `docker compose`를 쓸 때에는 먼저
`source scripts/dev-env.sh`를 실행합니다. DB는 localhost에만 노출합니다.

Postgres 기본값은 17 메이저의 고정 안정판 17.6이며 `POSTGRES_VERSION`으로 운영 후보와 맞춥니다.
로컬 DB 계정은 compose.yaml의 개발 전용 공개 값입니다. Liquibase는 서버 시작과 분리해
공식 Community 5.0.4 이미지에 PostgreSQL JDBC 42.7.14를 고정한 컨테이너에서 SQL changelog를 적용합니다.
로컬 compose와 운영은 `server/db/Dockerfile`을 함께 빌드합니다(FSL 수용: [ADR-0003](docs/adr/0003-liquibase-community-5.md)). 운영에서는 같은 이미지와 changelog를 별도 배포
작업으로 실행하고 URL/자격 증명을 Secret Manager에서 주입합니다.
외부 데이터 API나 운영 서비스 연결처럼 비밀값이 필요한 경우에만 개인 1Password를 설정하고
`op run --env-file=.env.tpl -- <명령>`을 사용합니다.

## 배포

### 웹 (Cloudflare Workers + OpenNext)

`.github/workflows/deploy-web.yml`이 배포합니다: 빌드(`pnpm cf:build`) → 정적 캐시 채우기(`populateCache`) → `wrangler deploy` → 배포 주소 스모크 테스트.
main에서 `web/`·`contracts/`·`data/artifacts/`가 바뀌면 자동으로, 그 밖에는 Actions 탭의 **Run workflow**(수동)로 돕니다. 동시 배포는 막습니다(`concurrency`).
공개 주소는 https://banbanyeok.app 입니다(`www`와 `*.workers.dev`는 이 주소로 301 이동).

저장소에 있어야 하는 설정(값은 문서에 적지 않습니다):

| 종류 | 이름 | 용도 |
|---|---|---|
| secret | `CLOUDFLARE_API_TOKEN` | Workers 배포(Edit Cloudflare Workers 템플릿, 도메인 연결을 위해 All zones) |
| secret | `PROXY_SHARED_SECRET` | 서버와 같은 값. Worker secret으로 주입돼 `/api/*` 프록시가 서버에 `X-Banbanyeok-Proxy-Secret`로 보냄 |
| variable | `CLOUDFLARE_ACCOUNT_ID` | 배포 계정 |
| variable | `POSTHOG_PROJECT_KEY`, `POSTHOG_HOST` | 빌드 때 번들에 박히는 공개 통계 키·수집 호스트(동의 전에는 로드하지 않음) |
| variable | `KAKAO_JS_KEY` | 빌드 때 번들에 박히는 카카오 JavaScript 키(공개 값). 있으면 "카톡으로 보내기"가 카카오톡 공유 API로 보내고(SDK는 공유 칸이 화면에 보일 때 받고 내용 없는 확인을 받아 둠, 메시지 내용은 누를 때만 감), 없으면 시스템 공유 시트. 배포 스모크가 카카오가 이 키와 배포 도메인을 받는지 확인한다 |
| variable | `SERVER_ORIGIN` | 서버(Cloud Run) 출처. 비어 있으면 API 없이 배포하고 사이트 전체를 noindex로 둠 |
| variable | `SITE_DOMAIN` | 정식 도메인(호스트만). 있으면 Workers Custom Domain(apex + www)으로 붙고 `SITE_URL`(OG·sitemap·canonical)이 여기서 나옴 |

로컬에서 배포 빌드를 확인하려면(배포는 하지 않음):

```sh
cd web
SITE_URL=https://example.com pnpm cf:build
pnpm exec opennextjs-cloudflare populateCache local
printf 'API_ORIGIN=http://127.0.0.1:8080\nPROXY_SHARED_SECRET=local\n' > .dev.vars   # gitignore됨
pnpm exec wrangler dev
```

세부(프록시 규칙, 보안 헤더, 크기·CPU 실측, 결정 필요)는 [docs/setup/p8b-notes.md](docs/setup/p8b-notes.md).

### 서버·DB (Cloud Run + Supabase)

서버는 Cloud Run(서울, min 0), DB는 Supabase 무료(세션 풀러), 데이터 산출물은 GCS 버킷에 발행합니다. 자세한 구성·권한 표·결정은 [docs/setup/p8a-notes.md](docs/setup/p8a-notes.md).

```sh
bash infra/gcp/bootstrap.sh                    # 최초 한 번(프로젝트 owner): 저장소·서비스 계정·버킷·최소 권한·Scheduler. 멱등. DRY_RUN=1이면 출력만
gh workflow run deploy-server.yml              # 배포: 이미지 → migrate Job → 산출물 발행 → 후보 리비전 스모크 → 전환 → cleanup Job
bash scripts/smoke-server.sh <서비스 URL>      # healthz·manifest·추천·방 생성/조회/삭제 확인 (Cloud Run에서는 /v1/healthz, /healthz는 앞단이 예약)
gh workflow run db-backup.yml                  # DB 백업을 지금 실행(서울 Cloud Run Job db-backup 실행·대기. 주 1회는 Scheduler 자동). 복원 검증: mise run db:restore-check -- <덤프>
mise run release:stage                         # 산출물을 발행 형식(해시 이름 + manifest)으로 build/release에 만든다
mise run data:refresh-headways                 # 배차 간격 실제 값 갱신(op 필요) → 웹 생성물까지
```

배포 워크플로가 필요로 하는 저장소 변수(비밀 아님): `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_ARTIFACT_BUCKET`, `DATABASE_URL`, `DATABASE_USER`. 비밀번호·토큰 pepper·프록시 공유 비밀은 Secret Manager에만 있고 런타임이 직접 읽습니다.
