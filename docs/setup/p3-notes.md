# P3 서버 작업 노트 (Ktor)

작성 2026-11-14. 우선순위 문서: [01-synthesis](../01-synthesis.md) → [tech-stack 5장](../research/tech-stack.md) → [contracts/openapi.yaml](../../contracts/openapi.yaml). 이 노트는 구현하며 정한 것, 근거, 제안, 남은 결정을 모은다.

## 1. 구성

```
server/
  app/             진입점·설정·HTTP 라우트·조립(composition root). 기능 모듈을 여기서만 잇는다
  room/            방·참여자·토큰·만료·숨기기. RoomRepository(메모리 fake + Exposed), Liquibase 스키마와 짝
  recommendation/  shared:core rank + shared:app-logic 문장 어댑터, od.bin 기반 TravelTimeProvider
  artifact/        ArtifactStore 포트(로컬 파일·GCS), manifest 로더(검증 실패 시 기동 실패)
  db/changelog/    Liquibase SQL changelog (서버는 시작할 때 실행하지 않는다)
```

- **DI 프레임워크 없음.** `CompositionRoot.create(config)`가 생성자 주입으로 직접 엮는다. 서비스(`RoomService`, `RecommendationService`, `RoomResultService`…)는 Ktor를 모르는 일반 클래스이고 라우트(`http/Routes.kt`)는 얇다.
- 기능 모듈끼리 의존하지 않는다. 두 모듈이 만나는 곳은 app뿐이다: `StationDirectory`가 현재 산출물 하나를 room의 `StationCatalog`와 recommendation의 `TravelTimeProvider`·`StationNames`로 보여 주고, `RoomResultService`가 room에서 참여자를 읽어 recommendation에 계산을 맡긴다.
- 포트: `RoomRepository`·`AnonUserRepository`(메모리 fake / Exposed), `ArtifactStore`(로컬 파일 / GCS), `TravelTimeProvider`(od.bin), `Clock`(JDK `java.time.Clock`을 그대로 쓴다), `IdGenerator`(`SecureRandomIdGenerator` / 테스트용 순차 생성기).
- Konsist 규칙(architecture/)을 추가했다: 기능 모듈은 app·`io.ktor`를 import하지 못한다 / `org.jetbrains.exposed`는 room의 `exposed` 패키지에서만, `com.google.cloud`는 `GcsArtifactStore`에서만 / app의 `application` 패키지는 Ktor를 모른다 / 서버 테스트는 H2나 Exposed 목을 쓰지 않는다. 기존 "기능 모듈끼리 의존 금지" 규칙은 이제 실제 모듈에 적용된다.
- build-logic: `banbanyeok.server-lib`(기능 모듈, testFixtures 포함) 컨벤션을 추가했고 `server-app`을 채웠다(installDist가 Docker용 정렬된 클래스패스 파일을 만든다). 모듈 구조가 바뀌어 `server/` 루트 프로젝트의 자리표시 서버(JDK HttpServer)는 지웠다.

## 2. 구현한 것

