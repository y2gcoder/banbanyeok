# S0b 기술 검증 스파이크

## Cloud Run 실측 결론 (2026-11-13, 5절)

**권고: Ktor + 코루틴, AppCDS + startup CPU boost 켬 + min 0으로 진행한다.** 측정한 Spring 구성은 boost를 켜도 실제 첫 응답 3초 기준을 충족하지 못했다. min 1은 측정하지 않았으며, 상시 가동으로 우회하기보다 정한 결정 규칙에 따라 Ktor를 선택한다.

아래 값은 **CPU boost 켬 / 끔**, 단위 초다. 각 칸은 조건별 콜드 10회·웜 10회에서 계산했다. 판정은 콜드 p90 ≤ 3초이며, 초과 표본 수도 5절에 공개했다.

| 대상 | 콜드 p50 켬 / 끔 | 콜드 p90 켬 / 끔 | 웜 p50 켬 / 끔 | 3초 판정 켬 / 끔 |
|---|---:|---:|---:|---|
| Ktor 기본 | 1.973 / 3.014 | 2.192 / 3.300 | 0.087 / 0.090 | 통과 / 미충족 |
| Ktor AppCDS | 1.110 / 1.896 | 1.392 / 2.608 | 0.087 / 0.090 | 통과 / 통과 |
| Spring MVC 최소+CDS | 3.312 / 5.490 | 3.675 / 6.134 | 0.089 / 0.091 | 미충족 / 미충족 |
| Spring Data JDBC+CDS | 4.573 / 8.941 | 5.737 / 10.818 | 0.090 / 0.089 | 미충족 / 미충족 |
| Spring Data JPA+CDS | 5.606 / 9.819 | 5.996 / 10.928 | 0.086 / 0.101 | 미충족 / 미충족 |

**리소스 정리 완료:** 측정용 Cloud Run 서비스 5개·모든 리비전/태그, Artifact Registry 저장소와 이미지 전부, 전용 실행 계정을 삭제하고 재확인했다. 버킷은 만들지 않았다. Monitoring 지표는 98/100개 리비전에 수집됐고 나머지 2개는 N/A로 명시했다.

1~4절 측정일: 2026-11-12, 5절 Cloud Run 측정: 2026-11-13(JST). 범위는 `spikes/`뿐이며 루트·contracts·shared·server·pipeline은 수정하지 않았다. 5절은 승인된 임시 비공개 배포를 수행하고 삭제했으며 Git 커밋·푸시는 하지 않았다. 우선순위는 `docs/01-synthesis.md` → `docs/research/tech-stack.md` 3판이다.

## 질문별 결론과 권고

1. **Kotlin/JS → Next.js: 채택 권고.** Kotlin 2.4.21 JS IR의 `@JsExport` 함수를 Next.js 16.4.6 App Router의 서버·클라이언트 컴포넌트에서 호출했다. Turbopack와 webpack 모두 production build 성공, Chrome에서 버튼을 클릭해 두 결과가 `AAA,BBB,CCC`로 일치함을 확인했다. Kotlin 없는 대조 빌드 대비 브라우저 JS gzip 증가는 **Turbopack 10,050 bytes, webpack 10,212 bytes**다. 생성 타입은 정확하나 `IntArray`가 `Int32Array`이므로 얇은 JS 경계가 필요하다. **JS 산출물을 npm tarball로 패키징해 소비**하는 방식을 권고한다.
2. **Cloudflare + OpenNext: SSG는 진행하고, 동적 OG는 폰트 서브셋 + Static Assets fetch로 구현하되 무료 CPU 적합성은 배포 검증 전 미확정으로 둔다.** OpenNext 1.20.17 빌드, Wrangler 4.160.1 로컬 실행, SSG `/ssg`와 한국어 `/og` PNG 모두 성공했다. Worker는 **6,836.11 KiB raw / 1,748.20 KiB gzip**, 현재 공식 무료 한도 **64 MiB uncompressed** 이내다. 서브셋 OG의 첫 요청 벽시계 116.52 ms, 후속 5회 평균 18.96 ms를 쟀지만 이 수치로 실제 CPU 10 ms 준수를 판단할 수 없다. 계정 확보 후 CPU 측정 결과로 OG의 캐싱·사전생성·별도 실행 위치를 결정한다.
3. **Ktor: AppCDS를 적용해 Cloud Run min 0 실측 단계로 진행 권고.** 130 KiB/1 MiB 파일을 로딩하는 JVM 프로세스의 첫 health 응답 평균은 **361.85/357.57 ms**, AppCDS는 **194.20/190.73 ms**다. 로컬에서는 3초 목표보다 빠르지만 Cloud Run 3초 달성을 입증하지 않는다. Docker 이미지는 **549,130,382 bytes (523.69 MiB, linux/arm64)**로 실제 빌드·실행했다. native-image는 설치되어 있지 않아 요청의 허용 범위에 따라 생략했다.

4. **Spring Boot 추가 검증: 콜드스타트 우선이면 Ktor 유지, Spring 선택 시 JDBC+CDS 우선 권고.** 최소 MVC는 130 KiB에서 기본 1,003.74 ms / CDS 554.42 ms로 같은 시점 Ktor 399.76 / 210.61 ms보다 느렸다. 실제 PostgreSQL 연결 JDBC는 1,685.90 / 959.57 ms, JPA(엔티티 3개)는 2,416.55 / 1,130.97 ms였다. **JPA 사용 비용은 JDBC 대비 기본 +730.66 ms·CDS +171.40 ms와 RSS 증가**였다. [추정] Cloud Run min 0에서는 이 차이에 플랫폼·DB 지연이 더해져 JPA 기본 구성의 3초 목표 여유가 작을 수 있으므로 실배포 검증이 필요하다. RSS·heap·이미지 크기와 DB 없는 구성의 실패, AOT 결과는 4절에 구분했다.

## 환경과 측정 표

공통: macOS Darwin 27.2.0 arm64, Apple M4 Pro, RAM 24 GiB, Temurin OpenJDK 25.0.5+8, Node 24.22.2, npm 11.19.1, Gradle 9.3.1, Kotlin 2.4.21. Ktor 3.6.1 + Netty, React/React DOM 19.2.0, Next 16.4.6(측정 시점 `npm view next version`의 안정 버전), OpenNext Cloudflare 1.20.17, Wrangler 4.160.1, Docker Engine 29.9.3. 모든 Gradle 프로젝트는 자체 `settings.gradle.kts`를 사용한다. raw 수치는 bytes, KiB/MiB는 1024 기준이다.

### 1. Kotlin/JS와 Next.js

아래 명령의 기준 디렉터리는 별도 표기 없는 경우 `spikes/web`이다. 원시 수치는 `results/bundle-*.json`, 브라우저 결과는 `results/browser-*.json`, 생성 선언은 `results/fair-core.d.mts`에 있다.

