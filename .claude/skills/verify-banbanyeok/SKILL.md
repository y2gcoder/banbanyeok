---
name: verify-banbanyeok
description: "반반역(banbanyeok) 웹 앱을 빈 DB에서 실제로 띄우고(Postgres·Ktor 서버·Next 웹), 폰 390×844와 데스크톱에서 사용자처럼 조작해 캡처·영상·접근성 트리·API 기록·DB 상태를 남긴다. 검증 결과와 증거를 보고서로 보여 주고 띄운 것만 정리한다. 화면·서버 동작을 바꾼 PR, 버그 재현, 기능 회귀 확인에 쓴다."
---

# 반반역 검증

반반역의 주 표면은 웹(Next.js `web/`)이다. 웹은 `/api/*`를 Ktor 서버(`server/`)로 프록시하고, 서버는 Postgres와 `data/artifacts/dev` 산출물을 쓴다. 이 스킬은 그 셋을 이 워크트리 전용 포트와 빈 DB로 띄운다. 그다음 실제 브라우저로 사용자 경로를 밟고, 증거를 저장소 밖에 남기고, 띄운 것만 끈다.

모든 명령은 저장소 루트에서 실행한다. 도우미 스크립트는 하나다.

```sh
V=.claude/skills/verify-banbanyeok/scripts/verify.sh
bash $V launch                    # 빈 DB → migrate → seed → server → web, 사용 가능해질 때까지 기다린다
bash $V doctor                    # 이 인스턴스가 우리 것이고 쓸 만한지(읽기 전용)
bash $V drive <여정> [phone|desktop]   # 여정 하나를 실제 브라우저로. 기본 phone
bash $V report                    # 이 실행의 여정, 캡처, 영상을 모은 HTML 보고서 경로
bash $V db '<SQL>'                # 이 실행의 DB에 읽기 전용 쿼리(쓰기는 거부된다)
bash $V cleanup                   # 띄운 프로세스(PID)와 compose 프로젝트만 정리. 증거는 남긴다
bash $V where                     # 마지막 실행 폴더
```

## Launch

사전 조건은 Docker 실행 중, `mise run setup`(도구·`pnpm install`) 한 번, Playwright Chromium 설치(`pnpm --dir web exec playwright install chromium`, 이미 있으면 생략)다. 1Password나 `.env`는 필요 없다. 로컬 프로필의 DB 계정은 `compose.yaml`에 있는 개발 전용 공개 값이다. 키가 필요한 일(배차 API 갱신, 운영 연결)은 이 스킬의 범위가 아니다. 필요하면 `op run --env-file=.env.tpl -- <명령>`으로 감싸고, 값은 절대 출력하지 않는다.

`bash $V launch`가 하는 일은 다음과 같다. DB·마이그레이션·웹은 저장소의 `scripts/dev.sh`를 쓴다. 서버와 seed는 설치본으로 실행한다. 그래야 서버 JVM이 Gradle 데몬 아래가 아니라 launch가 시작한 프로세스의 자손이 되어, 소유를 확인하고 끌 수 있다.

1. 빈 포트 셋(DB·서버·웹)을 고르고 compose 프로젝트 이름을 `bbyverify-<run-id>`로 정한다. 사용자의 `mise run dev`(체크섬 포트, 같은 볼륨)와 겹치지 않는다. 포트를 고정하려면 `DB_PORT=… SERVER_PORT=… WEB_PORT=… bash $V launch`로 실행한다. 이미 쓰이는 포트면 아무것도 만들지 않고 멈춘다.
2. 실행 폴더 `~/.cache/banbanyeok-verify/<워크트리>-<체크섬>/<run-id>/`에 `state.env`를 쓴 뒤 `latest` 링크를 건다.
3. 모든 단계를 빈 환경(`env -i`)에서 돌린다. 남기는 것은 `PATH`·`HOME`·로케일·`JAVA_HOME`과 Docker 접속 변수(`DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`, `DOCKER_TLS_VERIFY`, `DOCKER_CERT_PATH`, `DOCKER_API_VERSION`)뿐이다. launch의 `docker info` 확인도 Compose와 같은 이 환경에서 돌린다. 그 위에 이 실행의 값을 넣는다. DB 주소·계정, `API_ORIGIN`(이 서버), `COMPOSE_FILE`(저장소 `compose.yaml`만), CORS, 로컬 요청 제한이 여기에 든다. 사용자 셸의 `DATABASE_URL`, `API_ORIGIN`, `NEXT_PUBLIC_API_MOCKING`, `COMPOSE_*`, 통계·카카오 키, `PROXY_SHARED_SECRET`은 실행에 들어가지 않는다. 웹 키 이름은 빈 값으로 넣어 `web/.env*` 파일도 덮지 못하게 한다.
4. `dev.sh db`는 새 볼륨으로 Postgres를 띄우고 healthy까지 기다린다. 이어서 `dev.sh migrate`(Liquibase 컨테이너)를 돌린다.
   커밋된 권역 포인터(`data/artifacts/dev/regional/manifest.v5.json`)가 있으면 배포와 같이 서버를 `REGIONAL_ARTIFACTS=true`로 띄운다. seed는 출발역이 가장 많은 권역(수도권)에서 고른다.