| 영역 | 내용 |
|---|---|
| 엔드포인트 | openapi.yaml의 전부: `POST /anon`, 방 생성·조회·수정(PATCH)·삭제, 참여, 참여자 수정·삭제(본인 또는 방장 강퇴), 결과, outcome, `POST /recommend`, `/manifest`(ETag·304·max-age=60), `/data/{version}/{file}`(immutable), `/healthz` |
| 신원 | 익명 사용자 ID(`u_`+128비트 이상). 방 관리 토큰·참여자 토큰·기기 토큰은 256비트 무작위. **저장은 `HMAC-SHA256(pepper, token)` 해시만**, 비교는 상수 시간. pepper는 설정(`TOKEN_PEPPER`). 토큰은 `Authorization: Bearer`로만 받는다 |
| 권한 | 토큰이 없거나 이 방 것이 아니면 401, 유효하지만 권한이 없으면 403(남의 항목 수정, 방장 전용 작업을 참여자 토큰으로 시도 등). 선택 인증(방·결과 조회)에서 잘못된 토큰은 익명으로 본다 |
| 숨기기 | 숨긴 참가자의 **`originCode`·`originName`만 null**. 시간·환승은 그대로 보인다. 본인 participantToken이면 본인 항목은 보인다. 방장 토큰만으로는 자기 숨김 출발역도 가려진다(participantToken을 같이 보내야 한다) |
| 만료 | 마지막 쓰기 후 7일(슬라이딩), 생성 후 최대 30일, 약속일이 있으면 약속일 다음 날 0시(한국 시간, 최대 30일). **읽을 때 판정**(만료된 방은 없는 방, 404 `ROOM_NOT_FOUND`)하고 **정리 명령**(`cleanup`)이 실제로 지운다. 익명 사용자는 90일 무활동·참조 없음일 때 지운다 |
| 정원 | 최대 4명(방 행 `SELECT … FOR UPDATE` + DB 트리거), `expectedCount`에 도달하면 `locked=true`로 보이고 참여는 `ROOM_FULL` |
| 추천 | `shared:core` rank(허용오차 0초). 상위 3개 카드, 시간은 정수 초 그대로, `reason`은 `shared:app-logic`의 `ReasonGenerator`로 서버가 만든다 |
| 보호 | 기본 속도 제한(전체/변경/생성 3종 토큰 버킷, `Retry-After`), 요청 크기 16 KiB(413), CORS는 설정의 웹 오리진만, `Idempotency-Key`(방 생성·참여), 응답 `Cache-Control: no-store`(산출물 제외), 요청 로그에 방 ID·참여자 ID·토큰·쿼리를 남기지 않는다(경로는 `/v1/rooms/{roomId}`로 가려 기록) |
| 설정 | `AppConfig`(타입 있는 클래스). 기본은 local 프로필(개발용 기본값), 환경 변수로 덮어쓴다. **`APP_PROFILE=prod`는 필수값(`DATABASE_URL`·`DATABASE_USER`·`DATABASE_PASSWORD`·`TOKEN_PEPPER`·`ARTIFACT_GCS_BUCKET`·`CORS_ALLOWED_ORIGINS`)이 하나라도 없으면 모든 누락을 모아 기동 실패**한다(값은 메시지에 싣지 않음). prod는 pepper 32자 이상·로컬 기본값 금지·https 오리진·로컬 파일 저장소 금지를 추가로 강제한다 |
| 산출물 | 시작할 때 `manifest.json`이 가리키는 파일을 읽어 data-format.md §5 순서(해시·길이·헤더·상호 일치·후보 축)로 검증한다. 실패하면 `ArtifactLoadException`으로 기동 실패. 로컬은 `data/artifacts/dev` |

## 3. 계약(openapi.yaml)을 바꾼 것

구현하며 확인된 계약의 빠진 부분과, 코디네이터 요청(2026-11-14)을 반영했다. 전부 추가 또는 설명 보강이고 기존 필드·형태는 바꾸지 않았다. 웹 생성물(`web/src/lib/api/schema.gen.ts`)을 재생성해 같은 PR에 넣었다.