| 측정 | 명령 | 환경/결과 |
|---|---|---|
| JS IR production library | `cd ../kotlin-js; ../.tools/gradle-9.3.1/bin/gradle jsNodeProductionLibraryDistribution` | 성공 |
| 공통 코드 JVM 컴파일 | `cd ../kotlin-js; ../.tools/gradle-9.3.1/bin/gradle compileKotlinJvm` | 성공 |
| Python 오라클 비교 | `cd ../kotlin-js; node check.mjs` | fair·기본 동점 0·도달 가능 골든 7건의 전체 순위 + ID 동점 사례 통과 |
| Turbopack | `npm run build` | production build + TypeScript 통과, Chrome 서버/클라이언트 호출 통과 |
| webpack | `npm run build:webpack` | production build + TypeScript 통과, Chrome 서버/클라이언트 호출 통과 |
| Turbopack 전체 브라우저 JS gzip | `node measure-bundles.mjs turbo` | Kotlin 있음 185,660 B / 대조 175,610 B → **+10,050 B** |
| webpack 전체 브라우저 JS gzip | `node measure-bundles.mjs webpack` | Kotlin 있음 286,200 B / 대조 275,988 B → **+10,212 B** |
| 배포 전 Kotlin JS 자체 크기 | Python `gzip.compress(..., mtime=0)` | fair-core.mjs 5,900 B / gzip 1,472 B, stdlib 96,693 B / gzip 17,915 B, DOM compat 124 B / gzip 120 B |
| 자동 생성 TypeScript | `cat ../kotlin-js/build/dist/js/productionLibrary/fair-core.d.mts` | `rankFair(ids: Array<string>, times: Array<Int32Array>): Array<string>`; 수동 `.d.ts`, `any` 캐스트 불필요 |

번들 비교 방식: 동일 페이지에서 import 한 줄만 고정 결과를 반환하는 TS stub으로 교체한 대조 빌드를 만들었다. `.next/static/**/*.js` 각 파일을 Node zlib 기본 gzip으로 압축해 크기를 합산했다. sourcemap·HTML·서버 번들·폰트는 제외한다. 파일별 gzip 합계여서 실제 브라우저 한 페이지의 네트워크 전송량과 동일하지는 않지만, 같은 앱·bundler 내 증분 비교다. tarball 소비 방식의 최종 측정이며 두 bundler 간 절대 크기를 코어 차이로 해석하지 않는다.

스파이크 함수는 `(최장, 차이, 합계, ASCII 역 ID)`의 fair 기본 규칙만 구현했다. null/도달 불가·favor·fast·허용오차 밴드·전체 계약 구현은 P1 범위다. 입력 참가자 수 2~4·행렬 크기·비음수는 검사하지만 운영용 도메인 검증의 대체물이 아니다.

### 2. OpenNext / Cloudflare

| 측정 | 명령 (`spikes/web`) | 실측 결과 |
|---|---|---|
| OpenNext 빌드 | `npm run cf:build` | Next production build, cache/static assets, Worker 생성 성공 |
| Worker 압축 전/후 | `npx wrangler deploy --dry-run --outdir out/worker` | **6,836.11 KiB / gzip 1,748.20 KiB**, 네트워크 배포 없음 |
| 전체 폰트 Static Asset 제거 후 | 동일 dry-run, 전체 폰트만 `.open-next/assets`에서 임시 제외 | **동일 6,836.11 / 1,748.20 KiB**, static asset 파일 수 19 → 18 |
| SSG 페이지 | `npm run cf:preview`, `curl -f http://localhost:18787/ssg` | HTTP 200, 한국어 HTML. 빌드 표에서 `/ssg`는 `○` prerendered |
| Worker 상의 Kotlin 호출 | `URL=http://localhost:18787 LABEL=cloudflare node verify-browser.mjs` | 서버·브라우저 모두 `AAA,BBB,CCC`, pageerror 없음 |
| OG PNG 검증 | `node measure-og.mjs` | 두 폰트 모두 HTTP 200, 1200×630 PNG 13,580 B; 한국어 렌더링 시각 확인 |
| 서브셋 폰트 | `prepare-fonts.sh`, Python gzip | **11,040 B raw / gzip 8,356 B** |
| 전체 폰트 | 같은 스크립트, Python gzip | **16,433,112 B raw / gzip 13,610,743 B** |

| OG 폰트 | 첫 요청 전체 벽시계 / route 내부 | 다음 5회 전체 벽시계(ms) | 5회 평균 전체 / route 내부 |
|---|---:|---|---:|
| 서브셋 | 116.52 / 74.00 ms | 21.78, 18.00, 17.72, 17.53, 19.78 | **18.96 / 14.80 ms** |
| 전체 | 67.31 / 64.00 ms | 65.82, 57.93, 43.08, 46.17, 54.60 | **53.52 / 47.40 ms** |

`results/og-timing.json`에 각 표본이 있다. 서브셋을 먼저 호출했으므로 전체 폰트 첫 요청은 새 Worker 콜드스타트 비교가 아니다. route 내부 `performance.now()`는 폰트 fetch 시작부터 ImageResponse의 lazy PNG stream을 `arrayBuffer()`로 모두 소비하기까지의 시간이며 `Server-Timing`으로 반환한다. fetch 대기·PNG 생성·로컬 런타임 스케줄링이 섞인 **벽시계 시간**이다. Wrangler의 request duration도 CPU 시간이 아니다. 서브셋 warm 14.8 ms를 CPU 14.8 ms로 보고하지 않는다.

현재 공식 [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)는 무료/유료 모두 **uncompressed 64 MiB, compressed 제한 없음**, Static Asset 개별 25 MiB, 무료 CPU/request 10 ms로 명시한다(2026-11-12 열람). 따라서 이번 Worker는 약 6.68 MiB raw로 크기 한도 이내이며, 옛 3 MiB gzip 기준을 적용하지 않는다. 이 확인은 계정의 실제 업로드/시작 검증을 대신하지 않는다.

폰트는 `public/fonts` → Workers Static Assets에 두고 동일 출처 fetch로 로드하므로 **전체 폰트를 빼도 Worker 크기가 그대로임을 dry-run 두 번으로 확인**했다. 전체 폰트 15.67 MiB는 개별 static asset 한도 이내지만 요청당 읽기·파싱 비용이 커졌다. JS에 폰트를 직접 포함시키는 변형의 Worker 크기는 측정하지 않았다. [추정] 같은 원본을 module에 포함하면 Worker raw 크기·초기화 비용이 증가한다. 실제 제품은 역명 목록의 글리프 서브셋을 만들거나 필요한 글리프를 제공하는 범용 한국어 폰트 전략이 필요하며, 이 스파이크의 고정 문구 서브셋으로 임의 역명을 렌더링할 수는 없다.

### 3. Ktor 기동

명령: `cd spikes/ktor; ../.tools/gradle-9.3.1/bin/gradle installDist; python3 measure.py`. 각 표본은 `java -Xms32m -Xmx256m ... -cp <정렬된 runtime JAR들> MainKt` 새 프로세스다. 측정 시작은 Python `Popen` 직전, 끝은 `/healthz` 응답 본문 수신 완료다. 최대 5 ms 간격으로 접속하고 각 기동 후 `/v1/recommend`의 가짜 계산·데이터 크기도 확인한다. Netty가 시작하기 전에 파일 전체를 `ByteArray`로 읽으며, 이후 데이터가 route closure에 보존된다. 데이터는 로컬 디스크의 반복 바이트 파일이고 원격 다운로드·압축 해제·실제 행렬 파싱은 없다.