5. 서버 쪽 파일(`server`, `shared`, `build-logic`, `gradle`, 루트 Gradle 파일, `data/artifacts/dev`)의 지문(HEAD 트리, 미커밋 변경, 추적 안 하는 파일)을 적는다. 그다음 `:server:app:installDist`로 설치본을 만들고 `bin/app seed`로 예시 방 하나를 만든다. 그 방 ID(`SEED_ROOM_ID`)는 이 실행의 DB에만 있다.
6. 설치본 서버를 띄우고, 포트 주인이 launch가 시작한 리더의 자손이며 `GET /healthz` = `ok`가 될 때까지 기다린다(최대 120초).
7. `dev.sh web`(`next dev`)을 띄운다. 포트 주인이 리더의 자손이고, 첫 화면 `<title>`에 `반반역`이 있고, 웹 프록시 `GET /api/v1/rooms/<SEED_ROOM_ID>`가 그 방을 돌려줄 때까지 기다린다. 이 셋이 맞아야 "사용 가능"이다. 다른 서버나 모의 서버는 이 방을 모르므로 통과하지 못한다.
8. 포트 주인 PID와 시작 시각, 리더와 그 자손 전체(`procs-server.tsv`, `procs-web.tsv`: PID와 시작 시각)를 남긴다. cleanup은 이 목록만 끈다.

준비되면 마지막 줄에 `ready: web http://localhost:<WEB_PORT> …`가 나온다. 빌드 캐시가 있으면 15~30초, 처음이면 Gradle·Docker 빌드 때문에 몇 분 걸린다. 실패하면 단계 이름과 `logs/<단계>.log` 경로를 찍고 멈춘다. 그때도 `cleanup`을 돌린다.

워크트리당 한 실행만 띄운다. `web/.next`를 같이 쓰기 때문이다. launch는 시작하자마자 `launch.lock` 폴더를 원자적으로 만들어 실행을 예약한다. 동시에 부른 두 번째 launch는 바로 거절된다. 잠금은 launch가 끝나면 풀린다. 정리하지 않은 실행이 있어도 launch가 거절한다. launch 프로세스가 강제로 죽어 잠금이 남았으면, 메시지의 PID가 없는지 확인하고 잠금 폴더를 지운다. 잠금이 풀리는지는 `bash .claude/skills/verify-banbanyeok/scripts/test-launch-lock.sh`로 확인한다(Docker 불필요, 경로에 작은따옴표가 있는 경우 포함). 사용자가 같은 워크트리에서 `mise run dev`나 `mise run dev:web`을 띄워 두었으면 launch가 그것까지는 알아채지 못한다. 띄우기 전에 묻거나 다른 워크트리를 쓴다. 다른 워크트리와는 동시에 돌려도 된다.

## Doctor

이상해 보이면 무엇보다 먼저 `bash $V doctor`를 돌린다. 읽기만 하고, 하나라도 `FAIL`이면 종료 코드가 1이다. 정리한 실행이거나 포트 주인이 이 실행의 것이 아니면 거기서 멈추고 HTTP 요청을 보내지 않는다. 모든 루프백 요청은 `curl -q --noproxy '*'`로 보낸다. 그래서 `http_proxy`나 `~/.curlrc`가 있어도 다른 서버의 응답으로 판정하지 않는다.

- `db`는 compose 프로젝트 `bbyverify-<run-id>`의 5432가 `127.0.0.1:<DB_PORT>`에 매핑돼 있는지 본다.
- `server`와 `web`은 포트 주인 PID와 그 시작 시각이 launch가 적은 값과 같고, launch가 시작한 리더의 자손인지 본다. 다르면 남의 프로세스이므로 조작하지 않는다.
- `server: /healthz`가 `ok`인지, 서버가 내는 `/v1/manifest`의 `dataVersion`이 작업 트리 `data/artifacts/dev/manifest.json`과 같은지 본다.
- `server: 빌드 지문`은 launch 때 적은 서버 쪽 파일 지문과 지금이 같은지 본다. 커밋하지 않은 변경과 새 파일도 잡는다. 다르면 떠 있는 서버는 낡은 것이므로 `FAIL`이다. `cleanup` 후 다시 `launch`한다.
- `web`은 첫 화면 제목을 보고, seed 방이 서버에서 직접, 그리고 웹 `/api` 프록시를 거쳐 둘 다 보이는지 본다. 프록시 대상이 이 서버라는 증거다.
- `build`는 HEAD 변화를 알려 준다. 서버 지문이 같으면 웹만 바뀐 것이고 `next dev`가 다시 읽으므로 그대로 써도 된다.

