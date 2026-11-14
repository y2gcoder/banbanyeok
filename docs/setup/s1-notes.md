# S1 개발 기반 작업 노트

검증일: 2026-11-14. 커밋/푸시하지 않았으며 다음 검토자가 서명 커밋한다.

## 결정과 공식 출처

새 의존성은 최신판 추종보다 안정성과 7일 숙성 조건을 우선했다. 아래 공식 release API의 published_at을 확인했다.

| 도구 | 고정 버전 / 게시일 | 출처 |
|---|---|---|
| ktlint Gradle | 14.1.0 / 2026-03-05 | https://github.com/JLLeitschuh/ktlint-gradle/releases/tag/v14.1.0 |
| ktlint | 1.7.1 / 2025-07-21 | https://github.com/ktlint/ktlint/releases/tag/1.7.1 |
| detekt CLI | 1.23.8 / 2025-02-21 | https://github.com/detekt/detekt/releases/tag/v1.23.8 |
| Kotest | 6.0.4 / 2025-10-15 | https://github.com/kotest/kotest/releases/tag/v6.0.4 |
| MockK | 1.14.6 / 2025-10-01 | https://github.com/mockk/mockk/releases/tag/1.14.6 |
| Testcontainers | 1.21.3 / 2025-06-28 | https://github.com/testcontainers/testcontainers-java/releases/tag/1.21.3 |
| Konsist | 0.17.3 / 2024-12-08 | https://github.com/LemonAppDev/konsist/releases/tag/v0.17.3 |
| Liquibase | 4.33.0 / 2025-07-09 | https://github.com/liquibase/liquibase/releases/tag/v4.33.0 |
| PostgreSQL JDBC | 42.7.8 / 2025-09-18 | https://github.com/pgjdbc/pgjdbc/releases/tag/REL42.7.8 |
| Temurin (detekt 전용) | 21.0.9+10 / 2025-10-23 | https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.9%2B10 |
| Postgres | 17.6 / 2025-08-14 | https://www.postgresql.org/docs/17/release-17-6.html |

ktlint는 JVM/KMP source set과 Gradle Kotlin script 지원, check 연결, 증분 실행을 제공하는
JLLeitschuh 플러그인을 선택했다. `.editorconfig`가 포맷의 단일 규칙이며
lefthook는 변경된 Kotlin 파일만 단일 ktlint CLI 프로세스에 전달하고 앱 컴파일/테스트는 실행하지 않는다.
루트/build-logic 스크립트도 같은 CLI 버전과 .editorconfig로 검사한다.
공식 사용법: https://github.com/JLLeitschuh/ktlint-gradle

detekt 안정판은 Kotlin 2.0 컴파일러를 내장해 JDK 25에서 `JavaVersion.parse: 25.0.5`로 실패했다.
실험판 2.0을 쓰는 대신 안정판 CLI를 JavaExec로 JDK 21에 격리했다. 앱·컴파일·테스트는 계속 JDK 25다.
실행 경로는 mise where에서 읽어 로컬 절대 경로를 저장하지 않는다. 타입 해석 없이 전체 src의 문법 분석을 실행한다.
설정과 CLI 근거: https://detekt.dev/docs/1.23.8/gettingstarted/cli/

pipeline의 8개 테스트는 DescribeSpec으로 옮겼다. 기존 독립 함수별 검증을 describe/it로 그대로 표현해
Given/When/Then 중첩과 동작 변경을 피한다. JVM에는 Kotest 실행기를, KMP에는 kotlin.test 실행기를 유지한다.
Kotest assertions/property는 commonTest 라이브러리로만 추가했다. MockK와 Testcontainers는 JVM 전용이다.
통합 테스트는 integrationTest 소스셋/태스크로 분리해 check에 연결하지 않는다.
ProjectConfig beforeProject/afterProject가 integration-test JVM 전체에서 Postgres 한 개를 공유하고 정리한다.
테스트 프로세스 간 재사용은 하지 않으며 Testcontainers가 호스트 임의 포트를 배정한다.

