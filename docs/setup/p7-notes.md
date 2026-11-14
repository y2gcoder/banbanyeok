# P7 사용 통계(PostHog) 작업 노트

검증일: 2026-11-14. 범위는 웹 클라이언트 계측이다. 서버 계측은 이번 범위가 아니다(끝에 필요성만 제안).

## 한눈에

- **키가 없으면 완전히 꺼진다.** PostHog 코드를 내려받지도, 초기화하지도, 요청을 보내지도, 저장소에 쓰지도 않는다(e2e로 확인).
- 이벤트 정의의 원천은 `contracts/events.json` 하나다. `pnpm gen:events`가 `web/src/lib/analytics/events.gen.ts`(TS 타입·검증표)를 만든다. `pnpm gen`과 `pnpm check:contracts`에 포함돼 최신이 아니면 CI가 실패한다.
- 금지 속성은 세 겹으로 막는다: ① 생성기가 계약의 금지 이름·조각을 발견하면 생성 실패, ② 추적 함수의 타입이 계약에 없는 속성을 컴파일 오류로 막음, ③ 실행 시 검증이 위반 이벤트를 보내지 않고 테스트 환경에서는 예외를 던짐.
- 익명 `distinct_id`로 시작하고 `identify`는 부르지 않는다.

## 설정

환경 변수(웹 빌드 때 번들에 박히므로 바꾸면 다시 빌드한다). 예시는 `web/.env.example`.

| 이름 | 설명 |
|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | 프로젝트 토큰 `phc_…`. 공개돼도 되는 값이다. 개인 API 키 `phx_…`는 형식 검사로 거부한다 |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com`(US) 또는 `https://eu.i.posthog.com`(EU)만 허용. 키만 있고 호스트가 없거나 다르면 **꺼 둔다**(리전을 추측하지 않는다) |
| `NEXT_PUBLIC_APP_VERSION` | 선택. 공통 속성 `app_version`(예: 커밋 해시). 없으면 `dev` |

- 로컬: `web/.env.local`에 둔다(gitignore). 키가 없으면 꺼진 상태로 개발한다.
- 배포(Cloudflare): 빌드 환경 변수에 위 값을 넣는다. 토큰은 비밀이 아니므로 1Password·Secret Manager가 필요 없다(`.env.tpl`의 규칙과 같다).
- 리전(US/EU)은 사용자 결정이다(accounts.md "S0에서 결정"). 국외 이전 고지는 L1 개인정보처리방침과 함께 확인해야 한다.

## 개인정보 최소화 (적용한 설정)

`web/src/lib/analytics/tracker.ts`의 `posthogOptions`에 모여 있고 단위 테스트가 값을 고정한다.

| 항목 | 설정 | 이유 |
|---|---|---|
| 자동 수집 | `autocapture: false`, `rageclick`/`capture_dead_clicks`/`capture_heatmaps`/`capture_exceptions`/`capture_performance` 모두 off | 클릭·입력창 텍스트 수집 방지 |
| 페이지뷰 | `capture_pageview: false`, `capture_pageleave: false` | `$current_url`의 쿼리에 출발역이 있다 |
| 세션 녹화·설문·실험·제품 투어·대화 | 모두 `disable_*` | 입력 화면 녹화 방지, 불필요 기능 |
| 외부 스크립트 | `posthog-js/no-external` 빌드 + `disable_external_dependency_loading` | 녹화·설문 코드를 아예 받지 않는다 |
| 시작 요청 | `advanced_disable_flags: true` | `/flags`(원격 설정) 요청 없음. 실제 나가는 요청은 이벤트 전송 `/e/` 하나뿐 |
| 사람 프로필 | `person_profiles: "identified_only"` | `identify` 전에는 익명 이벤트(`$process_person_profile: false`) |
| 저장 | `persistence: "localStorage"`, `save_referrer: false` | 쿠키 없음, 리퍼러 저장 안 함 |
| 추적 거부 | `respect_dnt: true` + 자체 검사로 GPC도 존중(`visit.ts`) | 신호가 있으면 아예 켜지 않는다 |
| URL 속성 | `before_send`(`redact.ts`)가 `$current_url`·`$referrer`·`$pathname`·`$session_entry_*` 등에서 쿼리·해시 제거, `/meet/<역>-<역>` 경로는 `/meet/[pair]`로 | 공유 링크 쿼리·SEO 조합의 역 코드를 남기지 않는다 |
| 원문 UA | `property_denylist: ["$raw_user_agent"]` | 식별력이 큰 값을 보내지 않는다(`$browser`·`$os` 분류는 남는다) |
| 위치 | `before_send`가 `$geoip_disable: true`를 붙인다 | GeoIP 보강 끔 |

