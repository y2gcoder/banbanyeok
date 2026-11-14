# 반반역

> 우리 어디서 만나야 덜 억울할까?

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

골든 데이터를 바꿨다면(알고리즘 변경 포함) `mise run golden:regen`으로 스냅샷·픽스처·링크 벡터를 다시 만들고 **diff를 사람이 검토**한 뒤 커밋합니다. `mise run golden:check`는 파일을 바꾸지 않고 일치만 확인합니다.

### 비밀값

- 값의 원본은 개인 1Password의 `banbanyeok` vault입니다. 저장소에는 `op://` 참조만 있는 [`.env.tpl`](.env.tpl)이 있습니다.
- 비밀값이 필요한 실행만 `op run --env-file=.env.tpl -- <명령>`으로 감쌉니다. 실제 값을 파일에 적지 않습니다.
- 커밋 전 gitleaks 훅(`lefthook.yml`)과 CI(`secrets-scan.yml`)가 키 유출을 막습니다. 설정은 [`.gitleaks.toml`](.gitleaks.toml)입니다.

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
mise run dev:seed               # 예시 방 하나(참가자 3명, 한 명은 출발역 숨김)와 curl 예시를 출력
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
공식 컨테이너에서 SQL changelog를 적용합니다. 운영에서는 같은 이미지와 changelog를 별도 배포
작업으로 실행하고 URL/자격 증명을 Secret Manager에서 주입합니다.
외부 데이터 API나 운영 서비스 연결처럼 비밀값이 필요한 경우에만 개인 1Password를 설정하고
`op run --env-file=.env.tpl -- <명령>`을 사용합니다.