| JVM 모드 | 파일 | 5회 첫 응답(ms) | 평균 |
|---|---:|---|---:|
| 기본 JDK CDS(추가 AppCDS 없음) | 133,120 B (130 KiB) | 346.857, 367.076, 364.800, 364.324, 366.212 | **361.854 ms** |
| 기본 JDK CDS(추가 AppCDS 없음) | 1,048,576 B (1 MiB) | 348.995, 365.176, 359.165, 367.709, 346.779 | **357.565 ms** |
| AppCDS | 133,120 B | 190.529, 201.100, 196.577, 191.523, 191.256 | **194.197 ms** |
| AppCDS | 1,048,576 B | 191.456, 186.569, 186.513, 195.746, 193.365 | **190.730 ms** |

AppCDS는 동일 클래스패스로 `-XX:ArchiveClassesAtExit=build/appcds.jsa`를 적용해 health+recommend 호출로 학습 후 정상 SIGTERM 종료하며, 측정은 `-Xshare:on -XX:SharedArchiveFile=...`로 강제한다. 생성 archive는 21,282,816 B다. 일부 proxy/JFR 클래스가 제외되는 CDS 경고는 있었으나 archive 생성·강제 사용·응답은 성공했다. `results/ktor-startup.json`에 표본 보관.

| 추가 항목 | 명령 | 결과 |
|---|---|---|
| GraalVM | `which native-image` | 설치 안 됨. 전역 JDK 설치를 변경하지 않고 생략; native 기동 수치 없음 |
| Docker build | `docker build -t banbanyeok-s0b-ktor .` | 성공, Temurin 25 JRE 기본 이미지, AppCDS archive 미포함 |
| 이미지 크기 | `docker image inspect banbanyeok-s0b-ktor --format '{{.Size}}'` | **549,130,382 B (523.69 MiB)**, 로컬 논리 크기이며 registry 압축 전송 크기 아님 |
| 컨테이너 실제 실행 | `docker run --rm -d -p 18081:8080 --name banbanyeok-s0b banbanyeok-s0b-ktor`, `curl -f localhost:18081/healthz`, `docker stop banbanyeok-s0b` | `ok:133120` 확인, 정리 완료 |

Cloud Run 해석: 위는 **macOS/arm64 새 JVM + warm OS 파일 캐시**의 기동이다. Docker 내부 Linux 기동 시간·이미지 pull·Cloud Run 스케줄링·서울 네트워크·GCS 읽기·DB 연결·CPU 할당은 측정에 없다. AppCDS 상대 효과는 약 46~47%지만 클라우드에서 재현된다는 보장은 없다. [추정] Cloud Run 첫 사용자 응답은 플랫폼 준비 + 컨테이너/JVM 기동 + 원격 데이터/DB 초기화 + 네트워크로 나누어 추적해야 하며, 이 로컬 수치를 합산 계수로 바꿔 절대 시간을 예측하기는 어렵다. 따라서 min 1/Fly.io 전환 결정은 P8의 실제 3초 기준 평가 뒤에 한다. AppCDS는 배포 이미지와 동일 OS/JDK/클래스패스에서 다시 생성해야 한다.

### 4. Spring Boot(Kotlin) / Spring Data JDBC / JPA 추가 비교

추가 측정일: 2026-11-12. **권고: min 0 콜드스타트가 최우선이면 Ktor를 유지하고, Spring을 선택한다면 실제 DB 연결을 포함한 JDBC+CDS를 우선 후보로 삼는다.** [추정] 같은 앱도 Cloud Run의 CPU·컨테이너 준비·DB 리전 지연이 더해지므로 로컬 JPA 기본 2.4초를 근거로 3초 목표를 충족한다고 볼 수 없다. JPA의 매핑·생명주기 기능이 필요하다면 이 추가 비용을 받아들이고 실제 Cloud Run에서 재검증한다.

**JPA의 콜드스타트 비용 한 줄:** 실제 PostgreSQL에 연결한 JDBC 대비 130 KiB에서 fat JAR **+730.66 ms(약 43%)·RSS +53.22 MiB**, CDS끼리 비교하면 **+171.40 ms(약 18%)·RSS +57.22 MiB**였다. 1 MiB에서도 각각 +678.82 ms / +166.19 ms로 같은 방향이었다. 이것은 이 세 엔티티·세 저장소 구성에서 관측한 차이이며 모든 JPA 앱의 고정 비용은 아니다.

#### 구성과 동일 조건

Spring Boot **4.1.2**(공식 문서와 Maven metadata의 최신 안정판), Spring MVC/Tomcat 11.0.27, Kotlin 2.4.21, Gradle 9.3.1, Temurin 25.0.5+8. 공통 머신은 위와 같은 Apple M4 Pro/macOS arm64/RAM 24 GiB다. 로컬 PostgreSQL은 Docker **postgres:18 → 18.6 (Debian arm64)**, 호스트 127.0.0.1:18543이다. Hibernate 7.4.13.Final, PostgreSQL JDBC 42.7.14, Flyway 12.4.0은 Boot BOM으로 해석됐다. 버전 기록은 `results/spring-environment.json`에 있다.

- `spring/minimal`: webmvc + Kotlin reflection만 추가한 최소 구성. JDBC/Actuator 없음.
- `spring/full`: webmvc + JDBC/JdbcClient + Flyway + Actuator + PostgreSQL driver/지원 모듈. 초기 요청대로 DB URL 없이 자동 구성을 활성화한 구성.
- `spring/jdbc`: webmvc + Spring Data JDBC + Flyway + Actuator, 실제 PostgreSQL 연결. Room/Participant/AnonymousUser 테이블과 저장소 3개.
- `spring/jpa`: webmvc + Spring Data JPA/Hibernate + Flyway + Actuator, 같은 PostgreSQL·테이블·저장소 3개. 단순 엔티티 3개, Participant에서 Room/User로 lazy many-to-one 2개, Kotlin jpa/allopen 플러그인 적용. `ddl-auto=validate`, `open-in-view=false`.

모든 성공 표본에서 `spring.threads.virtual.enabled=true`를 켜고 health 응답의 `X-Virtual-Thread=true`를 검사했다. 파일은 Ktor와 동일한 133,120/1,048,576 B 반복 바이트이며 Spring이 뜨기 전 main에서 전체를 메모리에 올린다. `/healthz`는 `ok:<bytes>`, `/v1/recommend`는 동일한 1,000회 가짜 계산을 수행한다. DB 구성도 추천 route 자체는 SQL을 실행하지 않는다. 실제 연결은 Hikari·Flyway·저장소/ORM 초기화로 확인했으며 JDBC/JPA 로그에 저장소 각 3개, PG connection 및 migration 검증이 남았다. 먼저 한 번 실행해 스키마를 만든 뒤 5회 측정하므로 첫 설치 DDL 시간은 제외된다.

`-Xms32m -Xmx256m`, 각 조건 새 JVM 5회, warm OS 캐시, `Popen` 직전부터 첫 health 본문 수신까지 벽시계 시간이다. 접속 재시도 간격 5 ms이며 첫 DispatcherServlet 초기화도 포함한다. 스스로 수행하는 Gradle/Docker 빌드는 타이밍 표본과 순차 실행했다. **RSS는 heap이 아니다.** 첫 health 수신 직후 `ps -o rss= -p PID`로 RSS를 읽고, 추천 응답을 확인한 뒤 `jcmd PID GC.heap_info`로 heap used/committed를 별도 기록했다. 강제 GC는 하지 않았으며 값은 순간 스냅샷이고 peak/정상 부하 메모리가 아니다. jcmd attach는 latency/RSS 기록 후다. JDK 25 heap 출력의 reserved/committed 형식에 맞춰 파싱했다.