| 변경 | 이유 |
|---|---|
| `GET /healthz` 추가 | 웹이 입력 화면에서 서버를 미리 깨우는 `/healthz`(rewrite 대상은 서버 루트 `/healthz`)가 계약에 없었다. 서버는 루트 `/healthz`와 `/v1/healthz` 둘 다 같은 응답(`ok`)을 준다 |
| `POST /recommend`에 선택 필드 `nicknames`(참가자별 별칭, `origins`와 같은 길이, `null` 허용) | 별칭 없이 서버가 문장을 만들면 첫 참가자를 "나"로 써서, 링크를 받은 사람에게는 "나는 0분"처럼 반대로 읽힌다. 응답 `participants[].nickname`에도 실린다 |
| `Candidate.reason`: **시점 표현 금지** 명시 | 문장은 이름으로만 쓴다. 이름은 별칭, 없으면 참가자 순서의 A/B/C/D(`/recommend`는 입력 순서, 방은 참여 순서). 같은 별칭이 둘 이상이면 "민수(A)". 보는 사람 표시("(나)")는 클라이언트 몫 |
| `Error` 스키마에 서버가 내는 오류 코드 표 | 코드 목록을 상태별로 문서화. **`enum`으로 만들지 않았다**: 생성되는 TS 타입이 유니온이 되면 웹의 `{code: "UNKNOWN"}` 같은 클라이언트 쪽 코드가 타입 오류가 되기 때문이다. 필요하면 웹 후속 작업에서 enum으로 좁힌다 |
| 출발역 오류 코드: `INVALID_STATION`(400, 데이터에 없는 출발역), `STATION_UNAVAILABLE`(409, 방을 만든 뒤 데이터가 바뀌어 참가자 출발역이 없을 때 결과 계산) | 출발역이 데이터에 없을 때의 코드 |
| 출발역에서 갈 수 없는 후보가 있어 공통 후보가 없을 때는 오류가 아니라 `Result.status = no_common_candidate` | 도달 불가 처리. 기존 의미를 `status` 설명에 명시했다. 별도 오류 코드를 만들지 않은 이유: 한 사람이라도 못 가는 후보가 있는 건 정상 상황이고(후보 중 일부만 제외), 모두가 갈 수 있는 후보가 없을 때만 빈 결과이기 때문이다 |
| `updateRoom`·`updateParticipant`·`answerOutcome`·`deleteRoom` 등에 400/401/403/404/429 보강 | 구현이 실제로 내는 상태 코드가 계약에 없었다(응답 검증이 잡아냈다) |
| 공통 규칙 설명: 413, 429/`Retry-After`, `Idempotency-Key` 동작 | 구현 확정 사항 |

## 4. 선택과 근거

### 버전 (확인일 2026-11-14, 게시일은 Maven Central 디렉토리 목록)

| 라이브러리 | 버전 / 게시일 | 비고 |
|---|---|---|
| Exposed (core·jdbc·java-time) | 1.6.1 / 2026-11-04 | 1.x 패키지(`org.jetbrains.exposed.v1`). 최신 1.6.1이 7일 이상 지났다 |
| HikariCP | 7.1.0 / 2026-06-14 | |
| google-cloud-storage | 2.76.0 / 2026-10-27 | 2.77·2.78은 11-05·11-06이라 7일이 지나지 않았거나 경계라 한 단계 낮춰 고정했다 |
| Liquibase (테스트용 라이브러리) | 4.33.0 / 2025-07-09 | compose의 마이그레이션 컨테이너와 같은 버전. 5.x는 라이선스가 바뀌어 제외(S1 결정 유지) |
| openapi-request-validator | 3.0.0 / 2026-05-13 | 4절 계약 검증 참고 |
| Ktor, Kotest, MockK, Testcontainers, 기존 항목 | 카탈로그 그대로 | Ktor 3.6.1 모듈: server-core·netty·content-negotiation·serialization-kotlinx-json·status-pages·cors·body-limit |
| JRE 이미지 | `eclipse-temurin:25.0.5_8-jre-noble` | mise.toml의 JDK(temurin 25.0.5+8)와 같은 빌드. 이 태그는 2026-11-12에 OS 패치로 다시 빌드됐다 |
| 테스트 이미지 | `fsouza/fake-gcs-server:1.56.1`(2026-08-24), 비교용 `floci/floci-gcp:0.12.0`(2026-10-31), `postgres:17.6` | |

### GCS 에뮬레이터: fake-gcs-server 채택

같은 `ArtifactStore` 계약 테스트(10개: 읽기·쓰기·`ifMatch` 조건부 쓰기·ABSENT·동시 쓰기 8개 중 1개만 성공·접두사 목록·키 검증)를 **두 에뮬레이터 모두 통과**했다(각 4회 반복, 모두 통과). 조건부 쓰기(`ifGenerationMatch`, `doesNotExist`)는 둘 다 지원한다.

