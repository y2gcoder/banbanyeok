# D104 — 배포: 서버·웹 순서 자동화 + 웹 자동 되돌리기 (#104)

서버(Cloud Run)는 이미 무중단이고 스스로 되돌린다([p8a-notes.md](p8a-notes.md)). 이 변경은 ① 서버·웹이 같이 바뀌는 푸시의 **순서를 코드가 정하게** 하고 ② 웹(Workers)도 **확인이 실패하면 직전 버전으로 되돌리게** 한다. 새 외부 서비스·시크릿·유료 기능은 없다.

## 1. 배포 순서

main에 푸시되면 `deploy.yml`(오케스트레이터) 하나가 돈다.

```
push(main) ─▶ plan ─┬─ 기본(서버 먼저):  deploy-server ─▶ deploy-web
                    └─ 라벨 deploy:web-first:  deploy-web ─▶ deploy-server
```

### 무엇을 배포하나: "직전 push"가 아니라 "운영에 나가 있는 커밋"과 비교

`plan`은 서비스마다 **지금 운영에 나가 있는 커밋**을 읽어 `git diff <그 커밋> HEAD`에 그 서비스 경로가 있으면 배포한다(`scripts/deploy-plan.sh`).

| 서비스 | 운영 커밋을 읽는 곳 | 스크립트 |
|---|---|---|
| 서버 | Cloud Run에서 **100% 트래픽을 받는 리비전 하나**의 이미지 태그(`…/server:<40자 SHA>`, deploy-server가 붙인다) | `scripts/deployed-server-sha.sh`(plan이 GCP WIF로 인증) |
| 웹 | **100% 트래픽을 받는 Worker 버전 하나**의 tag(`wrangler deploy --tag <SHA 7자>`) | `web/scripts/worker-version.sh deployed-tag` |

- 그래서 ① 대기 중인 실행이 GitHub 대기열에서 취소돼도(대기가 둘 이상이면 앞의 것이 취소된다) 마지막 실행이 밀린 변경을 모두 배포하고, ② 여러 커밋이 한 번에 들어오거나 ③ 앞 배포가 실패·되돌려져도 다음 실행이 다시 배포한다. 재실행해도 같은 기준으로 다시 계산한다.
- **운영 커밋을 모르면 그 서비스는 배포한다**(안전한 기본값): 조회 실패(인증·권한·네트워크), 트래픽이 나뉘어 있음, 태그가 SHA가 아님(예: `wrangler secret put`이 만든 버전), 저장소에 없거나 짧은 SHA가 모호, HEAD의 조상이 아님(다른 브랜치에서 수동 배포). `plan` 요약과 경고에 이유가 남는다. 조회 단계가 **시간 초과**로 끝나도(`continue-on-error`) 빈 값으로 이어져 같은 결과다(plan 잡 40분은 단계 상한 합 27분보다 크다). 단, **둘 다 배포 대상인데 운영 커밋을 하나라도 모르면** 아래 "순서를 정하지 못할 때"가 적용된다.
- 경로 비교는 `git diff --no-renames --name-only -z`: 이름이 바뀐 파일은 **옛 경로·새 경로 둘 다** 보고(`server/a → docs/a`도 서버 배포), NUL 구분이라 한글·탭·줄바꿈 파일명도 그대로 맞춘다. `git diff` 자체가 실패하면(종료 코드≠0, 예: 객체 손상) "바뀐 것 없음"으로 보지 않고 그 서비스를 **배포 대상**으로 본다(NUL 경로 목록을 끝까지 만든 경우에만 "없음"). 경로 목록은 예전 `on.push.paths`와 같다(`scripts/test-deploy-plan.sh`가 main의 목록을 고정해 비교한다. 웹은 자기 워크플로 `deploy-web.yml` 변경도 배포하도록 1건 추가).
- **한쪽만 바뀌면 그쪽만** 돈다. 둘 다 바뀌면 순서대로 돈다. 앞 단계가 실패(또는 취소)하면 뒷 단계는 **돌지 않는다**. 서버 변경이 없어 건너뛴 단계는 실패로 보지 않는다.
- 겹침 방지: 오케스트레이터는 `concurrency: deploy-pipeline`(대기, 취소 없음). `deploy-server`·`deploy-web`은 예전 그룹(`deploy-server`·`deploy-web`)을 그대로 쓴다.
- `deploy-server.yml`·`deploy-web.yml`은 **`workflow_dispatch`가 그대로 있다**(한쪽만 수동 배포).