#### 첫 응답과 메모리 실측

명령 (`spikes/spring`): `python3 measure.py --project minimal`, `python3 measure.py --aot`, `python3 measure.py --database`, `python3 measure.py --aot --database --project jpa`. 원시 5회 표본·명령·RSS·heap 바이트 수는 `results/spring-minimal.json`, `spring-aot.json`, `spring-database.json`, `spring-aot-database.json`에 보관했다.

`fatjar-default`는 일반 Boot executable JAR, `extracted-default`는 Boot tools로 추출한 efficient layout, `cds`는 **같은 extracted layout + CDS**다. `aot`는 생성된 Spring AOT 코드가 든 executable JAR를 `-Dspring.aot.enabled=true`로 실행했다. GraalVM native와 JDK AOT cache는 측정하지 않았다.

| 구성/실행 모드 | 파일 | 새 JVM 5회 첫 응답(ms) | 평균(ms) | 평균 RSS(MiB) | 평균 heap used / committed(MiB) |
|---|---:|---|---:|---:|---:|
| minimal-fatjar-default | 130 KiB | 1077.8, 967.1, 976.5, 993.0, 1004.3 | 1003.74 | 190.27 | 22.01 / 37.20 |
| minimal-fatjar-default | 1 MiB | 974.1, 985.5, 1023.9, 991.9, 987.5 | 992.59 | 192.69 | 22.86 / 41.40 |
| minimal-extracted-default | 130 KiB | 837.4, 848.1, 873.6, 854.0, 855.8 | 853.77 | 185.24 | 26.13 / 41.00 |
| minimal-extracted-default | 1 MiB | 853.7, 854.3, 864.9, 849.4, 854.8 | 855.43 | 178.69 | 27.11 / 40.00 |
| minimal-cds | 130 KiB | 555.9, 552.9, 561.7, 549.5, 552.0 | 554.42 | 182.30 | 23.69 / 34.00 |
| minimal-cds | 1 MiB | 545.4, 551.7, 548.5, 543.5, 541.5 | 546.12 | 174.62 | 24.36 / 35.40 |
| minimal-aot | 130 KiB | 862.1, 869.2, 863.8, 860.3, 869.5 | 864.98 | 190.25 | 20.54 / 37.00 |
| minimal-aot | 1 MiB | 859.5, 869.9, 880.2, 873.4, 861.9 | 869.00 | 185.71 | 22.64 / 41.00 |
| jdbc-fatjar-default | 130 KiB | 1699.5, 1669.5, 1676.5, 1674.7, 1709.3 | 1685.90 | 294.57 | 30.37 / 54.40 |
| jdbc-fatjar-default | 1 MiB | 1691.0, 1696.8, 1691.1, 1683.4, 1682.3 | 1688.92 | 293.44 | 35.16 / 56.60 |
| jdbc-extracted-default | 130 KiB | 1475.1, 1462.1, 1492.7, 1480.4, 1503.3 | 1482.72 | 278.58 | 37.11 / 47.80 |
| jdbc-extracted-default | 1 MiB | 1495.3, 1507.0, 1465.2, 1474.0, 1484.4 | 1485.17 | 279.00 | 36.84 / 51.80 |
| jdbc-cds | 130 KiB | 960.5, 951.8, 967.5, 963.8, 954.3 | 959.57 | 262.06 | 38.54 / 47.40 |
| jdbc-cds | 1 MiB | 962.1, 965.9, 955.9, 972.8, 955.9 | 962.54 | 245.99 | 34.34 / 48.60 |
| jpa-fatjar-default | 130 KiB | 2580.2, 2359.6, 2414.9, 2344.5, 2383.5 | 2416.55 | 347.78 | 45.92 / 59.40 |
| jpa-fatjar-default | 1 MiB | 2352.7, 2353.8, 2421.8, 2385.1, 2325.4 | 2367.74 | 336.99 | 49.64 / 60.00 |
| jpa-extracted-default | 130 KiB | 2027.4, 1998.2, 1983.3, 1977.2, 2003.3 | 1997.88 | 333.86 | 39.49 / 57.40 |
| jpa-extracted-default | 1 MiB | 2025.0, 2019.6, 1993.0, 1992.5, 1993.9 | 2004.81 | 336.76 | 49.38 / 60.80 |
| jpa-cds | 130 KiB | 1120.4, 1120.6, 1134.4, 1130.1, 1149.4 | 1130.97 | 319.28 | 44.64 / 55.00 |
| jpa-cds | 1 MiB | 1125.7, 1130.6, 1122.9, 1131.9, 1132.6 | 1128.73 | 316.15 | 45.76 / 59.00 |
| jpa-aot | 130 KiB | 2092.3, 2058.1, 2108.3, 2073.5, 2072.4 | 2080.91 | 312.65 | 41.51 / 55.20 |
| jpa-aot | 1 MiB | 2098.4, 2128.2, 2095.0, 2092.3, 2092.0 | 2101.20 | 310.76 | 39.57 / 57.40 |

Ktor에도 같은 RSS/heap probe를 붙여 다시 측정했다(`python3 measure.py --ktor`, `results/spring-ktor-memory.json`). 기존 3절은 당시 측정값 그대로 보존했다. 아래 새 측정에서 MVC 최소 fat JAR는 Ktor 기본보다 약 0.60초 느리고, Spring CDS는 Ktor CDS보다 약 0.34초 느렸다(130 KiB). Ktor는 DB가 없으므로 실제 DB를 연결한 JDBC/JPA와의 차이를 순수 프레임워크 비용이라고 해석하면 안 된다.

| 구성/실행 모드 | 파일 | 새 JVM 5회 첫 응답(ms) | 평균(ms) | 평균 RSS(MiB) | 평균 heap used / committed(MiB) |
|---|---:|---|---:|---:|---:|
| ktor-default | 130 KiB | 441.7, 408.4, 379.7, 383.4, 385.7 | 399.76 | 109.83 | 14.53 / 34.00 |
| ktor-default | 1 MiB | 379.8, 378.2, 385.8, 393.0, 383.5 | 384.07 | 110.15 | 17.53 / 34.00 |
| ktor-cds | 130 KiB | 214.1, 210.3, 211.2, 206.2, 211.4 | 210.61 | 100.23 | 8.75 / 34.00 |
| ktor-cds | 1 MiB | 210.2, 214.0, 210.5, 209.0, 214.6 | 211.65 | 101.22 | 10.71 / 34.00 |

최소 MVC fat JAR → extracted layout 개선과 extracted → CDS 개선을 분리했다. 130 KiB 기준 1,003.74 → 853.77 → 554.42 ms다. 실제 DB JDBC는 1,685.90 → 1,482.72 → 959.57 ms, JPA는 2,416.55 → 1,997.88 → 1,130.97 ms였다. AOT 최소 MVC는 864.98 ms, JPA는 2,080.91 ms로 둘 다 이 측정에서 CDS 실행보다 느렸다. Spring AOT 코드와 CDS는 별도 변형이며 두 최적화를 합친 조합은 측정하지 않았다.

