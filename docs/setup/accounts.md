# 직접 만들어야 할 계정과 키

작성 2026-11-12. 모든 키와 토큰의 원본은 **개인 1Password의 `banbanyeok` vault**에 둔다. 이 문서에는 값을 절대 적지 않는다. 항목 이름만 적는다.

상태: ⬜ 안 함 · 🟨 진행 중 · ✅ 완료

## 지금 필요 (웨이브 0~1)

| 상태 | 계정 / 키 | 왜 필요한가 | 언제 | 1Password 항목 | 비용 | 링크 |
|---|---|---|---|---|---|---|
| ✅ | GitHub SSH 서명·인증 키 | 커밋 서명(Verified) | 완료 | `Dev / github-y2gcoder` | 0 | — |
| ✅ | 1Password `banbanyeok` vault | 비밀값 원본 | 완료 | — | 0 | — |
| ✅ | GitHub 저장소 `y2gcoder/banbanyeok` (퍼블릭, AGPL-3.0) | 모노레포 | 2026-11-12 공개. secret scanning·push protection·Dependabot 알림 켬 | — | 0 | https://github.com/new |
| ⬜ | 서울 열린데이터광장 인증키 | 전체 지하철 시간표, 역 정보, 최단경로 대조 (`sample` 키는 5건 제한) | 웨이브 1 (P2 파이프라인) | `seoul-opendata` | 0 | https://data.seoul.go.kr |
| ⬜ | 공공데이터포털 TAGO 지하철정보 활용신청 | 서울 외 수도권 노선 시간표 (개발계정 자동승인) | 웨이브 1 (P2) | `data-go-kr-tago` | 0 | https://www.data.go.kr/data/15098554/openapi.do |

## 배포 단계에서 필요 (웨이브 2, P8)

| 상태 | 계정 / 키 | 왜 필요한가 | 1Password 항목 | 비용 | 메모 |
|---|---|---|---|---|---|
| ✅ | GCP 프로젝트 `banbanyeok-7eoxn` + 전용 결제 계정 `banbanyeok` | Cloud Run(서버), GCS(데이터 산출물), Secret Manager, WIF(키 없는 배포) | `gcp-project` (프로젝트 ID만) | 무료 구간 내 0원 목표 | 2026-11-13 완료. 예산 알림 월 5천 원(50·90·100%, 예측 100%). gcloud 구성 `banbanyeok`(서울 리전), 저장소 폴더에서는 `mise.local.toml`로 자동 선택. API: run, artifactregistry, secretmanager, storage, iamcredentials, sts, billingbudgets |
| ⬜ | Postgres (Neon 또는 서울 리전 후보) | 방, 참여자, 익명 사용자 | `db-url-prod`, `db-url-dev` | 무료 | **리전은 S0에서 결정** (서버가 서울이라 서울 리전 선호) |
| ⬜ | Cloudflare 계정 (Workers) | 웹 호스팅 (Next.js + OpenNext). 상업 이용 가능 | `cloudflare-api-token` (CI 배포용, 권한 최소화) | 무료, 필요 시 월 5달러 | 동적 OG의 CPU 한도는 S0b에서 실측 |
| ⬜ | PostHog | 사용 통계 | `posthog-project-key` (공개되는 `phc_` 키), `posthog-personal-api-key` (필요할 때만) | 무료 (월 100만 이벤트) | US/EU 리전은 S0에서 결정 |
| ⬜ | 도메인 | 공유 링크 신뢰감, 앱 링크(유니버설 링크) 연결 | — | 연 1~2만 원 | Cloudflare Registrar를 쓰면 DNS까지 한 곳에서 관리. 앱 계획이 있으므로 일찍 정하는 게 좋음 |
| ⬜ | 1Password 서비스 계정 (`banbanyeok-ci`) | CI가 비밀값을 1Password에서 바로 읽기 | 토큰은 GitHub Environment secret으로만 | 0 | **개인 플랜에서 생성 가능한지 확인 필요.** 안 되면 Environment secrets에 수동 동기화 |

## 선택

| 상태 | 계정 / 키 | 왜 | 메모 |
|---|---|---|---|
| ⬜ | Kakao Developers 앱 | 카카오톡 공유 API(공유 카드 커스텀) | 시스템 공유 시트로도 충분하면 생략. JS 키는 공개되는 값이므로 도메인 제한을 건다 |
| ⬜ | KTDB GTFS 자료 신청 | 초기 그래프 구축 대조용 | 상업 이용·재배포 범위가 확인되기 전에는 사용·커밋하지 않음 |

## 앱 단계에서 필요 (후속)

| 상태 | 계정 | 비용 | 메모 |
|---|---|---|---|
| ⬜ | Google Play Console | 1회 25달러 | 개인 계정은 비공개 테스트 12명 × 14일 요건이 있을 수 있음 (출시 일정에 반영) |
| ⬜ | Apple Developer Program | 연 99달러 | iOS 출시 시점에 가입. 서명 자료는 `banbanyeok-release` vault |

## 체크 규칙

- 키를 발급하면 1Password에 먼저 넣고, 이 표의 상태를 바꾼다.
- 클라이언트(웹/앱)에 들어가는 키는 공개되는 값이다. 숨기지 말고 도메인이나 번들 ID로 제한한다.
- 커밋된 키는 지워도 기록에 남는다. 커밋됐다면 즉시 재발급한다.