| | fake-gcs-server 1.56.1 | floci-gcp 0.12.0 |
|---|---|---|
| 계약 테스트 | 10/10 | 10/10 |
| 이미지(arm64 로컬) | 80.9 MB | 275 MB |
| 계약 테스트 소요 | 6.4초 | 7.1초 |
| 범위 | GCS 전용, 성숙(1.x, 릴리스 계속) | GCP 전반 에뮬레이터(0.x), 릴리스 2주 간격, 매일 nightly |

**fake-gcs-server를 고른 이유**: 둘 다 핵심(조건부 쓰기)을 통과해서 차이는 운영 쪽이다. 필요한 것이 GCS뿐이라 범위가 좁고, 1.x로 안정적이며, 이미지가 작아 CI 시간·용량이 적다. floci-gcp는 0.x이고 API 전반을 다뤄 변동 가능성이 크다. 비교 테스트는 남겨 두었다: `GCS_EMULATOR_COMPARE=1 ./gradlew :server:artifact:integrationTest`가 floci-gcp로 같은 계약을 다시 돌린다(기본 CI에서는 제외). 나중에 더 좋은 에뮬레이터가 나오면 이 한 줄로 비교한다.

한계: 에뮬레이터는 인증·IAM·실제 일관성 모델을 흉내 내지 않는다. 실제 GCS 스모크는 P8 몫이라 만들지 않았다. 인증은 Application Default Credentials(Cloud Run 서비스 계정)뿐이고 키 파일 경로를 읽는 코드는 없다.

### 응답의 openapi.yaml 검증: `openapi-request-validator` 3.0.0

`OpenApiContract`(app 테스트)가 모든 응답의 상태 코드·Content-Type·본문을 `contracts/openapi.yaml`에 대해 검사한다. HTTP 계층 테스트와 API 통합 테스트가 모두 쓴다.

- 고른 이유: **OpenAPI 3.1을 지원**하고(문서의 지원 표에 3.0.x와 3.1.x 명시) 경로·메서드·상태·Content-Type·스키마를 한 번에 검증하며 JVM 라이브러리라 별도 런타임이 필요 없다. 원본 저장소가 Atlassian의 GitHub으로 이전돼 유지 중이다.
- 검토한 대안: `networknt json-schema-validator`는 JSON Schema만 검증해서 경로·상태·Content-Type 매칭을 직접 짜야 한다. Schemathesis·Dredd는 외부 런타임(Python/Node)과 서버 프로세스가 필요해 CI가 무거워진다.
- 검증 장치가 실제로 잡는지 음성 테스트로 확인했다(`OpenApiContractSmokeTest`): 필수 필드가 빠진 본문과 문서에 없는 상태 코드는 실패한다. 이 검증이 구현 중에 계약의 빠진 응답 정의를 실제로 잡아냈다(3절).
- 한계: 요청 본문 검증은 쓰지 않았고(테스트가 보내는 요청은 직접 작성), 경로 수준 `servers` 재정의는 지원하지 않아 `/healthz`는 `/v1/healthz`로 검증한다.

## 5. 테스트

| 층 | 방법 | 위치 |
|---|---|---|
| 단위 | Kotest + fake(메모리 저장소, 순차 ID, 직접 움직이는 `MutableClock`) + `runTest`. 만료·정원·권한·숨기기·토큰·추천 어댑터·설정·속도 제한 | 각 모듈 `src/test` |
| 계약 | `RoomRepository`: 메모리 fake와 Exposed(Postgres)가 **같은 계약**(17개, 동시 참여 포함). `ArtifactStore`: 로컬 파일(단위)과 fake-gcs-server(통합)가 같은 계약 | `*/src/testFixtures` |
| HTTP 계층 | `testApplication` + MockK 서비스: 상태 코드, 오류 형식, 인증 헤더(Bearer 파싱), CORS, 413, 429, 멱등성 키, 캐시 헤더, 500 메시지 비노출 | `server/app/src/test` |
| 저장소 통합 | Testcontainers Postgres 17.6(통합 JVM 하나가 공유) + **운영과 같은 Liquibase SQL changelog**. H2 없음, Exposed 목 없음 | `server/room/src/integrationTest` |
| API 통합 | `testApplication` + 실제 조립 + Postgres + `data/artifacts/dev`: 익명 사용자 → 방 만들기 → 참여 → 출발역 수정 → 숨김 조회 → 결과 → 배려 모드 → outcome → 삭제, 오류 응답. **모든 응답을 openapi.yaml로 검증** | `server/app/src/integrationTest` |