## Drive

`bash $V drive <여정> [phone|desktop]`은 시작하기 전에 실행이 정리되지 않았는지, 서버·웹 포트 주인이 launch가 기록한 프로세스(시작 시각과 리더의 자손 관계까지)인지 확인한다. 아니면 아무것도 열지 않고 실패한다. 그다음 `journeys/<여정>.mjs`를 Chromium으로 돌린다. Playwright는 `web/node_modules`의 것을 쓴다. 이 저장소의 e2e(`web/e2e-real/`)와 같은 접근 이름·역할 선택자를 쓴다.

- `phone`은 Pixel 7 설정(터치, 모바일 UA)에 화면만 390×844로 바꾼 것이다. `desktop`은 1280×800, 마우스다.
- 주소는 `http://localhost:<WEB_PORT>`다. `127.0.0.1`로 열면 Next 16 dev가 개발 리소스(`/_next/hmr`)를 막아 화면이 수화되지 않고 입력이 먹지 않는다.
- 로케일은 `ko-KR`, 시간대는 `Asia/Seoul`이고 클립보드 권한이 있다. "링크 복사" 결과를 읽을 수 있다.

실행할 여정과 검증할 화면은 [기능 지도](features/README.md)에서 고른다. 새 확인이 필요하면 여정 파일을 하나 쓰고 경로로 넘긴다(`bash $V drive path/to/x.mjs desktop`, 저장소 루트 기준 상대 경로). 스크래치 여정은 저장소 밖에 둔다. 여정은 아래 도구를 받는 기본 내보내기 함수다.

```js
// journeys/ 안의 여정 기준. 저장소 밖 스크래치 여정은 lib.mjs를 절대 경로로 가져온다.
import { gotoHydrated, pickStation } from "./lib.mjs";

export default async ({ page, step, expect, db, newPerson, note, viewport }) => {
  await step("home", () => gotoHydrated(page, "/"));            // 동작 후 NN-home.png + NN-home.aria.yml
  await pickStation(page, "나의 출발역", "강남", /^강남\s?2호선/);   // 자동완성 combobox → option
  const friend = await newPerson();                              // 저장소·쿠키가 분리된 두 번째 사람
  await step("friend", () => friend.goto("/r/…"), { page: friend });
  db("rooms", "select count(*) from rooms");                     // db-rooms.tsv로 남고 행 배열을 돌려준다
  note("shared-link", "…");                                      // shared-link.txt
};
```

화면의 접근성 역할과 이름은 기능 지도가 가리키는 각 기능 문서에서 찾는다. 문구가 바뀌면 `web/e2e-real/`의 선택자도 확인한다. 첫 입력 전에는 `gotoHydrated`로 수화를 기다린다. 화면이 붙으면 웹이 `/api/healthz`로 서버를 깨운다.

## Evidence

증거는 `<실행 폴더>/evidence/<여정>-<화면>-<시각>-<접미사>/`에 남는다. 저장소 밖이라 커밋되지 않고 cleanup도 지우지 않는다. 실행 폴더는 `bash $V where`로 찾는다.

| 파일 | 내용 |
|---|---|
| `NN-<단계>.png`, `NN-<단계>.aria.yml` | 단계 동작 직후의 전체 화면과 접근성 트리 |
| `steps.log` | 단계 번호와 그때 주소 |
| `network.jsonl` | 브라우저가 보낸 `/api/*` 요청의 메서드·경로·상태(사람별 `ctx`) |
| `console.txt` | 콘솔 error·warning과 페이지 오류 |
| `db-<이름>.tsv`, `<이름>.txt` | 여정이 남긴 DB 조회와 메모(복사한 링크 등) |
| `trace.zip`, `trace-ctx1.zip` | Playwright 추적(동작마다 화면·DOM·네트워크). `pnpm --dir web exec playwright show-trace <파일>` |
| `video-main/*.webm`, `video-ctx1/*.webm` | 브라우저 컨텍스트별 화면 녹화. 컨텍스트가 닫힐 때 저장 |
| `result.json`, `failure.png` | 통과 여부, 오류 스택, 실행 ID, 띄운 커밋 |

증명 기준은 다음과 같다.