Konsist는 production shared 소스의 플랫폼·서버·DB·파일 I/O import를 검사한다.
기존 JVM 전용 계약 파일 검증 테스트의 java.io는 테스트 인프라이므로 제외한다.
server 기능 모듈 의존 규칙은 아직 기능 모듈이 없어 비어 있지만 디렉토리가 생기면 적용된다.

Postgres 17은 운영 후보와 맞추는 기본 메이저이며 5년 지원 정책의 안정 메이저다.
https://www.postgresql.org/support/versioning/ . 태그 17의 최신 마이너가 7일 조건을 어길 수 있어 17.6을 고정했다.
POSTGRES_VERSION으로 운영 후보에 맞춰 갱신한다. 운영 버전 최종 선택은 P3/P8에서 확인한다.
Liquibase master.sql은 formatted SQL 헤더와 규칙 주석만 있는 빈 파일이다.
운영은 같은 공식 이미지와 읽기 전용 changelog를 Cloud Run Job/배포 작업에서 실행하고,
DB URL·계정은 Secret Manager로 주입한다. 서버 시작에서 마이그레이션하지 않으며
변경은 append-only changeset, 배포 순서는 migrate 성공 → 앱 배포로 한다.

## P2b에서 제거

- pipeline/detekt-baseline.xml: 기존 pipeline 구조 위반만 유예. P2b에서 구조를 나누고 삭제한다.
- .editorconfig pipeline/**/*.kt max-line-length 예외: 긴 URL/소스 레코드 정리 후 제거한다.
- 와일드카드 import는 예외를 두지 않고 명시 import로 고쳤다.
- shared 모듈에는 baseline이 없다.

## 검증 결과

shared의 기존 위반은 함수를 역할별로 나누어 해결했다(rank의 도달 가능/배려 필터,
입력 검증의 ID/별칭/합계, 링크 파싱/내용/별칭 디코딩). OdMatrix 내부 raw 배열 getter는
같은 값을 반환하는 internal property로 바꿨다. public API나 계약 결과는 바뀌지 않는다.
일반 규칙은 production 함수 길이 60, 복잡도 15, 조건 항목 4를 유지한다.
테스트 픽스처는 긴 파라미터/DSL 본문 제한에서 제외하고, 함수 수는 private/override를 제외해
표면을 검사한다. 숫자 상수와 줄 길이는 각각 도메인/ktlint 책임으로 분리했다.

Testcontainers는 DOCKER_HOST가 없으면 docker context inspect의 현재 endpoint를 사용한다.
Docker Desktop에서 /var/run/docker.sock 심볼릭 링크가 없는 환경도 동작한다.
Docker 29 호환을 위해 docker-java api.version=1.44를 통합 테스트 JVM에 지정했다.
Kotest 6의 project config 검색은 integrationTest 태스크의 명시 FQN으로 고정했다.

CI의 lint/unit/integration 잡은 공통 Kotlin 경로 필터를 공유한다. 루트 check는 통합 테스트를
실행하지 않으며 GitHub 호스트 러너의 Docker를 사용하는 별도 integration 잡이 이를 실행한다.
GitHub 원격 CI 자체 실행은 이번 작업에서 하지 않았으며 로컬 actionlint로 문법을 검사했다.

두 번째 디렉토리는 동일 compose/scripts/changelog를 임시 디렉토리에 복사해 확인했고 삭제했다.
별도 git worktree는 만들지 않았다. 체크섬 포트 공간은 유한하므로 충돌 시 환경 변수로 지정한다.
gitleaks의 기존 spikes/web/out 번들 오탐 22건은 이미 gitignore된 생성물 경로만 제외해 해결했다.

결정 필요: 즉시 필요한 사용자 결정 없음. 운영 Postgres 마이너/이미지 digest, 실제 서버·웹·seed,
운영 마이그레이션 Job 구성은 P3/P4/P8 작업에서 확정한다.


최종 단위 테스트 XML 합계 150개, 실패/스킵 0. 통합 테스트 1개, 실패/스킵 0.
아래는 실제 출력 발췌이며 도구 경고에 나오는 로컬 경로는 생략했다.