## 6. 로컬 실행과 curl 시연 (실제 출력)

```sh
mise run dev:db && mise run dev:migrate   # compose Postgres + Liquibase 컨테이너(changeset 2개 적용)
mise run dev:seed                         # 예시 방(3명, 한 명 숨김)과 curl 예시 출력
mise run dev:server                       # :server:app:run, 포트는 SERVER_PORT(워크트리별)
```

아래는 `dev:server`(compose DB + `data/artifacts/dev`)에 대한 실제 응답이다(토큰은 `<…>`로 가렸다, 역 코드는 개발 산출물의 것).

```text
$ 방 만들기 (방장 별칭 민수, 정원 3명)
{"roomId":"4y0sf8mksw","hostToken":"<방장 토큰>","participantId":"91wzry","participantToken":"<참여자 토큰>","expiresAt":"2026-11-21T05:06:45.936008Z"}

$ 친구 참여 (별칭 지연, 출발역 숨김)
{"participantId":"nsnawp","participantToken":"<참여자 토큰>"}

$ 토큰 없이 방 조회 → 숨긴 출발역은 null
  민수 02f 신내 hidden=False
  지연 None None hidden=True
$ 지연의 토큰으로 조회 → 본인 출발역은 보임
  민수 02f 신내 hidden=False self=False
  지연 dd9 수서 hidden=True self=True

$ 셋째 참여 → 정원 도달, 넷째는 거부
  3번째 201
  {"code":"ROOM_FULL","message":"방이 가득 찼습니다"}  4번째 409

$ 결과 (공평하게)
  ok fair dataVersion=20261112.6 [('민수', '02f'), ('지연', None), ('서준', 's9k')]
  1위 건대입구 초/환승=[(1728, 1), (1607, 2), (1653, 1)] FAIR_MINIMAX
      가장 오래 걸리는 민수도 29분, 3명 모두 27~29분 사이예요. 2위 약수와 최장 시간은 같지만, 시간 차이가 더 작아요 (2분 vs 6분).
  2위 약수 … FAIR_ALTERNATIVE: 공평 모드 대안이에요. 1위 건대입구와 최장 시간은 같아요.
  3위 군자 … FAIR_ALTERNATIVE: 공평 모드 대안이에요. 1위 건대입구보다 가장 오래 걸리는 사람이 1분 더 걸려요.

$ 방장이 배려 모드(방장 쪽)로 변경 후 결과
  favor favorTarget=91wzry locked=True
  1위 상봉 favoredSeconds=1198
      민수는 20분, 환승 1번으로 와요. 가장 많이 맞춰 주는 지연은 공평하게보다 10분 더 걸려요 (37분, 상한 +13분). 나머지도 상한 안이에요. 민수 쪽에 더 가까운 역은 다른 사람 상한을 넘어서 뺐어요.

$ 지연의 토큰으로 방장 항목 수정 시도
  {"code":"FORBIDDEN","message":"본인 항목만 고칠 수 있습니다"}  403

$ 무상태 추천 (별칭 없음 → A/B)
  ok 삼각지 | 둘이 합쳐 43분, 후보 중 가장 짧아요. 대신 A가 B보다 23분 더 걸려요.
$ 무상태 추천 (별칭 있음)
  둘이 합쳐 43분, 후보 중 가장 짧아요. 대신 민수가 서준보다 23분 더 걸려요.
$ 없는 출발역
  {"code":"INVALID_STATION","message":"알 수 없는 출발역이 있습니다"}  400
$ 방 삭제(방장) 후 조회
  DELETE 204
  {"code":"ROOM_NOT_FOUND","message":"방을 찾을 수 없습니다"}  GET 404
```