- 사용자가 밟는 경로로 조작한다. 화면을 거치지 않는 API 호출이나 DB 쓰기로 상태를 만들지 않는다. 숨긴 참가자처럼 지금 사용자가 만들 수 없는 옛 상태는 예외이고, 그 사실을 보고에 적는다.
- 동작과 그 결과 상태를 함께 남긴다. 마지막 화면 하나로는 부족하다.
- 부작용을 화면과 따로 확인한다. 방·참가자·뽑기는 `db`로 행을 보고, 쓰지 않아야 하는 화면(결과 보기, 공유)은 전후 행 수가 같은지 본다.
- 바꾼 화면은 `phone`과 `desktop` 둘 다 돌린다.
- 여정 실행이 끝나면 실패한 실행도 포함해 `bash $V report`를 실행한다. `cleanup` 이후에도 보고서를 만들 수 있다. `report.html`은 실행 시작 커밋, 여정·화면별 판정, 단계별 캡처, 재생 가능한 WebM과 상세 증거 링크를 모은다.
- **Claude Code**에서 사용자가 Artifact 게시를 승인했고 `Artifact` 도구를 쓸 수 있으면 `bash $V report --artifact`로 캡처와 영상을 내장한 `report-artifact.html`을 만들고 비공개 Artifact로 게시한다. Artifact 크기 제한으로 빠진 미디어나 뷰어에서 재생되지 않는 영상은 로컬 `report.html`에서 열 수 있게 경로를 함께 적는다. 게시 전 캡처·영상에 포함된 내용을 확인한다. [Claude Code Artifact 제약](https://code.claude.com/docs/en/artifacts#page-constraints)
- **Codex**에서는 `report.html`을 결과 파일로 링크한다. HTML 미리보기가 있는 앱에서 열거나 로컬 브라우저에서 열 수 있다. 로컬 미디어는 HTML 파일과 `evidence/` 디렉터리를 같은 위치에 둔 채 연다. [Codex 파일 미리보기](https://learn.chatgpt.com/docs/artifacts-viewer)
- 채팅에는 보고서 링크와 핵심 판정을 함께 준다. 실행하지 못한 경로는 시도한 명령과 막힌 이유를 별도로 적는다.

PR에 화면을 붙일 때는 필요한 `png`만 골라 올린다. `result.json`의 오류 스택과 `trace.zip`에는 로컬 절대 경로가 들어 있으므로 공개 저장소에 폴더째 올리지 않는다.

## Cleanup

`bash $V cleanup`은 이 실행이 띄운 것만 끈다.

1. 웹과 서버마다 launch가 남긴 프로세스 목록과, 리더가 그대로 살아 있으면 지금 리더의 자손을 합친다. pnpm은 스크립트를 다른 프로세스 그룹에서 돌리므로 그룹이 아니라 부모 사슬로 찾는다.
2. 그 PID마다 시작 시각이 기록과 같은지 확인하고 `TERM`을 보낸다. 모두 끝날 때까지 최대 20초 기다린다. 남은 것은 다시 확인한 뒤 `KILL`을 보낸다. 그래도 남으면 `FAIL`이다.
3. `docker compose --profile tools down -v --rmi local`로 이 실행의 compose 프로젝트(컨테이너, DB 볼륨, migrate 이미지)를 지운다. 공용 이미지(`postgres`, `liquibase`)는 남는다.
4. 세 포트가 비었는지 확인하고 남은 증거 폴더를 나열한다.
5. 모든 단계가 성공했을 때만 `state.env`에 `STOPPED_AT`을 적고 0으로 끝난다. 하나라도 실패하면 `FAIL` 줄을 찍고 1로 끝난다. 원인(Docker가 꺼짐 등)을 고친 뒤 다시 `cleanup`한다. 다시 돌려도 안전하다.

프로세스 이름으로 끄지 않는다. `pkill`과 `killall`은 이 저장소에서 금지다(AGENTS.md '하지 말 것'). 이름으로 끄면 다른 워크트리나 사용자가 띄운 `next dev`·Gradle도 같이 꺼지고, 이 규칙은 이미 두 번 어겨졌다. Gradle 데몬(설치본 빌드에 쓴 것)은 공용이라 남겨 둔다. 실패한 시도 뒤에도 매번 cleanup을 돌린다. 증거와 `logs/`는 남는다. 오래된 실행 폴더는 사람이 `~/.cache/banbanyeok-verify/`에서 지운다.

## 하지 않는 것

- 운영(banbanyeok.app)이나 배포 미리보기를 조작하지 않는다. 운영 확인은 `scripts/smoke-server.sh`, `web/scripts/smoke-deploy.sh`의 몫이다.
- 가짜 서버(`dev:web:mock`, `web/e2e`의 mock)로 증명하지 않는다. 이 스킬은 실제 서버와 DB를 쓴다.
- 카카오톡 공유 API는 키(`NEXT_PUBLIC_KAKAO_JS_KEY`)가 있어야 동작하고 launch는 키를 넣지 않는다. 카톡 전송 자체는 이 스킬로 증명할 수 없다. 버튼이 보이는 것까지만 본다.