#### CDS 학습과 AOT에서 겪은 문제

공식 [Dockerfiles/CDS](https://docs.spring.io/spring-boot/reference/packaging/container-images/dockerfiles.html) 절의 efficient layout와 training run을 따랐다. 각 프로젝트에서 다음을 실행한다(실제 DB 구성에는 위 PostgreSQL 연결 설정도 제공).

```sh
java -Djarmode=tools -jar <fat-jar> extract --destination <extracted>
# extracted 디렉터리에서, 같은 heap/가상 스레드/DB 설정 적용
java -Xms32m -Xmx256m -XX:ArchiveClassesAtExit=application.jsa   -Dspring.context.exit=onRefresh -jar app.jar
java -Xms32m -Xmx256m -Xshare:on -XX:SharedArchiveFile=application.jsa -jar app.jar
```

학습은 context refresh 뒤 자동 종료하며 HTTP 호출을 하지 않는다. 이전 Ktor 학습은 두 HTTP route를 호출한 뒤 종료했으므로 학습 coverage까지 완전히 같은 비교는 아니다. CDS 사용은 `-Xshare:on`으로 강제해 fallback 실행을 성공으로 세지 않았다. 일부 proxy/JFR/CDS 제외 경고는 있었지만 최소/JDBC/JPA의 archive 학습·강제 사용은 성공했다. macOS archive를 Linux 이미지에 복사하지 않고 이미지 내부에서 다시 학습했다.

공식 [Spring AOT Gradle plugin](https://docs.spring.io/spring-boot/gradle-plugin/aot.html)을 직접 적용했다. 처음에는 runtime에만 가상 스레드를 켜서 AOT가 만든 handler thread가 일반 스레드가 됐다. `ProcessAot` task에도 `spring.threads.virtual.enabled=true`를 적용한 뒤 모두 virtual 검사를 통과했다. 파일 경로도 task의 하위 프로젝트 cwd를 고려해 절대 `DATA_FILE`로 지정했다. AOT는 빌드 시 조건을 고정하므로 운영에서도 빌드/런타임 설정을 맞춰야 한다.

추가 JDBC AOT는 실제 PG 설정을 전달해 시도했지만 `jdbcDialect`의 AOT 처리 중 `DataSourceProperties: Failed to determine a suitable driver class`로 실패했다. 환경변수와 명시적 task system property를 시도했고 자동 구성 제외나 dialect bean 교체로 성공 수치를 만들지 않았다. 이는 이번 구성의 미해결 AOT 문제이며 Spring Data JDBC AOT 전체가 불가능하다는 뜻은 아니다. JPA AOT는 별도 task로 빌드·JVM 실행해 위 수치를 얻었다. JDBC AOT 최적화는 후속 항목이다.

JDK 25에 대한 최신 Spring 문서는 CDS보다 **JDK AOT cache**를 권장한다([AOT cache 안내](https://docs.spring.io/spring-boot/how-to/aot-cache.html)). 이번 요청의 CDS와 Spring AOT JVM 모드를 우선 측정했으며 JDK AOT cache 수치를 대신 기재하지 않았다.

#### DB 없는 실제 의존성 구성의 실패

`full`은 DB URL·내장 DB가 없고 자동 구성 제외도 없어 DataSource 설정 단계에서 `Failed to configure a DataSource: 'url' attribute is not specified` / `Failed to determine a suitable driver class`로 실패했다. **130 KiB/1 MiB 각각 기본 fat JAR 5회 모두 실패**했고 첫 응답·RSS/heap 평균은 N/A다. lazy initialization만 켜도 각 5회 실패했고, extracted 각 5회 및 CDS training도 실패했다. AOT 코드는 빌드됐지만 runtime은 파일 크기별 5회 모두 실패했다(`results/spring-full.json`, `spring-aot.json`). 실패까지 경과 시간은 raw JSON에 있으나 HTTP 기동 시간으로 취급하지 않는다.

회피 방법은 JDBC/Flyway 자동 구성을 숨기는 대신 실제 DB URL/driver/접근 가능한 DB를 제공하는 것이다. 추가 요청의 `jdbc`/`jpa`가 이 방법을 실행해 성공했다. [추정] 운영에서 migration을 별도 job으로 옮기는 선택도 있지만 그때는 Flyway의 startup 작업과 기동 비교 조건이 달라진다. 이번 측정은 자동 구성과 startup migration 검증을 유지했다. lazy만으로 DB 문제를 해결하거나 실패를 늦춰도 서비스가 정상이라는 결론을 내리지 않는다.

#### Fat JAR 및 Docker 이미지 크기

`python3 docker-images.py`로 모두 실제 빌드했고 최소/JDBC/JPA **CDS Linux 이미지 3개를 직접 실행**해 두 route, virtual thread, `-Xshare:on`을 확인했다(`spring-docker-checks.json`). 실행 검증 뒤 테스트 컨테이너와 로컬 PG를 종료했다. 런타임은 이전 Ktor와 같은 `eclipse-temurin:25-jre`, linux/arm64다. 표는 `docker image inspect ... .Size`가 반환한 로컬 bytes이며 registry 압축 전송량이나 Cloud Run pull 시간은 아니다. DB 컨테이너 크기는 앱 이미지에 포함하지 않았다. AOT Docker 이미지는 별도 빌드하지 않았다.

| 구성 | fat JAR bytes | AOT fat JAR bytes | fat JAR Docker bytes (MiB) | extracted Docker bytes (MiB) | CDS Docker bytes (MiB) |
|---|---:|---:|---:|---:|---:|
| minimal | 25,645,527 | 25,780,795 | 542,653,124 (517.51) | 542,246,458 (517.13) | 593,956,010 (566.44) |
| full | 31,305,070 | 31,599,250 | 553,252,105 (527.62) | N/A | N/A |
| jdbc | 34,253,507 | N/A | 558,808,980 (532.92) | 558,457,421 (532.59) | 634,425,050 (605.03) |
| jpa | 60,104,633 | 60,466,781 | 607,917,775 (579.76) | 607,600,901 (579.45) | 727,812,435 (694.10) |

| 구성 | macOS CDS archive bytes | Linux CDS archive bytes |
|---|---:|---:|
| minimal | 40,861,696 | 40,632,320 |
| jdbc | 60,063,744 | 59,768,832 |
| jpa | 95,420,416 | 95,158,272 |

Ktor의 기존 Docker `.Size`는 549,130,382 B였다. Boot 최소 구성 이미지가 반드시 더 크지는 않았지만 JDBC/JPA와 CDS archive를 넣으면 이미지가 커졌다. [추정] 증가한 registry 전송·pull/저장소 비용은 Cloud Run 시작에도 영향을 줄 수 있으나 로컬 `.Size` 차이를 추가 콜드스타트 초로 환산할 근거는 없다. 상세 이미지 ID/플랫폼은 `spring-images.json`, artifact byte 수는 `spring-artifact-sizes.json`에 있다.

#### 재현과 남은 검증

독립 `spring/settings.gradle.kts` 및 자체 하위 프로젝트 설정을 사용한다. 전체 명령은 [spring/README.md](spring/README.md)에 있으며 `spikes/` 밖의 설정은 필요 없다.

```sh
# spikes 기준
./bootstrap-gradle.sh
.tools/gradle-9.3.1/bin/gradle -p spring bootJar --console=plain
cd spring
python3 measure.py --project minimal
python3 measure.py --project full
../.tools/gradle-9.3.1/bin/gradle -Paot :minimal:bootJar :full:bootJar --console=plain
python3 measure.py --aot
python3 measure.py --ktor  # 기존 Ktor installDist/archive 필요

docker run --rm -d --name banbanyeok-spring-pg -p 127.0.0.1:18543:5432   -e POSTGRES_DB=spike -e POSTGRES_USER=spike -e POSTGRES_PASSWORD=local-spike-only postgres:18
docker exec banbanyeok-spring-pg pg_isready -U spike -d spike
# DB ready 후 순차 실행; 각 명령은 결과 JSON을 덮어씀
python3 measure.py --database
../.tools/gradle-9.3.1/bin/gradle -Paot -PdatabaseAot :jpa:bootJar --console=plain
python3 measure.py --aot --database --project jpa
python3 docker-images.py
docker stop banbanyeok-spring-pg
```

[추정] Cloud Run min 0에서는 최소 MVC·JDBC·JPA의 로컬 차이에 플랫폼 준비·실제 할당 CPU·DB 리전/연결 지연이 추가된다. 계정 확보 후 같은 서울 리전/CPU/메모리에서 Ktor·Boot JDBC·Boot JPA의 기본/CDS를 측정하고, first response와 DB-ready 구간·peak RSS를 분리해야 한다. 현재 수치로 min 1 필요 여부나 3초 보장을 결정하지 않는다. 로컬 후속은 JDBC AOT 바인딩 문제 해결, JDK 25 AOT cache, 실제 추천 SQL/동시 요청 메모리 측정이다. GraalVM native는 요청대로 생략했다.

### 5. Cloud Run 서울 콜드스타트 실측

**권고: Ktor + 코루틴(AppCDS, startup CPU boost 켬, min 0)을 선택한다.** 위 맨 위 표가 클라이언트 콜드 p50/p90·웜 p50 및 3초 판정이다. Ktor AppCDS+boost는 콜드 p90 **1.392초**, 모든 콜드 표본이 3초 이내였다. 반면 MVC+CDS는 p90 **3.675초**로 10회 중 7회, JDBC/JPA+CDS는 각각 **5.737/5.996초**로 10회 모두 3초를 넘었다. DB 연결·migration 비용을 이미 제외한 결과다. min 1을 별도로 측정하지 않았으므로 상시 가동 필요를 증명한 것은 아니지만, 정해진 “min 0에서 3초를 넘는 Spring을 위해 상시 가동하지 않고 Ktor로 간다” 규칙에 따라 Ktor를 권고한다.

#### 환경과 콜드 강제 방법

- GCP 구성 `banbanyeok`, 프로젝트 `banbanyeok-7eoxn`, 리전 `asia-northeast3`만 사용했다. 모든 gcloud 호출 앞에 `export CLOUDSDK_ACTIVE_CONFIG_NAME=banbanyeok`를 실행하고 project도 명시했다.
- 5개 대상 모두 **linux/amd64, Temurin 25.0.5, 1 vCPU, 512 MiB, gen2, min-instances 0, request-based CPU throttling**, JVM `-Xms32m -Xmx256m`, 1 MiB 파일 preload다. 메모리를 1 Gi로 올리지 않았다. 앱 소스·Ktor/Boot 버전은 기존 스파이크 그대로다. 대상 이미지·ID·플랫폼은 `cloudrun/results/images.json`.
- startup CPU boost **켬/끔 각각** 새 리비전 10개, 리비전마다 첫 `/v1/recommend` 1회 + 즉시 두 번째 요청 1회. 총 **콜드 100회·웜 100회**다. 다섯 서비스는 라운드별로 병렬 배포했고, 동일 맥에서 호출했다.
- 매 표본 `SPIKE_SAMPLE` 변경 + 새 revision suffix + **`--no-traffic --tag=<고유 태그> --no-deploy-health-check`**. 일반 서비스 URL 대신 해당 새 태그 URL만 최초 호출했다. min 0, 태그의 일반 트래픽 할당 0%를 readback했다. revision max 1, service max 5로 설정했으나 실제 임시 중첩 기동은 일부 리비전에서 2개까지 관측돼 원시 count를 보존했다.
- 100개 최종 리비전 전부 시작 로그가 있고, 첫 호출 이전의 기동/DEPLOYMENT_ROLLOUT는 발견되지 않았다(`cold-proof.json`, `startup-logs.json`). 요청/로그 시계의 150 ms 허용 범위를 두고 검사했으며 실제 시작 시각 차이도 저장했다.
- `gcloud auth print-identity-token`을 라운드 배포 전에 실행했다. 토큰은 메모리/curl stdin으로만 전달하고 결과에 저장하지 않았다. curl `time_total`은 DNS/TLS·네트워크·본문 수신을 포함하고, 토큰 발급·gcloud 배포·프로세스 launch 시간은 제외한다. 첫 응답 직후 동일 태그로 보낸 두 번째 요청을 웜 표본으로 정의했다. 호출마다 새 연결이므로 웜에도 TLS 비용이 포함된다.
- [공식 SDK](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy)의 `--no-deploy-health-check`만으로는 트래픽 전환에 따른 선기동을 완전히 막지 못했다. 초기 일반 URL rollout 표본 30쌍은 통계에서 제외하고 `rollout-preflight.json`에 별도 보관했다. 최종 고유 태그 프로토콜로 전부 새로 시작했다.

#### DB 없이 남긴 초기화와 끈 기능

| 설정 | 값/동작 | 제외된 비용 / 남은 비용 |
|---|---|---|
| DataSource/Hikari 자동 구성 | 활성; `initialization-fail-timeout=-1`, `minimum-idle=0`, `maximum-pool-size=1` | 시작 시 연결 시도/idle pool 사전 채움 없음. DataSource와 프레임워크 구성 유지 |
| DB URL | 사용하지 않는 로컬 주소, PostgreSQL driver 포함 | 실제 DB는 생성·연결하지 않음 |
| Spring Data JDBC dialect | `spring.data.jdbc.dialect=postgresql` | dialect 추정을 위한 DB metadata 조회 없음; 저장소 3개 초기화 유지 |
| Hibernate metadata | `hibernate.boot.allow_jdbc_metadata_access=false` | JDBC metadata 연결 없음 |
| Hibernate dialect | `org.hibernate.dialect.PostgreSQLDialect` 직접 지정 | 자동 dialect 탐지 없음; ORM/EntityManagerFactory·엔티티 3개·저장소 3개 초기화 유지 |
| Hibernate schema | `ddl-auto=none`, `open-in-view=false` | DB schema validate/create 없음 |
| Flyway/SQL init | `spring.flyway.enabled=false`, `spring.sql.init.mode=never` | migration·SQL 스크립트 실행은 서버 시작에서 제외. migration 의존성은 JAR에 남음 |
| Actuator DB health | `management.health.db.enabled=false` | health probe의 DB 연결도 하지 않음; Actuator 자체는 유지 |
| MVC 실행 | `spring.threads.virtual.enabled=true` | 가상 스레드 설정 유지 |

설정 원본은 `cloudrun/offline.properties`다. JDBC/JPA auto-configuration을 제외하지 않았다. JPA 로그에서 Hibernate ORM과 EntityManagerFactory 초기화가 실제 수행됨을 확인했다. 따라서 실제 DB를 붙인 4절 수치와 조건이 다르며 이 표는 **DB 없는 프레임워크 초기화 비용** 비교다. [추정] 운영에서는 실제 DB 연결/쿼리·데이터 다운로드가 더해질 수 있다.

#### 클라이언트와 Cloud Monitoring 측정 표

단위 ms. 각 조건의 클라이언트 n은 콜드 10/웜 10이다. `container/startup_latencies`는 **`run.googleapis.com/container/startup_latencies`** 원본 분포에서 리비전별 count 가중 평균을 구한 뒤 그 10개(또는 9개)의 p50/p90을 계산했다. 클라이언트 수치와 동일한 지표가 아니며 둘을 서로 대체하지 않았다.

| 대상 | boost | 클라이언트 콜드 p50 / p90 | 웜 p50 | 3초 초과 / 10 | container startup p50 / p90 | metric 리비전 n |
|---|---|---:|---:|---:|---:|---:|
| Ktor 기본 | 켬 | 1973.2 / 2192.3 | 87.4 | 0 | 1455.5 / 1599.0 | 10 |
| Ktor AppCDS | 켬 | 1109.7 / 1392.1 | 87.5 | 0 | 756.8 / 1000.4 | 10 |
| Spring MVC 최소+CDS | 켬 | 3312.4 / 3675.0 | 89.1 | 7 | 2746.7 / 3147.4 | 9 |
| Spring Data JDBC+CDS | 켬 | 4573.2 / 5736.7 | 89.9 | 10 | 4116.7 / 5147.0 | 10 |
| Spring Data JPA+CDS | 켬 | 5605.8 / 5996.4 | 86.5 | 10 | 5096.2 / 5463.5 | 10 |
| Ktor 기본 | 끔 | 3013.7 / 3300.1 | 90.3 | 5 | 2295.7 / 2487.2 | 10 |
| Ktor AppCDS | 끔 | 1895.6 / 2607.8 | 90.3 | 1 | 1295.8 / 1944.1 | 10 |
| Spring MVC 최소+CDS | 끔 | 5489.8 / 6134.2 | 90.7 | 10 | 4617.3 / 5188.7 | 10 |
| Spring Data JDBC+CDS | 끔 | 8940.8 / 10817.8 | 88.6 | 10 | 8079.3 / 10196.1 | 9 |
| Spring Data JPA+CDS | 끔 | 9818.6 / 10928.0 | 100.5 | 10 | 8913.5 / 10003.8 | 10 |

원시 데이터는 `cloudrun/results/requests.json`(각 콜드/웜·시각·revision·DNS/TLS/TTFB), `startup-latencies.json`(Cloud Monitoring 분포), `summary.json`(통계)에 있다. p50은 가운데 두 값 평균, p90은 nearest-rank(10개 중 정렬 9번째)다. n=10은 작은 표본이며 실제 서비스 p90 보장을 의미하지 않는다.

Metric descriptor는 단위 ms, sample period 60 s, ingest delay 120 s, launch stage BETA라고 응답했다(`metric-descriptor.json`). 재조회해도 **MVC boost 켬 한 리비전과 JDBC boost 끔 한 리비전**은 count 없는 빈 분포만 반환했다. 이 2개는 값 0이나 클라이언트 시간으로 채우지 않고 `monitoring_status=no_nonzero_distribution`, 값 null로 남겼다(`monitoring-missing.json`). 그래서 두 metric 통계의 n은 9이고, 전체 Cloud Monitoring 관측은 98/100이다. 해당 리비전의 클라이언트 시간·시작 로그는 정상 수집했다. 일부 리비전의 metric/log start count는 2였으며 per-revision 평균에 반영했다.

#### 문제·중단과 재현

Ktor AppCDS 초기 이미지는 `/app/lib/*`의 JAR 열거 순서가 빌드/Cloud Run에서 달라 shared class paths mismatch로 HTTP 503이 났다. **정렬한 절대 클래스패스 문자열을 이미지의 `/app/classpath.txt`에 저장해 학습/실행에 똑같이 사용**한 뒤 해결했다. 최종 모든 CDS 실행은 `-Xshare:on`으로 강제했고 archive를 macOS에서 복사하지 않았다. Spring은 같은 amd64 이미지에서 Boot `spring.context.exit=onRefresh`로 학습했다.

일반 트래픽 rollout preflight에서 선기동·HTTP 500(원인 미확정)도 관측해 전부 제외했다. 최종 태그 측정 도중에는 로컬 실행의 긴 간격과 curl 타임아웃이 관측됐다. 성공 완료된 82쌍은 보존하고 누락분은 fresh token + 새 `u-` 태그 리비전으로 보충했다. 타임아웃 값을 정상 기동 시간으로 넣거나 이미 호출한 리비전을 콜드로 다시 세지 않았다. 이 때문에 측정은 연속 단일 세션이 아니며 시점별 외부 네트워크/플랫폼 변동이 섞일 수 있다. 전체 시각과 최대 간격은 `session-notes.json`, 제외한 프로토콜/오류는 `protocol-changes.json`이다.

실행 명령은 [cloudrun/README.md](cloudrun/README.md)에 정리했다. 로컬 Docker로 빌드·push했으므로 Cloud Build/API 추가 활성화나 GCS 버킷은 사용하지 않았다. 재실행 시 완료된 `results/`는 먼저 별도 폴더로 보존하고 새 결과 폴더를 만든다.

```sh
cd spikes/cloudrun
python3 build.py
python3 measure.py
# 마지막 표본의 Monitoring 수집 지연을 고려한 뒤
python3 monitor.py
python3 logs.py
python3 prove-cold.py
python3 audit.py
python3 summarize.py
python3 cleanup.py
```

#### 비공개 설정·삭제 확인

5개 서비스 모두 `--no-allow-unauthenticated`로 배포했고 public IAM binding이 없었다. 인증 없는 테스트는 5개 모두 HTTP 404로 거절됐다(403이라고 바꾸어 기록하지 않았다). 서비스 설정 readback은 1 CPU/512Mi/gen2/concurrency 1과 태그의 일반 트래픽 0%를 확인했다(`privacy-checks.json`, `configuration-audit.json`). 전용 runtime 서비스 계정에는 데이터 접근 역할을 부여하지 않았다. 토큰·개인 이메일·로컬 절대 경로/사용자 이름은 새 결과에 저장하지 않았다.

| 리소스 | 삭제 및 재확인 |
|---|---|
| Cloud Run 서비스 5개 | 각각 delete exit 0, describe에서 NOT_FOUND/찾을 수 없음 확인; 하위 revision/tag 포함 삭제 |
| Artifact Registry 저장소 1개 및 모든 이미지 | delete exit 0, 저장소 describe NOT_FOUND 확인 |
| 전용 runtime 서비스 계정 1개 | delete exit 0, active 계정 목록의 정확한 이름 필터가 0건. 삭제 후 describe는 PERMISSION_DENIED/존재하지 않을 수 있음으로 응답해 그것만으로 판단하지 않았음 |
| GCS 버킷 | 생성하지 않음 |
| 임시 로컬 credential/log 디렉터리 | `.private/` 삭제 확인 |

삭제와 재확인 시각·리소스별 결과는 `cloudrun/results/cleanup.json`에 있다. 기존 사용자 리소스/다른 GCP 구성·프로젝트는 수정하지 않았으며 Git commit/push도 하지 않았다. 실제 청구액은 이번 측정에서 조회·추정하지 않았다.

## 문제와 해결

- **npm 최신 패키지 설치 차단:** 로컬 npm에 7일 `min-release-age` 정책이 있어 현재 안정 OpenNext 설치가 ETARGET으로 실패했다. 이 격리 스파이크 명령에만 `--min-release-age=0`을 적용했고 전역 설정은 바꾸지 않았다. 버전은 package-lock으로 고정했다.
- **Turbopack의 외부 symlink:** Gradle `build/dist`를 `file:../...` 링크로 설치하면 앱 루트 밖이라 `Can't resolve fair-core`가 발생했다. Turbopack root를 `spikes/`로 올리면 Next 자체는 성공했다.
- **OpenNext standalone 경로 불일치:** 위 우회는 `.next/standalone/web/.next`를 만들었지만 OpenNext가 `.next/standalone/.next/server/pages-manifest.json`을 찾아 실패했다. 최종 해결은 **Gradle production library를 `npm pack` → 앱의 `out/*.tgz`로 설치**하여 symlink를 제거하고 Turbopack root를 앱 자체로 복원한 것이다. 그 뒤 OpenNext도 성공했다. 루트 모노레포를 바꾸는 임시 해결은 사용하지 않았다.
- **JS IR 설정 경고:** Kotlin 2.4는 IR만 지원하여 명시적 `js(IR)`가 deprecated라는 경고를 냈다. 스파이크는 요청 타깃을 명시하기 위해 유지했다. 제품 설정에서는 `js {}`를 쓰면 된다.
- **타입 경계:** `IntArray`를 number[]로 넘기지 않고 `Int32Array`로 변환한다. nullable Kotlin 컬렉션·제네릭 DTO의 export 품질까지 검증한 결과는 아니다.
- **OG 한국어:** 기본 라틴 폰트에 의존하지 않고 Noto Sans CJK KR OTF를 제공했다. CFF OTF를 ImageResponse가 처리했고 생성 PNG에서 한글이 정상임을 확인했다. 폰트 라이선스는 `web/public/fonts/OFL.txt`, 원본은 Noto 저장소에서 재다운로드하며 전체 16 MB 파일은 Git 제외다.
- **의존성 감사:** 설치 당시 `npm audit`에 OpenNext 전이 `glob/minimatch` 경로의 moderate 3건이 있었다(`results/npm-audit.json`). 이 결과는 배포 승인이 아니다. 실제 제품 도입 시 업데이트/영향 범위 검토가 필요하다.

## 재현 명령

필요 도구: JDK 25, Node 24/npm, Python 3, curl/unzip, Docker. 브라우저 자동 검증은 설치된 Google Chrome 사용. `spikes/`에서 실행한다.

```sh
# 전체 JS + 폰트 + Next/OpenNext 준비. Gradle과 Python venv는 .tools에만 생성.
./build-web.sh

# 알고리즘 오라클 검증
(cd kotlin-js && node check.mjs)

# 두 bundler 및 gzip 증분 비교
cd web
npm run build
node measure-bundles.mjs turbo
# 별도 터미널: npx next start --port 18300
LABEL=turbo node verify-browser.mjs
# 위 서버를 종료한 뒤 다음 빌드
npm run build:webpack
node measure-bundles.mjs webpack
# 별도 터미널: npx next start --port 18300
LABEL=webpack node verify-browser.mjs
# 위 서버 종료 후: stub 대조 빌드, 종료 시 원래 소스 자동 복원
node compare-baseline.mjs
# 대조 산출물을 실제 앱 빌드로 복원
npm run cf:build
npx wrangler deploy --dry-run --outdir out/worker
npm run cf:preview
# 다른 터미널에서 spikes/web 기준:
URL=http://localhost:18787 LABEL=cloudflare node verify-browser.mjs
curl -f http://localhost:18787/ssg
node measure-og.mjs
# wrangler는 Ctrl-C로 종료
```

```sh
# spikes 기준; 데이터 파일 생성도 measure.py가 수행
cd ktor
../.tools/gradle-9.3.1/bin/gradle installDist --console=plain
python3 measure.py
# Linux 컨테이너 이미지 (AppCDS 제외)
docker build -t banbanyeok-s0b-ktor .
docker image inspect banbanyeok-s0b-ktor --format '{{.Size}}'
docker run --rm -d -p 18081:8080 --name banbanyeok-s0b banbanyeok-s0b-ktor
curl -f http://localhost:18081/healthz
docker stop banbanyeok-s0b
```

`bootstrap-gradle.sh`는 Gradle 9.3.1을 `spikes/.tools`로 받는다. `prepare-fonts.sh`는 Noto 원본을 다운로드하고 fonttools 4.68.0/brotli 1.2.1로 서브셋을 만든다. Noto 원본은 upstream main URL이므로 원본 변경 시 폰트 byte 수는 달라질 수 있다. 재측정 시 결과 JSON은 덮어쓴다. `.gitignore`는 빌드·node_modules·로컬 로그·PNG·전체 폰트를 제외한다. 보관된 JSON은 이번 측정의 실제 수치다.

## 계정이 있어야 할 후속 측정

1. **Cloudflare:** 실제 업로드에서 Worker startup CPU/시간·메모리·번들 검증, 무료 플랜의 OG 첫 요청/반복 요청 `cpuTime`와 wall time을 invocation logs/trace로 구분해 측정한다. SSG 최초 요청의 Worker 경유/캐시 정책과 OG CDN 캐시 키·무효화도 검증한다. 10 ms 초과 시 결과별 사전생성/캐시 또는 OG 실행 위치를 재평가한다.
2. **GCP:** 서울 Cloud Run min 0에서 scale-to-zero 후 충분한 간격으로 5회 이상, 130 KiB/1 MiB 각각 기본 JVM/AppCDS/기동 CPU boost별 첫 health와 실제 추천 응답을 재측정한다. 이미지 pull/컨테이너 시작/파일 다운로드·검증·파싱/DB 연결/서버 준비 구간을 분리한다. min 1 또는 다른 호스팅 판단은 이 결과로 한다.
3. **GCP 배포 이미지:** 목표 아키텍처를 고정하고 Linux 이미지 안에서 AppCDS를 학습해 다시 측정한다. Docker registry compressed 크기와 첫 pull 시간을 기록한다. 현재 Docker arm64 이미지 크기를 Cloud Run amd64 수치로 대체하지 않는다.
4. **선택 로컬 후속(계정 불필요):** GraalVM native-image를 별도로 설치할 수 있는 환경에서 Netty 리플렉션/리소스 설정 및 native 이미지 크기·기동 시간을 측정한다. 현재는 미측정이다.

기술 문서 근거: [Kotlin JS 프로젝트 설정](https://kotlinlang.org/docs/js-project-setup.html), [OpenNext Cloudflare 시작](https://opennext.js.org/cloudflare/get-started), [Next ImageResponse](https://nextjs.org/docs/app/api-reference/functions/image-response). 문서 사실과 로컬 실측을 구분했으며, 운영 성능 수치를 추정으로 채워 넣지 않았다.
