# D104 — 배포: 서버·웹 순서 자동화 + 웹 자동 되돌리기 (#104)

서버(Cloud Run)는 이미 무중단이고 스스로 되돌린다([p8a-notes.md](p8a-notes.md)). 이 변경은 ① 서버·웹이 같이 바뀌는 푸시의 **순서를 코드가 정하게** 하고 ② 웹(Workers)도 **확인이 실패하면 직전 버전으로 되돌리게** 한다. 새 외부 서비스·시크릿·유료 기능은 없다.

## 1. 배포 순서

main에 푸시되면 `deploy.yml`(오케스트레이터) 하나가 돈다.

```
push(main) ─▶ plan ─┬─ 기본(서버 먼저):  deploy-server ─▶ deploy-web
                    └─ 라벨 deploy:web-first:  deploy-web ─▶ deploy-server
```

- `plan`이 `git diff before..sha`로 서버·웹 중 무엇이 바뀌었는지 보고(경로 목록은 예전 `on.push.paths`와 같다: `scripts/deploy-plan.sh`), 그 푸시에 연결된 PR의 라벨로 순서를 정한다.
- **한쪽만 바뀌면 그쪽만** 돈다. 둘 다 바뀌면 순서대로 돈다. 앞 단계가 실패(또는 취소)하면 뒷 단계는 **돌지 않는다**. 서버 변경이 없어 건너뛴 단계는 실패로 보지 않는다.
- 겹침 방지: 오케스트레이터는 `concurrency: deploy-pipeline`(대기, 취소 없음). `deploy-server`·`deploy-web`은 예전 그룹(`deploy-server`·`deploy-web`)을 그대로 쓴다.
- `deploy-server.yml`·`deploy-web.yml`은 **`workflow_dispatch`가 그대로 있다**(한쪽만 수동 배포). `deploy.yml`도 수동 실행이 된다: `targets`(both·server·web)와 `order`(server-first·web-first)를 고른다. 수동 실행은 main에서 한다(GCP 인증이 main으로 한정, [p8a-notes.md](p8a-notes.md)).

### 라벨 사용법

| 상황 | 라벨 | 순서 |
|---|---|---|
| 기본(서버 API가 먼저 나가야 하는 변경, 새 데이터, 계약 추가) | 없음 | 서버 → 웹 |
| 웹이 먼저 나가야 하는 변경(예: 처리방침이 가리키는 표시가 서버보다 늦으면 안 되는 PR) | `deploy:web-first` | 웹 → 서버 |

- 라벨은 **병합 전에** PR에 붙인다. 푸시 시점에 읽으므로 병합 뒤에 붙인 라벨은 반영되지 않는다(그때는 `deploy.yml`을 `order=web-first`로 수동 실행한다).
- 한쪽만 바뀌는 PR에서는 라벨이 아무 일도 하지 않는다.
- 라벨 조회가 실패하면 순서를 알 수 없으므로 `plan`이 실패해 아무것도 배포하지 않는다(다시 실행하면 된다).
- 웹 먼저 순서에서는 `deploy-web`의 "서버 데이터 대기"를 건너뛴다(서버가 아직 옛 상태이므로). 그래서 **`data/artifacts/`가 같이 바뀌는 PR에는 `deploy:web-first`를 쓰지 않는다**: 새 역 색인으로 옛 서버를 부르면 스모크가 400으로 실패하고 웹이 되돌려진다. `plan`이 이 조합이면 경고를 남긴다.

## 2. 웹 자동 되돌리기

```
빌드 → populateCache → [현재 Worker 버전 id 기록] → wrangler deploy → (서버 데이터 대기) → 스모크
                                                                          └ 실패하면 → wrangler rollback <기록한 id> → 현재 버전 재확인
```

- 기록·되돌리기는 `web/scripts/worker-version.sh`(`current` / `rollback <id>`)다. `wrangler deployments status --json`에서 100% 트래픽의 버전 id를 읽고, `wrangler rollback <id> --yes`로 되돌린 뒤 **현재 버전이 정말 그 id인지 다시 읽어 확인**한다. wrangler가 실패하면 3회 재시도한다.
- 되돌리는 경우: 배포 단계·"서버 데이터 대기"·스모크 중 하나가 실패했을 때. 배포 단계에서 실패해도 지금 버전이 직전과 **다를 때만** 되돌린다(이미 같으면 아무것도 안 한다).
- 되돌리지 않는 경우: ① 사람이 실행을 취소했을 때 ② 첫 배포(직전 버전 없음) ③ 스모크 뒤의 선택 단계(`measure`)가 실패했을 때. 버전 조회가 실패하면 **배포 전에** 멈춘다(아직 아무것도 바뀌지 않음).
- 되돌려도 **서버 쪽은 그대로**다(서버는 자기 워크플로가 되돌린다). 서버 먼저 순서에서 웹이 실패하면 서버는 새 상태·웹은 옛 상태로 남고, 서버가 추가 위주라 옛 웹과 호환되는 것이 전제다(p8a-notes의 changeset 규칙). 웹 먼저 순서에서 웹이 실패하면 서버는 돌지 않는다.
- Worker 버전은 코드·정적 자산·변수(`API_ORIGIN`·`CANONICAL_HOST`)·시크릿 스냅샷을 담는다. 되돌리면 그 버전의 값으로 돌아간다. 그 사이 `PROXY_SHARED_SECRET`이 바뀌었다면 wrangler가 확인을 요구한다(CI에서는 기본값으로 진행). 비밀을 바꾼 직후의 배포 실패는 사람이 확인한다.
- OpenNext의 증분 캐시(`populateCache`)는 빌드 id 키로 쌓여 옛 버전의 키를 지우지 않는다. 되돌린 옛 버전은 자기 키를 그대로 읽는다.