### 클라이언트 IP를 저장하지 않는 방법

**SDK 설정으로는 할 수 없다.** posthog-js의 `ip` 옵션은 1.447.3 타입 정의에서 `@deprecated – THIS OPTION HAS NO EFFECT`이고, IP는 SDK가 아니라 수집 서버가 요청에서 읽는다. 공식 방법은 프로젝트 설정이다(출처: https://posthog.com/tutorials/web-redact-properties, "Hiding customer IP address"):

> PostHog 프로젝트 설정 → Data capture(Environment) → **Discard client IP data** 켜기

- **사용자가 해야 할 일**: 프로젝트를 만든 뒤 이 토글을 켠다. 코드로는 강제할 수 없고 이 PR은 PostHog 계정을 건드리지 않았다. 켜기 전에는 키를 배포 환경에 넣지 않는 것을 권한다.
- 코드가 하는 일: `$geoip_disable: true`로 위치 보강을 끈다. 이벤트 속성에 IP·좌표를 넣지 않는다.
- 로컬 저장소 참고: posthog-js가 방문자 브라우저의 localStorage(`ph_<토큰>_posthog`)에 첫 진입 URL(`$initial_person_info`)을 쿼리째 저장한다. 서버로는 보내지 않고(`before_send`가 지운 값이 나간다) 사용자 본인 기기에만 있다. `identify`를 도입할 때 이 값이 `$set_once`로 나가지 않는지 다시 확인한다.

## 이벤트 표

정의: `contracts/events.json`. 아래 "속성"은 계약의 이름이다. 모든 이벤트에 공통 속성 `platform=web`, `app_version`이 붙고, 결과를 본 뒤에는 `data_version`이 붙는다. 출발역(코드·이름)·사람 이름·링크 쿼리·방 ID는 어떤 이벤트에도 없다. **만날 역**은 장소라서 `top1_station_code`, `meeting_station_code`만 허용한다.

| 이벤트 | 속성 | 발생 위치 |
|---|---|---|
| `input_completed` | `participant_count`(2~4), `has_custom_name`(이름 입력 여부만), `mode`, `input_ms` | 입력 화면에서 "만날 역 찾기" 제출. `components/home/home-form.tsx` |
| `result_viewed` | `participant_count`, `mode`, `max_minutes_bucket`(1위의 최장 시간 구간, 후보 없으면 생략), `candidate_count`, `response_time_bucket`(`0-300`/`300-1000`/`1000-3000`/`3000+` ms, 서버를 실제로 부른 경우만), `top1_station_code` | 결과 화면에 새 결과가 나올 때(모드를 바꿔 받은 결과 포함, 자리표시로 이전 결과를 보이는 동안은 제외). `components/result/result-screen.tsx` |
| `mode_switched` | `from_mode`, `to_mode`, `favor_used` | 모드 탭·안내의 "○○ 쪽으로" 버튼. 같은 배려 모드 안에서 대상만 바꾸면 보내지 않는다. `result-screen.tsx` |
| `share_clicked` | `channel`(`system`=카톡으로 보내기의 시스템 공유, `copy`=링크 복사), `link_type=url_state` | `components/share/share-actions.tsx`. `kakao` 채널은 카카오 SDK 공유를 붙일 때 쓴다 |
| `link_opened` | `link_type=url_state`, `is_first_visit`, `referrer_kind`(`direct`/`kakao`/`search`/`other`) | 받은 링크(`/s`) 화면이 열릴 때 한 번. 리퍼러 원문은 보내지 않는다. `result-screen.tsx` + `lib/analytics/visit.ts` |
| `link_person_selected` | `participant_count`, `person_position`(0~3) | 받은 링크의 "나는 누구?"에서 사람을 고를 때(해제는 제외). 누구인지는 보내지 않는다. `result-screen.tsx` |
| `map_app_opened` | `app=kakao`, `rank`(1~3) | 지도에서 보기·길찾기·사람별 길찾기 링크 클릭. `components/result/directions.tsx` |
| `station_chosen` | `rank`, `meeting_station_code`, `mode`, `participant_count`, `link_variant`(`creator`/`received`) | **"이 역으로 정했어요"** 버튼. 카드(1~3위)마다 한 번만 센다. `directions.tsx` |
| `seo_to_input_clicked` | `page_kind`(`pair`/`hub`) | SEO 조합 페이지·허브의 입력으로 가는 버튼. 페이지의 역 조합은 보내지 않는다. `components/seo/start-link.tsx` |

웹이 보내지 않는 계약 이벤트: `room_created`, `participant_joined`(서버 전용), `outcome_answered`("실제로 어디서 만났나" 후속 질문, 아직 UI 없음), `analytics_consent_changed`(동의 UI가 생길 때).

### "이 역으로 정했어요" 동작

- 결과 카드마다(1위 카드, 2·3위 펼침) 지도 버튼 위에 큰 버튼으로 둔다. 문구는 product-ux의 해요체 톤이다.
- 받은 링크에서 "나는 누구?"를 골랐다면 눌러서 바로 **내 카카오맵 길찾기**가 새 탭으로 열린다(`station_chosen` + `map_app_opened`).
- 아니면 사람별 카카오맵 길찾기 목록이 열린다(목록을 열 때 `station_chosen`, 길찾기를 누를 때 `map_app_opened`).
- 출발역을 숨겨 길찾기 링크가 없는 카드는 "정했어요!"로 표시만 하고 이벤트를 보낸다.
- 같은 카드에서 다시 눌러도 한 번만 센다. 기존 "지도에서 보기"·"길찾기"는 아직 비교 중인 사람을 위해 그대로 둔다(지표를 "정했다"와 "둘러봤다"로 나누기 위해).
- "정했어요"는 채택률의 대리 지표다. 실제로 만났는지(`outcome_answered`)와는 다르다. 누르고 마음을 바꾼 경우도 센다.

### 정의가 애매한 값

- `is_first_visit`: "이 기기에서 분석이 켜진 뒤 처음 이벤트를 보낸 페이지 로드"를 첫 방문으로 센다(localStorage `bby.analytics.seen`). 분석이 꺼져 있으면 표시도 남기지 않는다. 입력 화면을 열기만 하고 이벤트를 보내지 않았다면 이후 첫 링크 열기가 첫 방문으로 잡힐 수 있다.
- `response_time_bucket`: 서버 컴포넌트가 미리 받은 첫 결과는 웹 서버→API 시간, 모드를 바꿔 브라우저가 부른 결과는 브라우저→API(같은 출처 rewrite 포함) 시간이다. 캐시에서 바로 나온 결과는 없다. 3초 이상 구간은 콜드스타트 신호로 본다.

## 검증

- 단위(Vitest): 계약 개인정보 규칙(금지 이름·조각 주입 시 생성 실패 포함), 생성 파일과 계약 일치, 추적 함수 타입(`@ts-expect-error`)과 실행 시 검증, 키 없음/추적 거부 시 로더·`init`·`capture` 호출 0, 초기화 옵션 고정, `before_send` URL 정리, 구간 경계, 설정 파싱, 유입 분류, "이 역으로 정했어요" 컴포넌트.
- e2e(기본 `pnpm e2e`, CI에서 실행): 키를 비워 빌드한 앱으로 입력 → 결과 → 모드 → 정했어요 → 공유 → 받은 링크 → SEO 페이지를 돌며 **같은 출처 밖으로 나간 요청 0건**, 저장소에 `ph_*`·`bby.analytics*` 없음, 쿠키 없음을 확인한다.
- e2e(켠 빌드, `pnpm e2e:analytics`, 수동·CI 미포함): 가짜 키·EU 호스트로 다시 빌드해 PostHog 요청을 가로채 검사한다. 나간 요청은 `POST https://eu.i.posthog.com/e/` 하나뿐이고(`/flags`·`/array/`·녹화·설문 없음), 이벤트는 계약의 7종뿐(`$pageview`·`$autocapture` 없음), 모든 이벤트가 `$process_person_profile: false`·`$geoip_disable: true`이며 `$raw_user_agent` 없음, URL 속성에 `?`·`#` 없음, 출발역 코드·이름·사람 이름·`o=` 흔적 없음을 단언한다. 같은 `.next`를 쓰므로 `pnpm e2e`와 동시에 돌리지 않는다. 빌드를 한 번 더 해서 CI 기본에는 넣지 않았다(워크플로 파일은 이번 소유 밖이라 필요하면 코디네이터가 `web` 잡 뒤에 추가).
- PostHog는 자동화 브라우저(`navigator.webdriver`)를 봇으로 보고 이벤트를 버린다. 그래서 켠 빌드 e2e는 봇 신호만 테스트 안에서 끈다. 키 없는 기본 e2e에는 영향이 없다.
- Cloudflare Workers 빌드(`pnpm cf:build`) 통과(PostHog는 브라우저에서 동적 import).

## 버전 근거

- `posthog-js` **1.447.3**: npm 레지스트리 `time`의 게시일 2026-11-06T12:58Z, 검증일(2026-11-14)에 8일 경과. 이후 1.447.4(11-09)~1.449.1(11-13)은 7일 미만이라 제외했다. 안정판 dist-tag `latest`는 1.449.1이지만 7일 규칙을 따랐다. pnpm `minimumReleaseAge`(7일)의 해석 정책도 통과했다. 사용 중인 옵션은 모두 이 버전의 `@posthog/types` 정의에서 확인했다.
- 공식 문서: https://posthog.com/docs/libraries/js (옵션·`before_send`), https://posthog.com/tutorials/web-redact-properties (IP·속성 정리), https://posthog.com/docs/data/anonymous-vs-identified-events (`identified_only`).
- `pnpm-workspace.yaml`에 `allowBuilds: core-js: false`를 추가했다. posthog-js의 전이 의존성 core-js의 설치 스크립트는 후원 안내 문구만 출력하며, pnpm 12가 미승인 설치 스크립트를 오류로 처리하기 때문이다.

## 대시보드에서 볼 핵심 지표 3개 (제안)

1. **정했어요 전환율(제품이 쓸모 있는가)**: `result_viewed`를 본 사용자 대비 `station_chosen`을 누른 사용자 비율(퍼널 `input_completed → result_viewed → station_chosen`), 모드별·순위별(`rank`) 분포. 1위 비율이 높고 `rank`가 2·3에도 분포하면 후보 3개가 의미 있다는 신호다. product-ux 6.2의 "상위 3곳 채택 ≥ 70%"에 가까운 대리 지표이고, 실제 채택은 후속 `outcome_answered`로 보정한다.
2. **입력 속도와 응답 속도(30초 목표, 콜드스타트)**: `input_completed.input_ms`의 중앙값·p90(2인 중앙값 ≤ 30초, 90% ≤ 45초)과 `result_viewed.response_time_bucket`에서 `3000+` 비중. 3초 이상 비중이 크면 min 1 상시 가동이나 호스팅을 재검토한다.
3. **공유 → 열람 → 참여(바이럴)**: `share_clicked` 수 대비 `link_opened` 수(공유 1회당 열람 수, 목표 열람 ≥ 참가 인원의 70%), `link_opened` 대비 `link_person_selected` 비율, `is_first_visit` 비중과 `referrer_kind`(kakao 비중). 공유가 새 사용자로 이어지는지 본다.

보조로 `mode_switched`의 `favor_used`(배려 모드 사용 여부, 차별점 2 검증)와 `seo_to_input_clicked`(SEO 유입의 입력 전환)를 같은 대시보드에 둘 수 있다.

## 서버 계측 제안 (이번 범위 아님)

- `room_created`, `participant_joined`: 서버가 권위 있게 보내야 중복이 없다(계약에 이미 `source=server`). `room_hash`는 서버가 계산해 응답에 실어 준다.
- 방 링크의 `link_opened`: 클라이언트가 보내면 방 조회와 중복되므로 서버만 보낸다(계약 주석). 웹은 `url_state` 링크만 보낸다.
- 추천 API 지연: 서버가 `/recommend` 처리 시간·콜드스타트 여부를 직접 재면 웹의 응답 시간 구간(네트워크·rewrite 포함)보다 정확하다. 서버 이벤트로 `dataVersion`·처리 시간 구간을 보내는 것을 권한다.
- `outcome_answered`와 그 질문 UI: 약속 다음 날 같은 링크를 열 때의 한 줄 질문(tech-stack 7.4). "정했어요"의 대리 지표를 실제 값으로 보정한다.
- Kotlin 상수 생성: 서버·앱이 이벤트를 보낼 때 `contracts/events.json`에서 같은 방식으로 생성한다(웹 생성기와 같은 개인정보 검사 규칙을 재사용).

## 결정 필요

1. **PostHog 리전(US/EU)과 "Discard client IP data" 켜기**: 위 설정을 사용자가 해야 한다. 리전에 따른 국외 이전 고지는 L1과 함께 확인한다.
2. **웹 동의 UI**: 이번에는 DNT/GPC만 존중한다. tech-stack 7.5는 첫 방문 고지·거부를 [추정]으로 적었고 법률 확인이 필요하다. 필요하면 `opt_out_capturing_by_default`와 `analytics_consent_changed` 이벤트로 붙인다.
3. **CI에 켠 빌드 e2e를 넣을지**: 빌드 한 번이 더 든다(워크플로 수정은 코디네이터 소유).
4. 페이지 이탈 직전 이벤트 손실: posthog-js는 `pagehide`에서 beacon으로 비우지만, 전체 페이지 이동(SEO → 입력 등) 직전의 마지막 이벤트가 유실될 수 있다. 현재 흐름에서는 허용 가능한 수준이라 별도 처리하지 않았다.