### 수동 실행(`deploy.yml`)

- `targets`: `both`(기본) · `server` · `web` · `auto`(push와 같이 운영 커밋과 비교해 밀린 쪽만). `order`: `server-first` · `web-first`. 수동 실행은 라벨을 보지 않고 `order`를 그대로 쓴다.
- **서버를 포함하는 계획은 main에서만** 허용한다. 다른 ref면 `plan`이 첫 배포 전에 실패한다(GCP 인증이 main으로 한정되어 있어 웹만 나가고 서버가 거부되는 부분 배포를 막는다, [p8a-notes.md](p8a-notes.md)). 웹만(`targets=web`)은 다른 ref에서도 된다(예전 `deploy-web` 수동 실행과 같다).

### 라벨 사용법

| 상황 | 라벨 | 순서 |
|---|---|---|
| 기본(서버 API가 먼저 나가야 하는 변경, 새 데이터, 계약 추가) | 없음 | 서버 → 웹 |
| 웹이 먼저 나가야 하는 변경(예: 처리방침이 가리키는 표시가 서버보다 늦으면 안 되는 PR) | `deploy:web-first` | 웹 → 서버 |

- 라벨은 서버·웹이 **둘 다** 배포될 때만 본다. 범위는 **운영 커밋(서버·웹 중 오래된 쪽) 이후의 모든 커밋**이고, 각 커밋에 연결된 **병합된 PR**(API의 모든 페이지, `--paginate`) 중 하나라도 이름이 정확히 `deploy:web-first`인 라벨을 가지면 웹 먼저다(대소문자·비슷한 이름은 무시).
- **순서를 정하지 못할 때**: 둘 다 배포 대상인데 운영 커밋(서버·웹)을 하나라도 읽지 못하면 밀린 범위의 시작을 알 수 없다. push의 before나 HEAD만 보는 것은 추측이라(앞 배포가 취소돼 밀린 PR의 라벨을 놓친다) 하지 않고, **plan을 종료 6으로 실패**시켜 아무것도 배포하지 않는다. 이때는 **main에서 `deploy.yml`을 수동 실행**(`targets=both`, `order`를 직접 선택)한다. 새 환경의 첫 실행처럼 처음부터 태그가 없던 경우도 같다.
- 범위가 100커밋을 넘거나 라벨 조회가 실패하면 순서를 알 수 없으므로 `plan`이 실패해 아무것도 배포하지 않는다(다시 실행하거나, 수동 실행에서 `order`를 고른다).
- 라벨은 **병합 전에** PR에 붙인다. `plan`이 도는 시점에 읽으므로 그 뒤에 붙인 라벨은 반영되지 않는다(그때는 `deploy.yml`을 `targets=both`, `order=web-first`로 수동 실행한다).
- 웹 먼저 순서에서는 `deploy-web`의 "서버 데이터 대기"를 건너뛴다(서버가 아직 옛 상태이므로). 그래서 **`data/artifacts/`가 같이 바뀌는 PR에는 `deploy:web-first`를 쓰지 않는다**: 새 역 색인으로 옛 서버를 부르면 스모크가 400으로 실패하고 웹이 되돌려진다. `plan`이 이 조합이면 경고를 남긴다.
- 저장소에 라벨 `deploy:web-first`가 아직 없다. 처음 쓰기 전에 만든다.

## 2. 웹 자동 되돌리기

```
deploy 잡:   빌드 → populateCache → [현재 Worker 버전 기록] → (배포 시작 표시) → wrangler deploy → (서버 데이터 대기) → 스모크 → (확인 완료 표시)
rollback 잡: deploy 잡이 끝난 뒤 always(). "배포 시작"은 있는데 "확인 완료"가 없으면 → 기록한 버전을 100%로 → 단독 100%인지 재확인
```

