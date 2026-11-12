# S0a 작업 노트 — 결정 근거와 코디네이터가 볼 항목

작성 2026-11-12 · 작업: 저장소 골격과 계약. 코디네이터가 중간에 보낸 설계 변경 3건(웹은 서버 API만 호출해 KMP js 타깃 제거, 서버 프레임워크 미정, build-logic 컨벤션 플러그인)을 모두 반영했다.

## 1. 결정과 근거

### JDK: Temurin 25 (LTS)

| 근거 | 출처(확인일 2026-11-12) |
|---|---|
| Gradle 9.8은 JVM 17~27에서 실행된다 | https://docs.gradle.org/current/userguide/compatibility.html |
| Kotlin 2.4 컴파일러의 `-jvm-target`은 1.8~26 | https://kotlinlang.org/docs/compiler-reference.html |
| 25는 현재 LTS이고 로컬에 이미 설치돼 있다. 비-LTS(26, 27)는 쓰지 않는다 | — |
| **Ktor 3.6의 JDK 요구사항은 공식 문서에서 확인하지 못했다** (문서 페이지가 스크립트 렌더링이라 가져오지 못함). 대신 Ktor 서버 테스트를 JDK 25에서 돌려 통과하는 것을 확인했었다(서버 프레임워크 보류 결정 전). 프레임워크가 정해지면 해당 문서로 다시 확인할 것 | — |

툴체인은 25, `shared/*` 라이브러리의 바이트코드 대상은 17로 낮췄다(A1에서 Android가 같은 모듈을 소비할 수 있게).

### 버전 고정 (`gradle/libs.versions.toml`, 게시 후 7일 이상 지난 안정판만)

| 항목 | 값 | 비고 |
|---|---|---|
| Gradle | 9.8.2 (wrapper, SHA-256 고정) | 9.9.0은 6일, 9.9.1은 2일 전 게시라 제외 |
| Kotlin | 2.4.21 (2026-10-08) | 2.5.0-RC는 안정판 아님 |
| kotlinx.serialization | 1.12.0 | 1.13.0은 어제(11-11) 게시라 제외 |
| Ktor 3.6.1, logback 1.5.38 | **후보로만 고정, 어떤 모듈도 쓰지 않음** | 서버 프레임워크 미정 |
| node 24.22.2, pnpm 12.16.1, gitleaks 8.30.1, lefthook 2.2.2 | `mise.toml` | |

### pre-commit: lefthook (mise 태스크 방식 아님)

- 훅 정의가 `lefthook.yml` 한 파일로 남아 배포되고, 훅 스크립트를 직접 관리하지 않아도 된다. 설치는 `mise run hooks:install` 한 번.
- 바이너리 하나(Go)라 Python `pre-commit` 같은 별도 런타임·가상환경이 필요 없고, 버전을 `mise.toml`에서 gitleaks와 함께 고정한다.
- git worktree(Orca)에서도 공용 훅 디렉토리에 설치되어 동작한다.
- 검증: 임시 저장소에서 가짜 `phx_` 키를 스테이징하면 커밋이 막히고, 정상 파일은 통과한다.
- **이 저장소의 `.git/hooks`에는 설치하지 않았다.** 코디네이터 커밋 환경에서 `lefthook`이 PATH에 없으면 훅이 실패하기 때문이다. 커밋 전에 `mise run hooks:install`을 할지 코디네이터가 정하면 된다.

### 스냅샷 숫자 단위

`expected.ranking.json`은 오라클 단위인 **분**(`"unit": "minutes"`)이다. 종합 문서 기본값은 코어 내부 정수 **초**이므로, P1은 골든 입력과 기대값에 ×60을 곱해 비교한다(분 값이 모두 정수라 정확하다). 상한 `min(15분, 50%)`은 초 단위로 `min(900, t/2)`이며 분이 정수면 `t/2`도 정수 초다. 3분 허용오차도 ×60.

## 2. 형식 계약에서 내가 정한 것 (검토 요청)

