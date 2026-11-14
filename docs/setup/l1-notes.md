# L1 개인정보 처리방침 작업 노트

작성 2026-11-14. P7(PR #17) 병합 후 통계 항목을 다시 대조했다. 결과물:

| 파일 | 내용 |
|---|---|
| `web/src/app/privacy/policy.ts` | 방침 본문의 **단일 원본**(구조화 데이터) |
| `web/src/app/privacy/page.tsx` | `/privacy` 페이지. 목차·요약·표. 표는 좁은 화면에서 카드(정의 목록), `sm` 이상에서 표 |
| `web/src/app/privacy/markdown.ts` | 같은 원본으로 Markdown을 만든다 |
| `docs/legal/privacy-policy.md` | 생성물. `policy.test.ts`가 원본과 일치하는지 검사한다 |
| `docs/legal/privacy-policy-review.md` | 근거 조문 대조표와 쟁점 검토 의견(법적 판단은 여기) |
| `web/src/components/common/site-footer.tsx` | 모든 화면 하단의 공통 링크 영역(루트 레이아웃) |
| `web/e2e/privacy.spec.ts` | 페이지 열림·초안 경고·주요 제목·목차 이동·모바일 가로 스크롤 없음·넓은 화면 표·접근성 위반 0, 입력 화면과 받은 링크 화면의 하단 링크 |

> **경고**: 방침은 개인정보 분야 실무 관점으로 쓴 초안이다. 법률 자문이 아니며, 공개 전에 운영자가 사실관계(아래
> '확인 필요')를 확인하고 필요하면 변호사 검토를 받는다. 페이지는 그때까지 `robots: noindex`다.

## 1. 고치는 방법

```sh
# policy.ts를 고친 뒤 md 재생성 (CI의 pnpm test가 불일치를 잡는다)
cd web && UPDATE_PRIVACY_MD=1 pnpm test src/app/privacy
```

`docs/legal/privacy-policy.md`를 직접 고치지 않는다. CI의 web 경로 필터는 `web/**`만 보므로 md만 바뀐 PR에서는
web 잡이 돌지 않는다(md를 직접 고치면 다음 web 변경 때 테스트가 실패한다). 필요하면 ci.yml 필터에 `docs/legal/**`를
넣는다(공용 파일이라 이번에 고치지 않음).

## 2. 자리표시

실제 개인정보는 저장소에 넣지 않는다. 공개 전에 운영자가 채운다. `policy.test.ts`가 필수 3개의 존재와
이메일 주소가 없는지를 검사하므로, 실제 값은 배포 시점에 저장소 밖에서 주입하는 방식을 따로 정해야 한다
(예: 빌드 환경 변수로 치환. 이번 범위 아님).

| 자리표시 | 채울 값 |
|---|---|
| `{운영자}` `{연락처 이메일}` `{시행일}` | 운영자 성명, 문의 이메일, 시행일(필수) |
| `{서비스 주소}` | 운영 도메인 |
| `{접속 기록 보존 기간}` `{통계 보존 기간}` `{백업 보존 기간}` | 각 사 설정에서 확인(4절) |
| `{Google·Cloudflare·Supabase·PostHog 개인정보 문의처}` | 각 사 공식 개인정보 문의처(법 제28조의8②3호 '연락처') |
| `{Cloud Logging 저장 위치}` `{Google 처리 국가}` `{Cloudflare 처리 국가}` `{Supabase 처리 국가}` | DPA·재수탁자 목록·설정 확인 결과 |
| `{재수탁자 목록 링크}` | 각 사 재수탁자(sub-processor) 공개 페이지 |
| `{기기 토큰 쿠키 기간}` | 방 기능 웹 구현 값 |
| `{내부 관리계획 수립 여부}` `{접속기록 보관 기간}` | 안전성 확보조치 고시 확인 후(검토 의견 2-6) |

## 3. 실제 수집 항목과 방침 대조표

코드·계약에서 확인한 실제 처리와 방침의 대응이다(2026-11-14 main 기준, 커밋 86ea6ea, P7 포함).

| 실제 처리 | 근거(코드·계약) | 저장 | 방침 절 |
|---|---|---|---|
| `POST /recommend`의 `origins`(역 코드), `nicknames`(≤20자, null 허용), `mode`, `favorIndex` | `contracts/openapi.yaml` `/recommend`, `web/src/lib/api/client.ts` | 저장 안 함(무상태) | 2(혼자 입력), 4 |
| 공유 링크 `/s?v&o&m&n`(역 코드, base64url 별칭) | `web/src/lib/link/codec.ts`, `contracts/data-format.md` §7 | 링크 자체에만. 서버 저장 없음. Cloudflare가 요청 URL로 처리 | 2, 6, 7(Cloudflare 행) |
| 공유 미리보기(OG)가 링크 상태로 서버 `/recommend` 호출 | `web/src/app/s/page.tsx`, `web/src/app/s/og/route.tsx` | 저장 안 함 | 1(결과 공유), 7 |
| `anon_users(id, device_hash, account_id, created_at, last_seen_at)` | `server/db/changelog/master.sql` | DB | 2(방), 4(90일) |
| `rooms(id, host_hash, host_pid, host_anon_id, mode, favor_pid, data_version, meeting_date, expected_count, status, outcome, outcome_station, created_at, last_activity_at, expires_at)` | 같은 파일 | DB | 2(방), 4 |
| `participants(room_id, pid, anon_id, token_hash, nickname, origin_code, hidden, joined_at, updated_at)` | 같은 파일 | DB(방 삭제 시 CASCADE) | 2(방), 4, 5 |
| 토큰 저장은 `HMAC-SHA256(pepper, token)`만, 상수 시간 비교 | `docs/setup/p3-notes.md` §2, changelog 주석 | DB(해시) | 2, 9 |
| `account_id`(로그인 연결용) | changelog. 현재 항상 null | DB | 방침에 넣지 않음(로그인 도입 시 추가) |
| 만료: 마지막 쓰기 후 7일, 생성 후 최대 30일, 약속일 다음 날 0시(서울), 조회는 연장 안 함 | `server/room/.../ExpiryPolicy.kt`, p3-notes §9 | — | 4 |
| 정리: `server cleanup`이 만료 방 삭제 + 90일 무활동·무참조 익명 사용자 삭제 | `RoomCleanup.kt`, `ExposedAnonUserRepository.deleteInactive` | — | 4, 5 |
| 요청 로그: 메서드·가린 경로·상태만 | `server/app/src/main/resources/logback.xml`, p3-notes §2 | Cloud Logging(stdout) | 2(자동 생성), 9 |
| 속도 제한 키 = 클라이언트 IP(또는 설정 헤더), 인스턴스 메모리 | `server/app/.../http/RateLimiter.kt` | 메모리(MAX_KEYS 초과 시 축출) | 4 |
| 멱등성 캐시 10분(응답 재생) | `contracts/openapi.yaml` 공통 규칙 | 메모리 | 4 |
| 로컬 저장소 `banbanyeok:me = {code, nickname}` | `web/src/lib/form/remember.ts` | 기기 | 2, 11 |
| 방 토큰 localStorage, deviceToken HttpOnly 쿠키 | tech-stack 5.5(계획). **웹에 방 기능 아직 없음** | 기기 | 11('방 기능을 쓸 때') |
| 통계 이벤트 13종과 속성, 공통 속성 4개(`platform`·`app_version`·`data_version`·`anon_user_id`), 금지 속성 | `contracts/events.json`. 웹이 보내는 것은 `input_completed`·`result_viewed`(`response_time_bucket` 포함)·`mode_switched`·`share_clicked`·`link_opened`·`link_person_selected`·`map_app_opened`·`station_chosen`·`seo_to_input_clicked` 9종. `room_created`·`participant_joined`(서버), `outcome_answered`(UI 없음), `analytics_consent_changed`(동의 UI 없음)는 아직 안 보냄 | PostHog | 2(통계 표) |
| SDK 자동 속성: 무작위 `distinct_id`, `$browser`·`$os`·`$device_type`·화면 크기, 쿼리·해시를 지운 `$current_url`·`$pathname`·`$referrer`(조합 경로는 `/meet/[pair]`), `$process_person_profile: false`, `$geoip_disable: true`. `$raw_user_agent`는 제외 | `web/src/lib/analytics/tracker.ts`(`posthogOptions`), `redact.ts` | PostHog | 2(동의 항목) |
| 꺼 둔 기능: autocapture, 페이지뷰·이탈, 세션 녹화, heatmap, 설문, 플래그 요청, 외부 스크립트 | `tracker.ts` | — | 2 |
| 클라이언트 IP: 수집 서버가 요청에서 받음. 비저장은 프로젝트 설정 'Discard client IP data'(운영자가 켜야 함) | `docs/setup/p7-notes.md` | PostHog(설정 전에는 저장됨) | 2, 7 |
| 추적 거부: DNT·GPC가 있으면 SDK를 불러오지도 않음. 키가 없으면 완전히 꺼짐(요청 0건) | `visit.ts`, `tracker.ts`, `config.ts` | — | 2, 11 |
| 로컬 저장소 `ph_<토큰>_posthog`(익명 ID·SDK 상태·쿼리 포함 첫 진입 URL), `bby.analytics.seen`(첫 방문 표시). 쿠키 없음 | `persistence: "localStorage"`, `visit.ts` | 기기 | 11 |
| 리전: **US로 결정**(2026-11-14). 배포 환경 변수 `NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com` | `config.ts` | PostHog 미국 | 7 |
| 카카오맵 길찾기 링크에 출발역·후보역 이름·좌표 | `web/src/lib/map/kakao.ts`, `components/result/directions.tsx` | 카카오로 이동(사용자 클릭) | 6 |
| 서버가 IP·User-Agent를 DB에 저장하지 않음 | tech-stack 5.4, changelog(열 없음) | — | 9 |
| GCS 산출물(역·시간 데이터) | accounts.md | 개인정보 아님 | 해당 없음 |

**방침에 없는 실제 처리: 없음.** 방침에 있으나 아직 구현이 없는 것: 방 기능 웹 화면(토큰 저장·쿠키), **통계 동의
UI**, 매일 정리 작업(P8). 통계는 P7(PR #17)로 구현됐지만 운영 키가 없어 아직 아무것도 수집하지 않는다. 방침은
"동의한 경우에만 수집"이라고 쓰므로 **운영 키를 넣기 전에 동의 UI가 있어야** 방침과 실제가 맞는다(검토 의견 2-7).

## 4. 확인 필요 (사실관계)

외부 서비스(계정·계약 필요, 운영자 확인):

1. **Google Cloud**: Cloud Run·Secret Manager 리전이 asia-northeast3인지. **Cloud Logging `_Default` 버킷 위치와
   보존 기간**(기본값이 국외 위치·30일일 수 있음 → 서울 버킷 지정 권고). Cloud Run 요청 로그에 남는 필드(요청 URL,
   원격 IP, User-Agent). 감사 로그 보관 기간. Cloud Data Processing Addendum의 수탁자 조항과 재수탁자 목록, 계약
   주체(국내 고객의 계약 상대 법인).
2. **Cloudflare**: Workers 요청 로그·Workers Logs(observability) 사용 여부와 보존 기간(공유 링크 쿼리에 출발역·
   이름이 담긴다). 봇 관리 쿠키(`__cf_bm` 등)가 붙는지. DPA, 재수탁자, 데이터 처리 국가.
3. **Supabase**(서울 AWS ap-northeast-2로 확정): 프로젝트가 실제로 그 리전에 만들어졌는지, 자동 백업 보존 기간과 PITR, 저장 데이터
   암호화, 지원 인력의 국외 접근, 재수탁자(AWS 등), 무료 플랜 일시정지 조건.
4. **PostHog**(미국 리전으로 확정): 프로젝트가 US Cloud인지, 데이터 보존 기간(플랜별), 'Discard client IP data'를 켰는지, DPA(수탁자 지위,
   자기 목적 이용 여부), 재수탁자.
5. 각 사 공식 개인정보 문의처(국외 이전 표의 '연락처').
6. 카카오맵 링크: 카카오가 받는 정보는 주소의 이름·좌표뿐인지(현재 구현 기준 그렇다).

법령(국가법령정보센터 점검 종료 후 직접 대조):

7. 시행령 제17조(동의 요건)·제30조(안전조치)·제31조(처리방침)·제32조(보호책임자) 현행 조문.
8. 「개인정보의 안전성 확보조치 기준」 고시 현행판: 소규모 처리자 특례, 접속기록 보관 의무.
9. 「표준 개인정보 보호지침」의 파기 기한(보유 기간 종료 후 5일 이내) 조문.
10. EU에 대한 제28조의8①5호 동등성 인정 여부.
11. 2026. 3. 10. 개정(법률 제21445호)의 제31조(보호책임자)·제34조(유출 통지) 변경이 1인 운영자에게 미치는 영향.

## 5. 다른 작업에 넘길 요구 사항

- **통계 후속(P7 다음)**: P7이 쿼리 제거·자동 수집 끔·GeoIP 끔·쿠키 없음을 이미 반영했다. 남은 것은 옵트인 동의
  화면(처음 방문 시 질문, 수집·이용 동의와 국외 이전 동의 구분, 만 14세 이상 확인, 동의·거부 같은 강조,
  `opt_out_capturing_by_default`, `analytics_consent_changed`)과 **이 처리방침 페이지(`/privacy`)의 '통계 설정'**
  (방침 2·8·11절이 철회 위치로 이 페이지를 가리킨다. 철회 후 '요청 시 삭제'를 위해 이 기기의 통계 식별자를 보여 주거나
  삭제 요청을 보낼 수 있게 한다), 그리고 운영자의 PostHog
  'Discard client IP data' 켜기. 둘 다 운영 키를 넣기 전에 끝내야 한다. 상세는 검토 의견 2-1, 2-7.
- **P8(인프라)**: `server cleanup`을 **매일 1회** 실행(사용자 결정 2026-11-14)(방침 5절 '만료 후 5일 이내'), Cloud Logging 버킷을 서울로,
  로그 보존 기간 확정.
- **방 기능 웹 화면**: 토큰 저장 위치와 기기 토큰 쿠키 기간을 정하면 방침 11절 자리표시를 채운다.
- **앱(A1/I1)**: 앱 설정 화면에 같은 방침 링크, 스토어 개인정보 라벨과 방침 일치.

## 6. 검증

```text
$ pnpm typecheck        # tsc --noEmit, 출력 없음
$ pnpm lint             # biome·eslint·knip·depcruise 통과 (no dependency violations found)
$ pnpm test             # Test Files 25 passed, Tests 221 passed
$ pnpm exec playwright test e2e/privacy.spec.ts   # 4 passed
$ pnpm exec playwright test                       # 전체 e2e (PR 본문에 결과)
```

새 예외(biome-ignore, eslint-disable, baseline)는 없다. 가로 스크롤 표에 `tabIndex`를 주는 대신(biome
`noNoninteractiveTabindex` 예외가 필요) 모바일 카드 레이아웃을 택했다. 새 의존성 없음.