- **복구 목표는 "직전 버전 100%"**다. 배포 직전에 트래픽을 받던 버전을 기록하고(나뉘어 있으면 경고하고 가장 큰 쪽), 되돌릴 때 그 버전 하나가 100%가 되게 한다(`wrangler rollback <id>`는 항상 100% 배포를 만든다). "이미 되돌려져 있음"으로 생략하는 것도, 되돌린 뒤 성공으로 보는 것도 **그 버전 단독 100%일 때만**이다. 60/40 같은 분할이 남아 있으면 실패다.
- 기록 단계(`worker-version.sh current`)는 **배포 기록이 확실히 없을 때만** 빈 값으로 통과한다: 배포 목록이 비었거나(`has no deployments`) Worker가 아직 없음(API 404, `code: 10007`). 인증·권한(10000 등)·네트워크·JSON 형식 오류는 3회 재시도 뒤 **배포 전에** 멈춘다(아직 아무것도 바뀌지 않음). 형식은 versions가 비어 있지 않은 배열, 모든 id가 UUID, 비중 합이 100이어야 한다.
- 되돌리기(`worker-version.sh rollback <id>`): 상태 조회·`wrangler rollback`·사후 확인 모두 3회까지 재시도한다. **상태 조회가 끝내 실패해도 기록한 대상이 있으면 되돌리기를 시도**한다. 사후 확인을 못 읽거나 단독 100%가 아니면 실패로 남기고 직접 확인할 명령을 출력한다.
- 되돌리는 경우: "배포 시작 표시" 뒤에 실패·**단계 시간 초과**·실행 취소로 끝나 "확인 완료"까지 못 간 모든 경우. 배포 단계에서 새 버전이 안 나갔으면 "이미 직전 버전 100%"를 보고 아무것도 하지 않는다. 사람이 실행을 취소해도 배포를 시작한 뒤라면 되돌린다(확인 안 된 버전을 남기지 않는다).
- 되돌리지 않는 경우: ① 배포 시작 전의 실패·취소 ② 첫 배포(직전 버전 없음) ③ 스모크 뒤의 선택 단계(`measure`)가 실패했을 때.
- **시간 예산**: rollback은 **별도 잡**(20분)이라 deploy 잡이 어떻게 끝나든 자기 시간 안에서 돈다. deploy 잡은 단계마다 timeout(설치 10·빌드 15·캐시 5·기록 3·배포 10·서버 데이터 대기 27·스모크 10분 등)을 두고 잡 제한(100분)을 그 합보다 크게 둬서, 시간 초과가 늘 "단계 실패"로 끝나고 잡 출력(직전 버전 id 등)이 rollback 잡에 넘어가게 했다. 서버 데이터 대기(`wait-data-version.sh`)는 요청 시간까지 포함한 **경과 시간**으로 25분 마감을 계산한다(마지막 요청까지 25분 20초 안).
- 되돌려도 **서버 쪽은 그대로**다(서버는 자기 워크플로가 되돌린다). 서버 먼저 순서에서 웹이 실패하면 서버는 새 상태·웹은 옛 상태로 남고, 서버가 추가 위주라 옛 웹과 호환되는 것이 전제다(p8a-notes의 changeset 규칙). 웹 먼저 순서에서 웹이 실패하면 서버는 돌지 않는다. 어느 쪽이든 다음 push(또는 `targets=auto` 수동 실행)의 `plan`이 운영 커밋 기준으로 다시 배포한다.
- Worker 버전은 코드·정적 자산·변수(`API_ORIGIN`·`CANONICAL_HOST`)·시크릿 스냅샷을 담는다. 되돌리면 그 버전의 값으로 돌아간다. 그 사이 `PROXY_SHARED_SECRET`이 바뀌었다면 wrangler가 확인을 요구한다(CI에서는 기본값으로 진행). 비밀을 바꾼 직후의 배포 실패는 사람이 확인한다.
- 캐시: `web/open-next.config.ts`는 읽기 전용 Static Assets 증분 캐시를 쓰고 `web/wrangler.jsonc`의 바인딩은 ASSETS뿐이다. `populateCache`는 빌드 캐시를 배포할 assets 디렉터리로 복사하므로 버전마다 자기 자산에 들어 있고, 되돌릴 때 어긋날 공유 R2/KV 데이터가 없다.

### 왜 `versions upload` → 미리보기 URL 스모크 → `versions deploy`가 아닌가

이슈가 먼저 권한 방식은 이 Worker에 맞지 않아 **차선책(기록 → deploy → 스모크 → rollback)**을 골랐다.