- **od.bin**: 리틀 엔디언, 헤더 32바이트, 시간 u16 초(최대 65534초 ≈ 18시간 11분), 환승 u8, 도달 불가 `0xFFFF`/`0xFF`. 코드 축을 파일이 직접 갖는다. 길이는 정확히 일치해야 한다. 4시간 상한이 필요하다고 해도 18시간이면 충분하다. 더 필요하면 `formatVersion` 증가.
- **역 코드**: 알파벳 `0123456789abcdefghjkmnpqrstvwxyz`(Crockford 소문자), 15비트 값과 일대일, 문자열 사전순 = 값 순. **안정 ID는 코드 자체**로 두고 별도 숫자 ID는 만들지 않았다. 대문자·혼동 문자 치환은 레지스트리·od.bin에서 허용하지 않는다(링크 계층의 선택으로 남김).
- **reader는 엄격하다**: JSON의 알 수 없는 키는 오류. 새 필드가 필요하면 `schemaVersion`을 올린다. 구 클라이언트를 `minClientSchema`로 막는 구조와 맞물린다. 필드 추가를 허용하는 쪽이 낫다면 `ignoreUnknownKeys`만 켜면 된다.
- **manifest**: `previousDataVersion`은 선택(첫 발행이면 생략). `dataVersion`은 `YYYYMMDD.N`.
- **좌표**는 소수 6자리로 반올림해 `127.0`처럼 항상 소수점을 쓰는 직접 직렬화(플랫폼별 `Double.toString` 차이 방지; Kotlin/JS는 `127.0`을 `127`로 쓴다는 것을 실제로 겪었다).
- **링크 코덱(`/s`)**: 별칭 구분자 `|`는 tech-stack 8.2 그대로이지만 RFC 3986에서 쿼리에 그대로 쓸 수 있는 문자가 아니다. 인코더는 그대로 쓰고 디코더는 `%7C`도 받게 했다. 이게 불편하면 `.`이나 `~`(base64url 알파벳에 없음)로 바꾸는 게 깔끔하다. 구현이 아직 없으니 지금이 바꾸기 가장 싸다.
- **events.json**: tech-stack 7.3의 `has_nickname`을 **`has_custom_name`으로 바꿨다**. 프라이버시 규칙(`nickname` 조각이 든 속성 이름 금지)에 걸리지 않게 하려는 것이다. 별칭 내용은 보내지 않는 불리언이라 의미는 같다.
- **openapi.yaml**: 경로는 `servers.url=/v1` 아래에 둔다. 웹이 레지스트리를 따로 받지 않도록 응답에 `stationName`/`originName`을 넣었다(숨긴 참가자는 null). 후보 카드는 최대 3개. 시간은 초.

## 3. 알아 둘 점 / 한계

- **GitHub에서 CI를 실행해 보지 못했다.** `actionlint`는 통과했다. 액션 SHA는 GitHub API로 확인했다(checkout v7.0.1, setup-gradle v6.4.1, paths-filter v4.0.3, mise-action v5.2.7). 첫 PR에서 `jdx/mise-action`의 `install_args: java`와 gradle 캐시 동작을 확인할 것.
- **`mise run doctor`는 이 환경에서 1Password 항목이 실패한다**(`op whoami`: account is not signed in). 데스크톱 앱 연동이 비대화형 세션에서 잠겨 있어 개인 계정 확인을 할 수 없었다. 나머지(JDK·node·pnpm·gitleaks·lefthook·python·wrapper)는 통과. 사용자가 한 번 직접 실행해 확인해야 한다.
- `mise.local.toml`의 `OP_SERVICE_ACCOUNT_TOKEN = false`가 셸의 같은 변수를 해제하는 것은 실제로 확인했다(tech-stack 11.2의 [미확인] 항목 해소).
- `mise trust`를 이 저장소에 대해 실행했다(사용자 mise 상태에 반영됨).
- GitHub **secret scanning / push protection**은 저장소 설정이라 설정하지 않았다(사용자 작업). 의존성 봇 설정(Gradle·pnpm)도 이번 범위 밖이다.
- 1Password 서비스 계정(`banbanyeok-ci`)과 vault `-ci`/`-release` 생성 확인은 계정 작업이라 하지 않았다. `.env.tpl`의 키는 항목이 아직 없어 전부 주석이다.
- `RegistryCompatibility.checkAppendOnly`는 구현·테스트했지만 CLI/CI에 연결하지 않았다(파이프라인 검증 게이트 P2와 CI P8의 몫).
- `pnpm-lock.yaml`은 `pnpm install`이 만든 빈 워크스페이스용 파일이다. `web/`이 생기면 갱신된다.
- Gradle Kotlin DSL 함정 두 가지를 겪어 둔다: ① precompiled script plugin의 KDoc에 `슬래시+별표`(예: 경로 `shared/*`)를 쓰면 중첩 주석이 열려 `plugins {}` 블록이 주석에 먹힌다. ② build-logic 클래스패스의 서드파티 플러그인(`kotlinx.serialization`)은 모듈 스크립트에서 ID로 직접 못 쓰고 컨벤션 플러그인으로 감싸야 한다(`banbanyeok.serialization`). 그리고 모듈 스크립트의 `kotlin { }` 접근자가 보이려면 build-logic이 KGP를 `api`로 노출해야 한다.