```text
$ ./gradlew check (mise 환경)
> Task :shared:schema:check
BUILD SUCCESSFUL in 5s
188 actionable tasks: 75 executed, 113 up-to-date
# check 출력에 :pipeline:integrationTest 실행은 없음

$ ./gradlew integrationTest (mise 환경)
> Task :pipeline:integrationTest
BUILD SUCCESSFUL in 2s
# 테스트 XML stdout:
Real Postgres fixture: postgres:17.6; running=true

$ python3 -B -m unittest discover -s prototype
Ran 18 tests in 0.006s
OK

$ mise run setup
mise all tools are installed
Already up to date
Done ... using pnpm v12.16.1
sync hooks: ✔️(pre-commit)

$ mise run dev:db
Container ...-db-1 Healthy
$ mise run dev:migrate
Liquibase Version: 4.33.0
Database is up to date, no changesets to execute
Total change sets: 0
Liquibase command 'update' was executed successfully.

$ mise run dev:db -- down
Container ...-db-1 Removed
Network ..._default Removed
$ bash scripts/dev.sh db ps
NAME IMAGE COMMAND SERVICE CREATED STATUS PORTS
# 행 없음: 정리 확인 (볼륨은 의도적으로 보존)

# 같은 구성의 다른 디렉토리에서 동시 실행:
project=banbanyeok-banbanyeok-1010315139 DB_PORT=25139 SERVER_PORT=35139 WEB_PORT=45139
project=banbanyeok-s1-compose-pbi9ov5z-3227075628 DB_PORT=25628 SERVER_PORT=35628 WEB_PORT=45628
...-1010315139-db-1 postgres:17.6 Up (healthy) 127.0.0.1:25139->5432/tcp
...-3227075628-db-1 postgres:17.6 Up (healthy) 127.0.0.1:25628->5432/tcp
# 임시 디렉토리 컨테이너/네트워크/볼륨을 down -v로 제거 후 디렉토리도 삭제

$ mise run doctor
ok Docker 실행 중
warn op whoami 실패: account is not signed in
모두 통과했습니다.  # 선택 1Password 때문에 실패하지 않음

$ gitleaks dir . --config .gitleaks.toml --redact --no-banner
no leaks found
$ gitleaks git . --config .gitleaks.toml --redact --no-banner
11 commits scanned.
no leaks found
$ actionlint
# 출력 없음, exit 0
```

Konsist 음성 검증: 임시 java.io import, pipeline→shared:links 의존, 임시 server 기능 모듈 간
의존을 넣었을 때 세 규칙 모두 실패(`3 tests completed, 3 failed`)했고 모두 원복한 후 check가 통과했다.
변경 파일 ktlint 훅 스크립트는 정상 pipeline 테스트 파일을 통과하고, 임시 포맷 위반 파일은 실패함을 확인했다.
훅은 커밋/스테이징을 만들지 않고 같은 스크립트를 직접 실행해 검증했다.

추가 확인: build-logic는 자기 자신의 precompiled convention plugin을 적용할 수 없으므로
루트 detektBuildLogic 태스크로 동일 detekt 설정을 적용하며 check와 CI lint에 연결했다.
ktlintBuildScripts도 루트와 included build 스크립트를 동일 규칙으로 검사한다.
ktlint 1.7.1은 JDK 25에서 sun.misc.Unsafe deprecation 경고를 출력하지만 검사는 정상 통과한다.

최종 baseline은 11건이다: Graph.network 길이/복잡도, Graph의 복합 조건 2건과 loop jump,
Sources.checkSource/csv 복잡도, Main.build 길이, Validation.graphGate 복잡도/중첩,
Validation.stateTriangles 중첩. 모두 P2b에서 제거할 구조 위반이며 formatting 위반은 없다.
마지막 `./gradlew check` 재검증은 `BUILD SUCCESSFUL in 7s`와
`135 actionable tasks: 104 executed, 10 from cache, 21 up-to-date`였다.
최종 `gitleaks dir` 재검증도 `no leaks found`, actionlint와 git diff --check는 exit 0이다.