- 미리보기 URL(`*.workers.dev`)로 오는 요청은 `CANONICAL_HOST`가 있으면 `worker.ts`의 `canonicalRedirect`가 정식 도메인으로 301 이동시킨다. 미리보기에서 스모크하려면 그 버전만 `CANONICAL_HOST`를 비우거나 Worker 코드에 우회 경로를 열어야 하고, 그러면 **스모크가 실제로 나갈 설정과 다른 것을 검사**하게 된다.
- `wrangler versions upload`에는 `--domain`(정식·www 도메인 연결)이 없다. 도메인 연결은 `wrangler deploy`가 한다.
- 스모크가 정식 주소의 og:image·리디렉트·HSTS를 확인하므로 정식 도메인에서 도는 것이 맞다.

즉 전환 직후 몇 분은 새 버전이 100% 트래픽을 받는 것(지금과 같음)이고, 달라진 것은 실패 시 자동으로 내려오는 점이다. 나중에 미리보기용 도메인 예외를 정하면 `versions upload`로 바꿀 수 있다.

## 3. 테스트 방법

실제 배포 없이 확인한다(CI의 `deploy-scripts` 잡도 돌린다).

```sh
bash scripts/test-deploy-plan.sh          # 경로 목록 = main, 운영 커밋 → HEAD 비교(임시 git 저장소), 라벨 범위, 수동 실행, 가짜 gcloud
(cd web && pnpm install) && bash web/scripts/test-worker-version.sh   # 가짜 wrangler + 실제 wrangler 4.158.0을 루프백 가짜 API에
```

- `test-deploy-plan.sh`: 임시 저장소에 커밋을 쌓고 가짜 `gh`로 PR 라벨을 준다. 이름 바뀜(`server/a → docs/a`), 한글·탭 파일명, 중간 push 취소(서버 변경 B 뒤 문서 C만 돌아도 서버 배포), 운영 커밋 모름·형식 오류·없는 커밋·다른 브랜치, 가장 오래된 커밋에만 라벨, 쉼표 든 한 이름·비슷한 이름·병합 안 된 PR, before가 0일 때 HEAD 조회, 조회 실패·한도 초과, main이 아닌 ref의 서버 포함 수동 실행 거부. 운영 커밋을 하나라도 모르면 순서 결정 실패(종료 6), 여러 페이지 응답과 `--paginate`, 기준 커밋의 트리 객체를 치워 `git diff`를 실패시킨 회귀(변경 없음이 아니라 배포). 가짜 `gcloud`로 100% 리비전·후보 태그·분할·SHA 아닌 태그·조회 실패.
- `test-worker-version.sh` 1부(가짜 wrangler): 첫 배포 두 종류(빈 목록·10007)와 인증 오류 구분, JSON 아님·빈 versions 실패, 일시 오류 재시도, 분할에서 큰 쪽 기록, 대상이 60%뿐이면 생략하지 않고 100%로, 사후 분할 남음·사후 조회 실패는 실패, 첫 조회가 끝내 실패해도 되돌리기 시도, rollback 재시도, 출력에 배포 JSON의 메일 주소가 나오지 않음.
- 2부(실제 wrangler): `test-worker-version-api.py`가 127.0.0.1에 Cloudflare API v4 형식으로 답하고 `CLOUDFLARE_API_BASE_URL`로 붙인다. 배포 객체 + `versions[{percentage}]`, 60/40 분할, 빈 목록, 404/10007, 403/10000, `versions view`의 `workers/tag`, 실제 `wrangler rollback`이 보내는 100% 배포 요청까지 본다. CI는 `REQUIRE_REAL_WRANGLER=1`이라 wrangler가 없으면 실패한다.
- 워크플로 문법은 `actionlint`로 확인했다. Actions 위의 실제 오케스트레이션·GCP/Cloudflare 조회·되돌리기는 병합 뒤 첫 실행에서 처음 돈다(아래 첫 실행 확인).

## 4. 한계·알아둘 것