### 왜 `versions upload` → 미리보기 URL 스모크 → `versions deploy`가 아닌가

이슈가 먼저 권한 방식은 이 Worker에 맞지 않아 **차선책(기록 → deploy → 스모크 → rollback)**을 골랐다.

- 미리보기 URL(`*.workers.dev`)로 오는 요청은 `CANONICAL_HOST`가 있으면 `worker.ts`의 `canonicalRedirect`가 정식 도메인으로 301 이동시킨다. 미리보기에서 스모크하려면 그 버전만 `CANONICAL_HOST`를 비우거나 Worker 코드에 우회 경로를 열어야 하고, 그러면 **스모크가 실제로 나갈 설정과 다른 것을 검사**하게 된다.
- `wrangler versions upload`에는 `--domain`(정식·www 도메인 연결)이 없다. 도메인 연결은 `wrangler deploy`가 한다.
- 스모크가 정식 주소의 og:image·리디렉트·HSTS를 확인하므로 정식 도메인에서 도는 것이 맞다.

즉 전환 직후 몇 분은 새 버전이 100% 트래픽을 받는 것(지금과 같음)이고, 달라진 것은 실패 시 자동으로 내려오는 점이다. 나중에 미리보기용 도메인 예외를 정하면 `versions upload`로 바꿀 수 있다.

## 3. 테스트 방법

실제 배포 없이 되돌리기 경로를 확인한다(CI의 `deploy-scripts` 잡도 돌린다).

```sh
bash scripts/test-deploy-plan.sh          # 경로·라벨 → 서버/웹/순서 (22건)
bash web/scripts/test-worker-version.sh   # 가짜 wrangler: 배포가 새 버전으로 바꿨고 스모크가 실패 → 직전 id로 rollback, 사후 확인, 재시도, 첫 배포, 점진 배포
```

- `test-worker-version.sh`는 `WRANGLER`를 가짜 실행 파일로 바꿔 끼운다: 새 버전이 라이브인 상태에서 `rollback <직전 id>`를 부르면 현재 버전이 직전 id가 되는지, 이미 직전이면 `wrangler rollback`을 부르지 않는지, "성공이라 했지만 버전이 안 바뀐" 경우를 실패로 잡는지를 본다.
- 스모크 실패 입력(`smoke-deploy.sh`가 `FAIL`을 내면 종료 코드 1)은 기존 스크립트 그대로이고, 워크플로의 `steps.smoke.outcome == 'failure'` 조건이 되돌리기를 부른다. 워크플로 문법은 `actionlint`로 확인했다.
- 오케스트레이터의 `plan` 단계는 임시 git 저장소로 `push`·`workflow_dispatch` 두 이벤트와 라벨 조회 실패(→ 실패)를 확인했다.
- 실제 Cloudflare·Actions 동작은 병합 뒤 첫 푸시에서 처음 돈다(아래 한계).

## 4. 한계·알아둘 것

- GitHub 동시성은 **대기 중인 실행이 둘 이상이면 앞의 대기 실행을 취소한다**(`cancel-in-progress: false`여도). 빠르게 연달아 병합하면 가운데 푸시의 `deploy` 실행이 취소될 수 있고, 그 푸시에서만 바뀐 쪽이 배포되지 않을 수 있다(예전 두 워크플로도 같았다). 그럴 땐 `deploy.yml`을 `targets=both`로 수동 실행한다.
- 호출되는 워크플로(`deploy-server`·`deploy-web`)의 최상위 `concurrency`가 호출 때도 적용되는지는 GitHub 문서에 명시가 없다. 적용되면 수동 실행과 오케스트레이터가 같은 그룹에서 줄을 서고, 아니어도 오케스트레이터끼리는 `deploy-pipeline`으로 직렬이다.
- Worker 롤백은 바인딩·Durable Object 클래스 변경이 있었던 버전 사이에서는 막힐 수 있다(공식 문서). 지금 Worker는 KV/R2/DO 바인딩을 wrangler.jsonc에 두지 않는다.
- 롤백 대상은 최근 100개 버전 안이어야 한다(바로 직전 버전이므로 항상 해당).

## 5. 공식 문서로 확인한 것 (2026-11-21)

- Rollbacks: https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/ — 최근 **100개** 버전으로 롤백 가능, 연결된 리소스는 되돌리지 않음, 바인딩·DO 클래스 변경이 있으면 막힐 수 있음.
- Versions & Deployments: https://developers.cloudflare.com/workers/configuration/versions-and-deployments/ — 설정·시크릿 변경도 버전을 만든다, 버전 보관 30일(최근 100개와 현재 배포는 유지).
- 한도: https://developers.cloudflare.com/workers/platform/limits/ — 버전 한도는 **Free·Paid 구분 없이 모든 Worker에 같다**(30일, 최근 100개). 이 기능에 별도 요금은 없다.
- 명령: https://developers.cloudflare.com/workers/wrangler/commands/workers/ — `wrangler rollback [<VERSION_ID>]`, `wrangler deployments status --json`. 사용하는 wrangler 4.158.0(`web/package.json`)의 `--help`에서 `rollback --yes --message`, `deployments status --json`을 확인했다.