## 4. 문서 간 충돌 (코디네이터가 문서 정리 시 반영)

설계 변경 이후 아래 문서의 서술이 현재 결정과 어긋난다(내가 문서를 고치지는 않았다).

- `docs/01-synthesis.md` 2절 "공유 코어", "계산 위치", 3절 1항 "jvm + js만 켠다", 5절 S0b 스파이크("Kotlin/JS → Next.js import"): 웹은 KMP js를 쓰지 않는다.
- `docs/research/tech-stack.md` 3.2(웹 계산 방식 ①/②/③), 3.3(JS 타깃 테스트), 12·15장(`jsTest`, 서버 Ktor 확정 서술), 11.6의 `ci-kotlin`(JS 테스트).
- 링크 코덱은 Kotlin(`shared/links`)과 TS 두 곳에 구현되므로 P4/P6 작업 지시에 `contracts/golden/link-vectors.json` 통과를 완료 조건으로 넣는 것을 권한다.

## 5. 코디네이터 커밋 시 주의

- **`spikes/web/out/`(S0b 산출물, 추적 안 됨)에 gitleaks `generic-api-key` 오탐 22건**이 있다(번들된 `worker.js`와 소스맵의 난독화된 문자열). 내 파일과 히스토리는 0건이다. 이 폴더를 그대로 스테이징하면 pre-commit 훅이 막는다. `spikes/**/out/`을 `.gitignore`에 넣거나 커밋에서 빼는 것을 권한다. 내가 S0b 영역을 건드리지 않으려고 `.gitignore`에는 넣지 않았다.
- `prototype/scenarios.json`은 `contracts/golden/scenarios.json`으로 **이동**(git에서는 삭제 + 추가)했다.
- 새로 생기는 추적 대상 중 생성물은 없다(`build/`, `.gradle/`, `.kotlin/`은 gitignore). `gradle/wrapper/gradle-wrapper.jar`는 커밋 대상이다.

## 6. 완료 기준 검증 출력 (2026-11-12 실행)

```text
$ ./gradlew clean build --console=plain --no-build-cache
> Task :shared:schema:checkCommonMainPurity
> Task :shared:schema:generateGoldenTests
> Task :shared:schema:jvmTest
> Task :pipeline:test
> Task :server:test
BUILD SUCCESSFUL
테스트 결과 XML 합계: 43개 통과, 실패 0 (shared 6개 모듈 + schema 36개, pipeline 1, server 1)
```
JS 타깃을 끄기 전의 빌드에서는 schema 테스트 35개가 jvmTest와 jsNodeTest 양쪽에서 통과했다(JS에서만 좌표 `127.0` 직렬화 차이를 발견해 고쳤다). 지금은 jvm만 돈다.

```text
$ python3 -B -m unittest discover -s prototype -v   → Ran 17 tests ... OK   (기존 6 + 계약 테스트 11)
$ python3 -B prototype/algorithm.py | tail -1        → 골든 시나리오: 16/16 통과

$ gen_expected / gen_fixtures / gen_link_vectors 재실행 전후 md5(expected.ranking.json, link-vectors.json, fixtures/*)  → 동일
  expected.ranking.json md5 = 2317a8098b5b9a0ff38896c3fc948434, `--check` → "expected.ranking.json: 최신"

$ gitleaks dir . (spikes/ 제외)                      → no leaks found
$ gitleaks git .   (히스토리 1커밋)                  → no leaks found
$ gitleaks dir . (spikes/ 포함)                      → leaks found: 22  ← 모두 spikes/web/out/ (S0b 번들 산출물) 오탐
$ actionlint                                         → 오류 없음
```
- 훅 동작 확인: 임시 저장소에서 가짜 `phx_` 키 스테이징 시 커밋 차단, 정상 파일은 통과.
- commonMain 순수성: 임시로 `import java.io.File`을 넣으면 `checkCommonMainPurity`가 실패함을 확인한 뒤 되돌렸다.
- **미통과/미검증**: `mise run doctor`의 1Password 항목(`op whoami` 로그인 안 됨), GitHub에서의 CI 실행.