요청 로그는 `GET /v1/rooms/{roomId}/result -> 200`처럼 기록되고 방 ID·토큰은 없다(로그 전체에서 토큰 문자열 0건 확인).

## 7. 배포 이미지

`bash scripts/build-server-image.sh`: `installDist` 후 `docker build --platform linux/amd64 -f server/Dockerfile .`(빌드 컨텍스트는 `Dockerfile.dockerignore`로 필요한 파일만). **배포는 하지 않았다(P8).**

- 멀티스테이지: `base`(Temurin 25 JRE + lib + 정렬된 `classpath.txt`) → `cds`(로컬 프로필로 서버를 띄워 `/healthz`·`/v1/manifest`·`/v1/recommend`·오류 응답·DB 연결 실패 경로를 한 번씩 지나가게 하고 `-XX:ArchiveClassesAtExit`로 아카이브를 쓴 뒤 정상 종료) → 최종(아카이브만 복사, 비루트 사용자 10001, 산출물·학습 데이터 없음). 스파이크의 교훈대로 **학습과 실행이 같은 정렬된 클래스패스 문자열**을 쓴다.
- 실측(로컬 macOS arm64 위 Docker, linux/amd64 에뮬레이션): 이미지 299,921,614 B(286 MiB), 아카이브 29.4 MB. 컨테이너를 띄워 `-Xshare:on`으로 아카이브가 실제로 매핑됨(`Mapped dynamic region`)을 확인했고 `/healthz` 200과 `/v1/recommend` 응답을 확인했다. 에뮬레이션 위의 기동 시간(약 3초)은 Cloud Run 수치가 아니다. **콜드스타트 재측정은 P8 몫**이다.
- `APP_PROFILE=prod`가 이미지 기본값이다: 필수 설정 없이 띄우면 누락을 모두 출력하고 종료 코드 1로 끝난다(확인함).
- 이 이미지의 아카이브 훈련은 로컬 파일 저장소로 했다. GCS 클라이언트 클래스는 아카이브에 들어 있지 않아 운영 첫 기동에서 읽는 비용이 더 든다. P8에서 콜드스타트를 재면서 필요하면 학습 시 GCS 에뮬레이터를 붙이는 방안을 검토한다.

## 8. 제안(결정하지 않음)

**산출물 갱신 정책(시작 시 로드 이후)**: 지금 서버는 시작할 때 현재 manifest 하나를 읽어 메모리에 둔다.
1. **MVP 권고: 새 데이터를 발행하면 새 Cloud Run 리비전을 배포한다**(파이프라인 발행 → 서버 재배포 또는 환경 변수 갱신). 리비전이 곧 데이터 버전이라 한 요청 안에서 버전이 섞이지 않고, scale-to-zero와 요청 기반 CPU 할당에서 백그라운드 폴링을 믿을 필요가 없다. AppCDS도 그대로다.
2. 방이 만든 뒤 데이터가 바뀌어 참가자 출발역이 사라지면 `STATION_UNAVAILABLE`(409)이 난다. 이 경우를 줄이려면 현재·직전 버전을 모두 메모리에 두고 방의 `dataVersion`으로 계산하는 확장이 가능하다(tech-stack 5.4). 코어 계산이 순수 함수라 서비스 쪽 변경만 필요하다.
3. 재배포 없이 갱신하려면 요청 때 마지막 확인이 60초 지났으면 `ArtifactStore.get`의 버전(`ArtifactVersion`)으로 manifest가 바뀌었는지 보고, 새 데이터가 검증을 통과할 때만 교체하는 방식이 있다(실패하면 직전 정상 버전 유지). 요청 지연과 GCS 읽기 비용이 드는 대신 재배포가 필요 없다.

