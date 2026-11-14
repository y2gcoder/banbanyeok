# T1 도구 정비

검증일: 2026-11-14. JDK 25 하나로 컴파일·테스트·ktlint·detekt를 실행한다.

## 버전과 게시 근거

공식 GitHub release API의 `published_at`과 `prerelease=false`를 확인했다.
현재 시각 2026-11-14 05:31 UTC에서 7일 이상 지난 버전만 사용한다.
사용자가 허용한 실험판은 detekt 하나이며, 최신 alpha.6을 정확히 고정했다.

| 도구 | 적용 버전 | 게시일 (UTC) / 공식 출처 |
|---|---|---|
| detekt | 2.0.0-alpha.6 | [2026-08-04](https://github.com/detekt/detekt/releases/tag/v2.0.0-alpha.6) |
| Gradle | 9.8.2 유지 | [2026-10-19 buildTime](https://services.gradle.org/versions/all) |
| ktlint | 1.8.0 | [2025-11-14](https://github.com/ktlint/ktlint/releases/tag/1.8.0) |
| Kotest | 6.2.6 | [2026-10-14](https://github.com/kotest/kotest/releases/tag/v6.2.6) |
| MockK | 1.14.11 | [2026-05-29](https://github.com/mockk/mockk/releases/tag/v1.14.11) |
| Testcontainers | 1.21.4 | [2025-12-15](https://github.com/testcontainers/testcontainers-java/releases/tag/1.21.4) |
| Konsist | 0.18.1 | [2026-10-10](https://github.com/LemonAppDev/konsist/releases/tag/v0.18.1) |
| PostgreSQL JDBC | 42.7.14 | [2026-10-07](https://github.com/pgjdbc/pgjdbc/releases/tag/REL42.7.14) |
| Logback | 1.6.6 | [2026-10-25](https://github.com/qos-ch/logback/releases/tag/v_1.6.6) |

PR #6과의 차이 두 건은 코디네이터 결정이다. Gradle 9.9.1은 공식 versions API의
buildTime이 2026-11-10이라 7일 미만이고, MockK 1.14.12는
[published_at=2026-11-07T22:40:45Z](https://github.com/mockk/mockk/releases/tag/1.14.12)로
정확히 7일을 채우지 못했다. 따라서 wrapper는 변경하지 않았고 MockK는 1.14.11로 갱신했다.
두 버전은 다음 Dependabot 주기에 다시 검토한다. 나머지 PR #6 갱신은 포함한다.

## detekt 2 이전과 실행 경로

공식 [호환성 표](https://detekt.dev/docs/introduction/compatibility/)와 alpha.6 릴리스는
Kotlin 2.4.10 기반, JDK 25 검증을 명시한다. 프로젝트의 Kotlin 2.4.21/JDK 25 조합은
실제 전체 빌드로 확인했다. [2.0 마이그레이션 문서](https://detekt.dev/docs/next/introduction/migration/),
[Gradle 플러그인 문서](https://detekt.dev/docs/gettingstarted/gradle/),
[타입 분석 문서](https://detekt.dev/docs/gettingstarted/type-resolution/)를 기준으로 옮겼다.
Next 문서에는 alpha.6 이후 변경도 있으므로 설정은 아래 고정 태그의 기본 설정과 대조했다.

- [1.23.8 기본 설정](https://github.com/detekt/detekt/blob/v1.23.8/detekt-core/src/main/resources/default-detekt-config.yml)
- [alpha.6 기본 설정](https://github.com/detekt/detekt/blob/v2.0.0-alpha.6/detekt-core/src/main/resources/default-detekt-config.yml)

`dev.detekt` 플러그인과 `dev.detekt:detekt-gradle-plugin`으로 변경했다.
`banbanyeok.quality`가 모든 JVM/KMP 모듈에 적용하며, `detekt` 및 `check`에서
각 compilation의 full 태스크(`detektMain`, `detektTest`, `detektIntegrationTest`,
`detektTestFixtures`, KMP `detektMainJvm`, `detektTestJvm`)를 실행한다.
따라서 기존 CI의 `detekt` 명령도 타입 분석을 빠뜨리지 않는다.
JDK 21 CLI/별도 classpath/configuration과 mise JDK 21 설치를 제거했다.

build-logic는 자신의 관례 플러그인을 사용할 수 없어 같은 카탈로그의 플러그인을 직접 적용한다.
루트 `detektBuildLogic`는 included build 태스크로 연결한다.
관리하는 `.kt`는 full 분석, Gradle script receiver가 필요한 `.gradle.kts`는 light 분석한다.
Gradle이 생성한 plugin adapter는 분석 입력에 넣지 않는다(초기 ClassNaming 8건은 생성물).

### 1.x 대비 규칙 차이

| 1.23.8 | alpha.6 적용 | 판단 |
|---|---|---|
| LongMethod threshold 60 | allowedLines 59 | 경계 유지 |
| LargeClass threshold 600 | allowedLines 599 | 경계 유지 |
| NestedBlockDepth threshold 4 | allowedDepth 3 | 경계 유지 |
| TooManyFunctions thresholdIn… 11 | allowedFunctionsPer… 10 | 경계 유지, private/override 제외 유지 |
| ComplexCondition threshold 4 | 기본 allowedConditions 3 | 기존 경계 유지 |
| CyclomaticComplexMethod threshold 15 | 기본 allowedComplexity 14 | 기존 경계 유지 |
| LongParameterList 6/7 | 기본 allowedFunctionParameters 5 / allowedConstructorParameters 6 | 기존 경계 및 테스트 제외 유지 |
| EmptyKtFile | EmptyKotlinFile | 이름 변경, 기본 활성 유지 |
| MayBeConst | MayBeConstant | 이름 변경, 기본 활성 유지 |
| UnnecessaryAbstractClass | AbstractClassCanBeConcreteClass / AbstractClassCanBeInterface | 분할, 기본 활성 유지 |
| UnusedPrivateMember | UnusedPrivateFunction / UnusedVariable | 분할, 기본 활성 유지 |
| 없음 | ExplicitItLambdaMultipleParameters | 새 기본 활성, 위반 0 |
| MagicNumber / MaxLineLength 비활성 | 동일 | 도메인 상수 / ktlint 책임 유지 |
| ReturnCount max 4 / guard 제외 | 동일 | 기존 설정 유지 |

### 새로 실행한 타입 규칙의 판단

초기 전체 실행 및 컴파일 경고 수정 후 후속 실행의 고유 위반을 합산했다.
새 규칙을 모두 켜는 `allRules`는 사용하지 않고 alpha.6 기본 활성 집합에서 시작한다.
타입 분석으로 처음 실행된 기본 규칙 중 위반을 낸 항목은 다음과 같다.
그 밖의 기본 활성 타입 규칙은 0건이며 유지한다.

| 규칙 | 초기 위반 | 처리 |
|---|---:|---|
| InjectDispatcher | 8 | F1에서 해결. 생성자 주입으로 변경하고 조립부는 Dispatchers.IO, 테스트는 테스트 dispatcher를 전달. 규칙 활성화 |
| UnreachableCode | 3 | 비활성. serialization 생성 함수 미해석으로 정상 Manifest parse/encode 뒤를 도달 불가로 판정. Kotlin 컴파일러의 도달 불가 경고는 Werror로 계속 검사 |
| UnsafeCallOnNullableType | 11 | production 활성 유지. 기존 테스트 제외에 integrationTest/testFixtures도 포함해 모든 테스트 종류에 같은 기준 적용 |
| NoNameShadowing | 11 | 활성 유지. 중첩 람다의 바깥 iteration/분/route 이름을 명시 |
| ImplicitDefaultLocale | 1 | 활성 유지. 계약 소스 생성기의 16진수 포맷에 Locale.ROOT 명시 |
| DoubleMutabilityForCollection | 1 | 활성 유지. CSV row를 val로 두고 완료 행을 복사 후 clear |
| HasPlatformType | 1 | 활성 유지. 테스트 Clock의 ZoneId 반환 타입 명시 |
| UseOrEmpty | 1 | 활성 유지. 링크 별칭의 동일한 빈 문자열 변환 |
| UnusedPrivateProperty | 1 | 활성 유지. 초기화에서만 사용하는 생성자 인수의 private val 제거 |

baseline 또는 suppress를 추가하지 않았다. 설정 조정은 위 표에 공개했다.
alpha의 한계: schema full 분석은 serialization compiler plugin이 생성하는 `serializer()`를
해석하지 못해 미해결 참조 및 연쇄 타입 추론 진단 12건을 출력한다.
실제 Kotlin 컴파일은 성공하며 타입 분석 자체는 full로 실행된다. 이 때문에
serialization 호출 주변의 분석 정확도는 제한된다. JDK 격리나 light 모드로 되돌리지 않는다.

### 타입 분석과 경고 오류화 증거

```text
$ ./gradlew :shared:schema:detektMainJvm --rerun -PdetektDebug=true --console=plain
> Task :shared:schema:detektMainJvm
# 디버그 CLI 재현 인수 중 로컬 경로를 제거한 발췌:
--classpath <compiled-main>:<serialization-core>:<serialization-json>:<stdlib>:<annotations>
--analysis-mode full --jvm-target 17 --jdk-home <Temurin-25>
BUILD SUCCESSFUL in 5s
```

처음 실행에서는 타입이 있어야 실행되는 UseOrEmpty가
`ShareLinkCodec.kt:37:43 ... [UseOrEmpty]`로 빌드를 실패시켰고 수정 후 통과했다.
단순히 태스크 이름만 바꾸거나 classpath 없이 실행한 것이 아니다.
JVM/KMP 관례와 build-logic 자체에 `compilerOptions.allWarningsAsErrors=true`를 적용했다.
초기 `:server:app:compileKotlin`의 `warnings found and -Werror specified` 및 URI 불필요 safe call
2건을 확인한 뒤, 스마트 캐스트 이후의 `?.`만 `.`으로 정리했다.
JDK의 ktlint 내부 Unsafe 경고와 Gradle 플러그인의 deprecation 안내는 Kotlin 소스 컴파일 경고가 아니다.

## 변경 파일 성격과 검증

Kotlin `.kt` 22개 변경: 형식만 11개, 형식·정적 분석/컴파일 경고 정리 11개.
분석 정리 파일은 ArchitectureTest, GenerateContractTestData, Graph, Sources, AppConfig,
ApiHttpTest, TestSupport, GoldenRankingTest, RankingPropertiesTest, ShareLinkCodec, ShareLinkCodecTest다.
나머지는 ktlintFormat의 when 중괄호·줄바꿈 변경이다. Kotlin 스크립트 `.kts` 10개는
도구 설정과 KDoc→일반 블록 주석 변경(ktlint 1.8 스크립트 KDoc 규칙)이다.
API·제품 기능 변경이나 큰 리팩터링은 없다.

- `mise trust && mise install`: 성공.
- `./gradlew ktlintFormat ktlintFormatBuildScripts`: 성공.
- `./gradlew check integrationTest`: 성공(JDK 25, 전체 Kotlin 모듈).
- XML: JVM test 160개, KMP jvmTest 138개, integrationTest 32개, 실패·오류·스킵 0.
- `actionlint`, `git diff --check`: 성공.
- `gitleaks dir . --config .gitleaks.toml --redact --no-banner`: no leaks found.

CI lint는 mise의 `install_args: java` 한 단계로 JDK 25 하나를 설치하고
기존 `ktlintCheck ktlintBuildScripts detekt detektBuildLogic`를 그대로 실행한다.
공용 파일 변경: build-logic/, gradle/libs.versions.toml, config/detekt/detekt.yml,
mise.toml(JDK 21 제거), .github/workflows/ci.yml(lint 주석),
승인받은 루트 build.gradle.kts(detekt bridge)와 README.md(JDK 안내 한 구절).
wrapper와 .editorconfig는 변경하지 않았다. scripts/doctor.sh에는 JDK 21 검사가 없어 변경하지 않았다.

결정 필요: 즉시 사용자 결정 없음. dispatcher 주입은 F1에서 해결했으며 serialization 분석 한계는 후속 검토 사항이다.
