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
mise install                       # JDK 25(Temurin), node 24, pnpm 12, gitleaks, lefthook를 mise.toml 버전대로 설치
cp mise.local.toml.example mise.local.toml   # 개인 1Password 계정을 OP_ACCOUNT로 고정(gitignore 대상)
mise run hooks:install             # 커밋 전 gitleaks 검사 훅 설치(한 번만)
mise run doctor                    # JDK·node·pnpm 버전과 1Password 개인 계정 확인

./gradlew build                    # 전체 빌드와 테스트(shared 모듈의 commonTest는 jvm으로 실행)
python3 -B -m unittest discover -s prototype -v   # Python 오라클 테스트
mise run test                      # 위 둘을 함께
```

저장소 구조(발췌):

| 경로 | 내용 |
|---|---|
| `contracts/` | 언어 중립 계약: 골든 시나리오·순위 스냅샷·링크 벡터, `openapi.yaml`(웹-서버 계약의 원본), `events.json`, `data-format.md`, `fixtures/` |
| `shared/` | KMP 공유 모듈(`schema`, `core`, `links`, `api-client`, `app-logic`, `analytics`). 타깃은 지금 jvm만 |
| `server/`, `pipeline/` | JVM 앱. 서버 프레임워크는 아직 미정(자리표시), 파이프라인은 Kotlin CLI |
| `build-logic/` | Gradle 컨벤션 플러그인(`banbanyeok.kotlin-jvm`, `kmp-library`, `server-app`, `cli-app`, …). 버전은 `gradle/libs.versions.toml` |
| `prototype/` | Python 참조 오라클과 계약 파일 생성기 |
| `data/registry/` | 역 코드 레지스트리(append-only). 실제 데이터는 파이프라인이 만든다 |

골든 데이터를 바꿨다면(알고리즘 변경 포함) `mise run golden:regen`으로 스냅샷·픽스처·링크 벡터를 다시 만들고 **diff를 사람이 검토**한 뒤 커밋합니다. `mise run golden:check`는 파일을 바꾸지 않고 일치만 확인합니다.

### 비밀값

- 값의 원본은 개인 1Password의 `banbanyeok` vault입니다. 저장소에는 `op://` 참조만 있는 [`.env.tpl`](.env.tpl)이 있습니다.
- 비밀값이 필요한 실행은 `mise run dev:server`처럼 `op run`으로 감싼 태스크를 씁니다. 실제 값을 파일에 적지 않습니다.
- 커밋 전 gitleaks 훅(`lefthook.yml`)과 CI(`secrets-scan.yml`)가 키 유출을 막습니다. 설정은 [`.gitleaks.toml`](.gitleaks.toml)입니다.

## 라이선스

코드는 [AGPL-3.0](LICENSE)입니다. 공공데이터 출처는 [data/ATTRIBUTION.md](data/ATTRIBUTION.md)를 보세요.