- 운영 커밋 조회에는 plan 잡의 GCP 인증(`id-token: write`, main 한정)과 `CLOUDFLARE_API_TOKEN`이 필요하다. 서버 쪽은 배포 서비스 계정의 `roles/run.developer`(서비스 단위)로 `run services describe`·`run revisions describe`를 한다. 권한이 모자라면 매번 "모름 → 서버 배포"가 되므로 첫 실행 요약에서 운영 커밋이 읽혔는지 본다.
- 운영 커밋 기준이라, 운영에 나간 뒤 그 버전 위에 `wrangler secret put` 등으로 tag 없는 버전이 생기면 다음 push에서 웹을 한 번 더 배포한다(안전한 쪽).
- `deploy-server`·`deploy-web`을 직접 수동 실행하는 것은 `deploy-pipeline` 잠금을 잡지 않는다. 호출되는 워크플로의 최상위 `concurrency`가 호출 때도 적용되는지는 GitHub 문서에 명시가 없다. 오케스트레이터끼리는 `deploy-pipeline`으로 직렬이다.
- Worker 롤백은 바인딩·Durable Object 클래스 변경이 있었던 버전 사이에서는 막힐 수 있다(공식 문서). 지금 Worker는 KV/R2/DO 바인딩을 wrangler.jsonc에 두지 않는다.
- 롤백 대상은 최근 100개 버전 안이어야 한다(바로 직전 버전이므로 항상 해당).
- 운영 서버 커밋은 리비전 라벨 `commit-sha`(deploy-server.yml이 `--update-labels`로 단다)에서 읽는다. Cloud Run은 리비전에 이미지 인덱스가 아니라 그 안의 플랫폼 매니페스트 다이제스트(태그 없음)를 저장하므로 레지스트리에서 다이제스트→태그로 거꾸로 찾을 수 없다. 그래서 라벨이 없는 기존 운영 리비전은 "알 수 없음"이 정상이고(서버·웹이 둘 다 대상이면 plan이 종료 6으로 멈춘다), 이 변경을 병합한 뒤 서버를 한 번 배포(수동 `deploy.yml` 등)하면 라벨이 생겨 이후 자동 판단이 된다.

### 병합 뒤 첫 실행에서 볼 것

1. `plan` 요약: 운영 서버·웹 커밋이 "모름"이 아니라 SHA로 읽혔는지(병합 전 운영 웹 tag는 예전 배포의 7자 SHA, 서버는 이미지 태그). 이 PR은 `deploy-server.yml`·`deploy-web.yml`·`web/`을 바꿔 둘 다 대상이고 라벨이 없으면 서버 → 웹이다. 운영 커밋을 하나라도 못 읽으면 plan이 순서를 추측하지 않고 실패하므로(종료 6) main에서 `deploy.yml`을 수동 실행해 order를 고른다. 반대편 잡의 skipped도 확인한다.
2. 서버: main ref의 WIF 인증(plan과 deploy-server 둘 다), 후보·공개 스모크 성공. 토큰·시크릿은 출력하지 않는다.
3. 웹: "현재 Worker 버전 기록"이 UUID를 남겼고 경고(분할) 없이 단독 100%였는지, 데이터 대기·스모크 성공 뒤 `rollback` 잡이 **skipped**인지. 다음 push의 `plan`이 운영 웹 커밋을 이번 SHA로 읽는지.
4. 실패가 자연히 생기면: `rollback` 잡이 돌아 기록한 UUID가 단독 100%가 됐는지, 도메인·정적 페이지·서버 프록시가 정상인지, 뒤 단계가 건너뛰어졌는지. 성공 실행만으로 실제 롤백 검증을 완료로 보지 않는다.
5. 연속 병합이 자연히 겹칠 때: 중간 실행이 취소돼도 마지막 실행의 `plan`이 밀린 쪽을 배포했는지.

## 5. 공식 문서로 확인한 것 (2026-11-21)

- Rollbacks: https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/ — 최근 **100개** 버전으로 롤백 가능, 연결된 리소스는 되돌리지 않음, 바인딩·DO 클래스 변경이 있으면 막힐 수 있음.
- Versions & Deployments: https://developers.cloudflare.com/workers/configuration/versions-and-deployments/ — 설정·시크릿 변경도 버전을 만든다, 버전 보관 30일(최근 100개와 현재 배포는 유지).
- 한도: https://developers.cloudflare.com/workers/platform/limits/ — 버전 한도는 **Free·Paid 구분 없이 모든 Worker에 같다**(30일, 최근 100개). 이 기능에 별도 요금은 없다.
- 명령: https://developers.cloudflare.com/workers/wrangler/commands/workers/ — `wrangler rollback [<VERSION_ID>]`, `wrangler deployments status --json`. 사용하는 wrangler 4.158.0(`web/package.json`)의 `--help`에서 `rollback --yes --message`, `deployments status --json`을 확인했다.