## 9. 알려진 한계와 주의

- **속도 제한·멱등성 캐시는 인스턴스 메모리**다. 인스턴스가 여럿이거나 0으로 내려가면 초기화된다(tech-stack 5.2가 정한 수준). 방 생성 일일 상한은 같은 한계 안에서 동작한다.
- **클라이언트 IP**: 웹이 Cloudflare 뒤에서 서버를 부르므로 서버가 보는 피어는 Cloudflare다. 속도 제한이 한 덩어리로 걸리지 않게 `RATE_LIMIT_CLIENT_IP_SOURCE`(`peer` 기본, `xff-last`, `header:<이름>`, 예: `header:CF-Connecting-IP`)로 어느 값을 믿을지 정한다. 헤더를 믿으려면 서버가 그 프록시를 거치지 않고는 닿지 않아야 한다. **P8에서 Cloud Run ingress와 함께 정해야 한다.**
- **pepper를 바꾸면 모든 토큰이 무효**가 된다(해시가 달라진다). 회전이 필요하면 이전 pepper도 함께 검증하는 단계를 추가해야 한다.
- **outcome**은 방당 마지막 응답 하나만 저장한다(tech-stack 5.4 모델). 사람별 응답이 필요하면 `participants`에 열을 추가한다.
- 조회(GET)는 만료를 늘리지 않는다. 쓰기(참여·수정·삭제·방 변경·outcome)만 슬라이딩한다.
- 방장 토큰과 참여자 토큰은 별개다. 방장이 자기 항목을 고치려면 자기 participantToken이 필요하다.
- DB 연결은 첫 요청에서 만든다(`initializationFailTimeout=-1`, `minimumIdle=0`). 서버 시작은 DB를 기다리지 않아 `/healthz`가 DB와 무관하게 응답한다. DB가 죽어 있으면 방 API가 500(`INTERNAL_ERROR`)이 된다.
- Exposed 1.x가 `kotlin-reflect`를 끌어와 기동 시 클래스 로딩이 늘 수 있다. AppCDS가 대부분 흡수하지만 P8의 콜드스타트 실측에서 확인한다.
- JDK 25는 Netty의 네이티브 접근에 경고를 한 줄 낸다(`Restricted methods will be blocked in a future release`). 동작에는 영향이 없다.
- 로그는 평문 한 줄 형식이다. Cloud Logging 구조화 로그(JSON)는 P8에서 필요하면 `logback.xml`만 바꾼다.
- 웹/앱의 기본 표시 이름("나/친구1…", `shared/app-logic`의 `DisplayNames`와 `web/src/lib/display/names.ts`)은 그대로다. 서버 문장만 A/B/C/D를 쓰므로, 웹이 별칭 없는 카드에서 사람을 가리킬 때 서버 문장과 같은 글자(A, B, …)를 쓰는 것이 읽기 쉽다(웹 후속 작업에서 결정).

## 10. 검증 결과

`./gradlew check integrationTest`: 통과. 단위·계약·HTTP 계층 테스트 합계는 아래 PR 본문 표를 따른다. 정적 검사: ktlint, detekt, Konsist(새 규칙 4개 포함) 통과, 새 예외(suppress·baseline) 없음. `gitleaks`: 누출 없음.

## 11. 결정 필요

1. **산출물 갱신 정책**: 8절의 1번(리비전 단위 배포)으로 갈지, 3번(요청 시 확인)으로 갈지.
2. **속도 제한의 클라이언트 IP 출처**: Cloudflare 뒤에서 어떤 헤더를 믿을지(P8과 함께).
3. 오류 코드를 계약에서 `enum`으로 좁힐지(웹 타입 영향이 있어 이번에는 하지 않았다).
4. **공통 후보가 없을 때의 응답**을 지금처럼 200 + `no_common_candidate`로 둘지, 출발역이 아예 도달 불가인 경우에만 별도 오류로 나눌지(지금은 한 사람의 도달 불가 후보는 제외될 뿐 오류가 아니다).
