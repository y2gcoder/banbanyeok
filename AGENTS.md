# banbanyeok (반반역)

대중교통 이동 부담을 기준으로 만날 지하철역을 추천하는 서비스다(https://banbanyeok.app). Kotlin/Gradle(KMP `shared`, Ktor `server`, `pipeline`), Next.js `web`(pnpm), Python 참조 오라클(`prototype`)로 된 모노레포다.

이 파일은 Codex와 Claude Code가 둘 다 직접 읽는다. `CLAUDE.md`는 만들지 않는다.

## 먼저 읽을 것

- `README.md`: 개발 시작, 로컬 실행, 배포.
- `docs/01-synthesis.md`: 확정된 설계 결정 요약. 근거 조사는 `docs/research/`에 있다.
- 작업하는 폴더에 `AGENTS.md`가 있으면 그것도 따른다(예: `web/AGENTS.md`는 이 저장소의 Next.js 버전 안내다).

## 시작

- 처음 한 번 `mise run setup`, 작업을 시작할 때마다 `mise run doctor`를 실행한다. 태스크 목록은 `mise tasks`로 본다.
- 비밀값이 필요한 명령은 `op run --env-file=.env.tpl -- <명령>`으로 실행한다. 값은 1Password `banbanyeok` vault에만 둔다.

## 변경 흐름

- main은 보호돼 있다. 모든 변경은 브랜치와 PR로 넣고, CI의 `ci-ok`와 `gitleaks`가 통과해야 squash로 병합된다.
- 브랜치 이름은 `y2gcoder/<name>`으로 짓는다. Orca 워크트리가 이 이름으로 만들고, Claude Code 서브에이전트 격리 워크트리도 같은 접두사를 쓴다. 이 접두사가 아닌 브랜치의 커밋은 1Password 서명 승인을 기다리므로 사용자가 자리에 없으면 멈춘다.
- Claude Code 서브에이전트 격리 워크트리(`.claude/worktrees/`)는 그 세션 안에서 PR로 내거나 지운다.
- 커밋은 lefthook 훅(gitleaks, 스테이징된 Kotlin 파일의 ktlint)을 통과시켜서 한다.
- 작업 보고(한 일, 검증, 남은 일)는 PR 본문에 쓴다. `docs/setup/*-notes.md`는 지금까지의 작업 기록이며 새 노트는 만들지 않는다.

## 검증

- 전체: `mise run test`(Gradle 빌드·테스트와 Python 오라클 테스트). 정적 검사는 `./gradlew check`(ktlint, detekt, Konsist 아키텍처 규칙), Docker가 필요한 통합 테스트는 `./gradlew integrationTest`.
- 웹: `web/package.json`의 스크립트(`typecheck`, `lint`, `test`, `check:package-cycles`, `check:contracts`, `e2e`)를 쓴다.
- 추천 알고리즘이나 골든 데이터를 바꾸면 `mise run golden:regen`으로 다시 만들고 diff를 사용자가 검토하게 한다. 확인만 할 때는 `mise run golden:check`.
- 웹-서버 계약의 원본은 `contracts/openapi.yaml`이다. 계약을 바꾸면 양쪽 생성물(`pnpm --filter web gen:api` 등)을 함께 갱신한다.

## 기록

- 되돌리기 어렵고, 맥락 없이 보면 의아하고, 실제 트레이드오프가 있었던 결정은 `docs/adr/NNNN-slug.md`에 짧게 남긴다. 지금까지의 결정은 `docs/01-synthesis.md`와 작업 노트에 있으므로 옮기지 않고, 그 부분을 다시 바꿀 때 필요하면 ADR로 남긴다.
- 그 결정이 걸린 부분을 바꾸기 전에 관련 ADR과 `docs/01-synthesis.md`를 읽는다. 결정을 바꾸면 새 ADR을 쓰고 기존 것은 `superseded by ADR-NNNN`으로 표시한다.

## 의존성과 도구

- 게시 후 7일이 지난 버전만 쓴다(mise, `pnpm-workspace.yaml`의 `minimumReleaseAge`, Dependabot cooldown이 같은 규칙이다). 알려진 취약점을 고친 판은 예외로 바로 올리고, 고정한 줄 옆에 CVE나 이슈 번호를 남긴다(예: `mise.toml`의 JDK 주석).
- 도구 버전은 `mise.toml`에 정확히 고정한다. 호환성 때문에 고른 버전은 근거 URL과 확인일을 주석으로 남긴다.

## 위임 (사용자 확인 없이 해도 되는 것)

사용자 전역 규칙은 push·PR 생성·외부 게시 전에 확인을 요구한다. 이 저장소는 아래를 위임한다.

- 작업자 브랜치 `y2gcoder/*`에 커밋·push, `gh pr create`(초안 포함), `gh pr checks --watch`.
- 이 저장소 GitHub 이슈의 생성·댓글·라벨·닫기(닫을 때는 요약 댓글과 함께).
- 병합은 코디네이터만 한다. 사용자 확인 없이 병합할 수 있는 PR은 동작을 바꾸지 않는 리팩터링, 배포·CI·지표 스크립트, 문서·조사 기록이다. 조건은 CI 초록 + 다른 계열 모델(Codex↔Claude)의 독립 검토에서 막는 지적이 없는 것.
- 그 밖(기능, 화면 문구, 처리방침, 데이터·막차 노선, 서버 계약 변경, 버그 수정)은 사용자가 "머지해"라고 한 뒤에 병합한다.
- 배포: main push가 `.github/workflows/deploy.yml`로 자동 배포한다(기본 서버→웹, PR 라벨 `deploy:web-first`면 웹→서버). 자세한 내용은 `docs/setup/d104-notes.md`.
- 수동 배포 실행과 인프라 변경(gcloud 쓰기)은 코디네이터만 한다. 작업자는 gcloud·배포를 실행하지 않는다.

## 하지 말 것

- main에 직접 커밋·push(코디네이터 포함. 병합은 PR로).
- `--no-verify`, 커밋 명령에 서명 옵션 덧붙이기, 비밀값 출력, `pkill`.
- 키가 필요한 외부 API 호출(작업 지시에 있을 때만 한다).
- 공개 저장소이므로 커밋·PR·이슈에 절대 경로, 로컬 사용자명, 메일을 넣지 않는다.

## 작업 관례

- PR 본문에 `Closes #N`. 여러 단계 이슈는 앞 PR에 `Refs #N`, 마지막 PR에 `Closes #N`.
- 동작 불변 리팩터는 특성 테스트를 첫 커밋으로 두고, 구조 규칙(Konsist/depcruise)을 같은 PR에 넣는다.
- 처리방침은 기능 PR에서 같이 고치고 병합일에 바로 시행한다.
  - 변경 이력 한 줄과 이전 판 링크는 항상 남긴다.
  - 화면 안내는 중요한 변경(수집 정보, 다른 사람에게 보이는 범위, 외부 전송)만 한다.
  - 이용 통계 항목·목적이 바뀌면 재동의를 받는다.
- 막차: 오차는 반드시 이른 쪽으로 난다. 모르면 끈다.
- 공평 순위(minimax)는 다른 기능 때문에 바뀌면 안 된다.
