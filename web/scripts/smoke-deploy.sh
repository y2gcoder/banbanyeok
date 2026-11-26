#!/usr/bin/env bash
# 배포 스모크 테스트(.github/workflows/deploy-web.yml이 부른다. 로컬에서도 `BASE_URL=https://... bash scripts/smoke-deploy.sh`).
#   BASE_URL           확인할 주소(필수)
#   REDIRECT_FROM      공백으로 구분한 주소들: BASE_URL로 301 이동해야 한다(선택)
#   SERVER_CONNECTED   1이면 /api/healthz가 200 ok여야 한다. 0이면 503 UPSTREAM_NOT_CONFIGURED여야 한다
#   SITE_INDEXABLE     1이면 robots.txt가 sitemap을 안내해야 하고, 0이면 전체 차단이어야 한다
#   KAKAO_JS_KEY       카카오 JavaScript 키(선택, 공개 값). 있으면 CSP가 카카오 SDK를 열고, 카카오가 이 키와 BASE_URL 출처의 공유 메시지를
#                      받는지 확인한다(아래 "카카오톡 공유")
#   SITE_URL           정식 주소(선택). 있으면 /r/new·/r/<가짜 ID>·/result?…의 og:image가 이 주소로 시작해야 하고(서버 연결과 무관),
#                      서버가 연결됐으면 /s의 og:image도 이 주소로 시작하고 그 주소가 200 image/png여야 한다
# 새 도메인·인증서는 몇 분 걸릴 수 있어 첫 요청은 재시도한다.
# /api/v1/* 쓰기 요청(POST·DELETE)은 브라우저처럼 `Origin: <BASE_URL의 출처>`를 붙여 보낸다. 브라우저는 같은 출처 POST에도 Origin을 붙이고
# 서버(CORS)는 허용되지 않은 Origin을 403으로 거절하므로, 붙이지 않으면 그 실패를 놓친다(B1). 서버가 연결된 배포에서는 스모크가 방을 하나
# 만들었다가 지운다(실패해도 종료 때 삭제를 시도한다). 방장 토큰·응답 본문은 출력하지 않는다.
set -uo pipefail

BASE_URL="${BASE_URL:?BASE_URL이 필요합니다}"
BASE_URL="${BASE_URL%/}"
fail=0

pass() { echo "ok   $*"; }
bad() { echo "FAIL $*"; fail=1; }

body_file="$(mktemp)"
api_body="$(mktemp)"
auth_file="$(mktemp)"   # 방장 토큰 헤더. 명령줄(ps)에 토큰이 보이지 않게 파일로 넘긴다.
chmod 600 "$auth_file"
room_id=""
host_token=""
origin_header="Origin: $(sed -E 's#^(https?://[^/]+).*#\1#' <<<"$BASE_URL")"

# 종료 때: 만든 방이 남아 있으면 지운다(실패·중단 포함). 못 지우면 실패로 끝낸다.
cleanup() {
  local code=$?
  if [ -n "$room_id" ] && [ -n "$host_token" ]; then
    local del
    del="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -X DELETE -H "$origin_header" -H @"$auth_file" "$BASE_URL/api/v1/rooms/$room_id" 2>/dev/null || echo 000)"
    if [ "$del" = "204" ] || [ "$del" = "404" ]; then
      echo "ok   스모크 방 정리(종료 시)"
    else
      echo "FAIL 스모크 방 정리 실패 status=$del (방 $room_id 를 직접 지워야 합니다)"
      code=1
    fi
  fi
  rm -f "$body_file" "$api_body" "$auth_file"
  exit "$code"
}
trap cleanup EXIT

# fetch <path> -> 본문은 $body, 헤더는 $headers, 상태는 $status.
# 이미지·글꼴 같은 바이너리 응답은 변수에 담지 않는다(셸 변수는 NUL을 담지 못해 'ignored null byte' 경고가 난다).
# 그때 $body는 비고, 검사는 헤더와 상태로 한다.
fetch() {
  local out
  out="$(curl -sS --max-time 30 -D - -o "$body_file" -w '\n__STATUS__%{http_code}' "$1" 2>/dev/null)" || { status=000; headers=""; body=""; return; }
  status="${out##*__STATUS__}"
  headers="${out%__STATUS__*}"
  if grep -qiE '^content-type: *(image/|font/|audio/|video/|application/(octet-stream|pdf|zip|wasm))' <<<"$headers"; then
    body=""
  else
    body="$(cat "$body_file")"
  fi
}

# 첫 줄만 남긴다. `| head -1`은 앞 명령이 쓰는 도중 파이프를 닫아 'grep: write error: Broken pipe'를 낸다.
first() { sed -n 1p; }

# api <METHOD> <path> [json] -> 상태는 $status, 본문은 파일 $api_body(출력하지 않는다). GET 외(쓰기)에는 Origin을 붙인다.
# 방장 토큰이 있으면(host_token) Authorization을 파일 헤더로 붙인다.
api() {
  local method="$1" path="$2" data="${3:-}"
  local args=(-H "X-Banbanyeok-Synthetic: 1" -sS --max-time 40 -o "$api_body" -w '%{http_code}' -X "$method")
  [ "$method" != "GET" ] && args+=(-H "$origin_header")   # 브라우저는 같은 출처 GET에는 Origin을 붙이지 않는다
  [ -n "$data" ] && args+=(-H 'content-type: application/json' --data-binary "$data")
  [ -n "${use_host_token:-}" ] && args+=(-H @"$auth_file")
  status="$(curl "${args[@]}" "$BASE_URL$path" 2>/dev/null || echo 000)"
}
# 응답의 오류 code만(있으면) 돌려준다. 본문 전체·메시지는 보이지 않는다.
err_code() {
  local code
  code="$(jq -r 'if type=="object" and (.code|type=="string") then .code else "-" end' "$api_body" 2>/dev/null)"
  echo "${code:--}"
}

echo "== 대기: $BASE_URL"
for attempt in $(seq 1 36); do
  fetch "$BASE_URL/"
  [ "$status" = "200" ] && break
  echo "   ($attempt) status=$status, 10초 뒤 재시도"
  sleep 10
done

check_page() { # <path> <기대 본문 일부>
  fetch "$BASE_URL$1"
  if [ "$status" = "200" ] && grep -q -- "$2" <<<"$body"; then pass "$1"; else bad "$1 status=$status"; fi
}

check_page "/" '<html lang="ko"'
check_page "/privacy" "개인정보"
check_page "/meet" "만날"
check_page "/sitemap.xml" "<urlset"

# 조합 SEO 페이지(정적 캐시)와 정적 OG 이미지
fetch "$BASE_URL/sitemap.xml"
pair_url="$(grep -oE "<loc>[^<]*/meet/[^<]+</loc>" <<<"$body" | first | sed -E 's#</?loc>##g')"
if [ -n "$pair_url" ]; then
  pair_path="/${pair_url#*://*/}"
  check_page "$pair_path" "<h1"
  fetch "$BASE_URL$pair_path"
  og_path="$(grep -oE 'content="[^"]*/meet/[^"]*opengraph-image[^"]*"' <<<"$body" | first | sed -E 's#content="https?://[^/]+##; s#"$##')"
  if [ -n "$og_path" ]; then
    # 조합 그림 주소의 v는 그림 입력과 조합 데이터에서 만든다. 없으면 카카오가 옛 그림을 캐시한다(사이트 기본 그림과 같은 이유).
    if [[ "$og_path" =~ ^/meet/[0-9a-z]{3}-[0-9a-z]{3}/opengraph-image\?v=[0-9a-f]{8}$ ]]; then pass "조합 og:image에 그림 버전이 있음($og_path)"; else bad "조합 og:image가 버전 붙은 /meet/<조합>/opengraph-image?v=<8자리>가 아님: $og_path"; fi
    fetch "$BASE_URL$og_path"
    if [ "$status" = "200" ] && grep -qi "content-type: image/png" <<<"$headers"; then pass "정적 OG $og_path"; else bad "정적 OG status=$status"; fi
  else
    bad "조합 페이지에 og:image가 없습니다"
  fi
else
  bad "sitemap.xml에 조합 주소가 없습니다"
fi

# 요청 때 렌더되는 페이지의 절대 주소(서버 연결과 무관): HTML에 localhost가 없고 og:image가 정식 주소(SITE_URL)로 시작해야 한다.
# Worker 런타임 환경에는 SITE_URL이 없어 이런 페이지가 localhost 주소를 내던 문제(V1)를 막는다. 방 ID는 형식만 맞는 가짜다(서버를 부르지 않는 메타데이터).
runtime_pages=("/r/new" "/r/abcdefghjk")
if [ -n "${pair_path:-}" ]; then
  pair_codes="${pair_path#/meet/}"
  runtime_pages+=("/result?v=2&o=${pair_codes%%-*}.${pair_codes##*-}&m=f&t=weekday-day")
fi
for page_path in "${runtime_pages[@]}"; do
  fetch "$BASE_URL$page_path"
  if [ "$status" != "200" ]; then bad "$page_path status=$status"; continue; fi
  if grep -q "localhost" <<<"$body"; then bad "$page_path HTML에 localhost 주소가 있습니다"; else pass "$page_path HTML에 localhost 없음"; fi
  page_og="$(grep -oE '<meta property="og:image" content="[^"]*"' <<<"$body" | first | sed -E 's#.*content="##; s#"$##')"
  if [ -z "${SITE_URL:-}" ]; then
    echo "warn $page_path og:image 정식 주소 검사 건너뜀(SITE_URL 없음): ${page_og:-없음}"
  elif [[ "$page_og" == "${SITE_URL%/}/"* ]]; then
    pass "$page_path og:image가 정식 주소"
  else
    bad "$page_path og:image가 정식 주소가 아님: ${page_og:-없음} (기대: ${SITE_URL%/}/…)"
  fi
done

# 사이트 기본 그림: 홈의 og:image는 그림 내용의 버전(?v=)이 붙은 주소여야 하고 그 주소가 200 image/png여야 한다.
# 카카오는 그림을 주소별로 오래 캐시하고 지우는 길이 없어서, 주소에 버전이 없으면 문구가 바뀐 뒤에도 옛 그림이 나간다.
fetch "$BASE_URL/"
site_og_path="$(grep -oE '<meta property="og:image" content="[^"]*"' <<<"$body" | first | sed -E 's#.*content="https?://[^/]+##; s#"$##')"
if [[ "$site_og_path" =~ ^/opengraph-image\?v=[0-9a-f]{8}$ ]]; then
  pass "홈 og:image에 그림 버전이 있음($site_og_path)"
  fetch "$BASE_URL$site_og_path"
  if [ "$status" = "200" ] && grep -qi "content-type: image/png" <<<"$headers"; then pass "사이트 기본 그림 $site_og_path"; else bad "사이트 기본 그림 status=$status"; fi
else
  bad "홈 og:image가 버전 붙은 /opengraph-image?v=<8자리>가 아님: ${site_og_path:-없음}"
  site_og_path="/opengraph-image"
fi

# 허브(/meet)도 사이트 기본 그림(버전 붙은 주소)을 og:image로 가진다.
fetch "$BASE_URL/meet"
hub_og="$(grep -oE '<meta property="og:image" content="[^"]*"' <<<"$body" | first | sed -E 's#.*content="https?://[^/]+##; s#"$##')"
if [ -n "${site_og_path:-}" ] && [ "$hub_og" = "$site_og_path" ]; then pass "허브 og:image가 사이트 기본 그림($hub_og)"; else bad "허브 og:image가 사이트 기본 그림이 아님: ${hub_og:-없음} (기대: ${site_og_path:-없음})"; fi

# robots.txt
fetch "$BASE_URL/robots.txt"
if [ "${SITE_INDEXABLE:-0}" = "1" ]; then
  grep -q "Sitemap: " <<<"$body" && grep -q "Disallow: /api/" <<<"$body" && pass "robots.txt(색인 허용)" || bad "robots.txt가 색인 허용 형태가 아닙니다"
else
  grep -q "Disallow: /" <<<"$body" && ! grep -q "Sitemap: " <<<"$body" && pass "robots.txt(전체 차단)" || bad "robots.txt가 전체 차단이 아닙니다"
  fetch "$BASE_URL/"
  grep -q 'name="robots" content="noindex' <<<"$body" && pass "noindex 메타" || bad "noindex 메타가 없습니다"
fi

# 앱 아이콘·홈 화면 추가(U1): 브라우저가 직접 찾는 /favicon.ico, 웹 앱 매니페스트, 매니페스트가 가리키는 아이콘, iOS 홈 화면 아이콘
fetch "$BASE_URL/favicon.ico"
if [ "$status" = "200" ] && grep -qiE "content-type: image/(x-icon|vnd.microsoft.icon)" <<<"$headers"; then pass "/favicon.ico"; else bad "/favicon.ico status=$status"; fi
fetch "$BASE_URL/manifest.webmanifest"
if [ "$status" = "200" ] && grep -q '"display":"standalone"' <<<"$body" && grep -q '"start_url":"/"' <<<"$body"; then
  pass "/manifest.webmanifest"
  for icon in $(grep -oE '"src":"[^"]+"' <<<"$body" | sed -E 's/"src":"([^"]+)"/\1/'); do
    fetch "$BASE_URL$icon"
    if [ "$status" = "200" ] && grep -qi "content-type: image/png" <<<"$headers"; then pass "매니페스트 아이콘 $icon"; else bad "매니페스트 아이콘 $icon status=$status"; fi
  done
else
  bad "/manifest.webmanifest status=$status"
fi
fetch "$BASE_URL/"
apple="$(grep -oE '<link rel="apple-touch-icon" href="[^"]+"' <<<"$body" | first | sed -E 's/.*href="([^"]+)"/\1/')"
if [ -n "$apple" ]; then
  fetch "$BASE_URL$apple"
  if [ "$status" = "200" ] && grep -qi "content-type: image/png" <<<"$headers"; then pass "apple-touch-icon $apple"; else bad "apple-touch-icon status=$status"; fi
else
  bad "apple-touch-icon 링크가 없습니다"
fi

# 보안 헤더
fetch "$BASE_URL/"
for name in "content-security-policy" "x-content-type-options: nosniff" "referrer-policy" "x-frame-options"; do
  grep -qi "^$name" <<<"$headers" && pass "헤더 $name" || bad "헤더 $name 없음"
done
if [ "${BASE_URL#https://}" != "$BASE_URL" ] && [ "${SITE_INDEXABLE:-0}" = "1" ]; then
  grep -qi "^strict-transport-security" <<<"$headers" && pass "헤더 HSTS" || bad "HSTS 없음"
fi

# API 프록시
fetch "$BASE_URL/api/healthz"
if [ "${SERVER_CONNECTED:-0}" = "1" ]; then
  [ "$status" = "200" ] && grep -qx "ok" <<<"$body" && pass "/api/healthz → 서버 ok" || bad "/api/healthz status=$status"
else
  [ "$status" = "503" ] && grep -q "UPSTREAM_NOT_CONFIGURED" <<<"$body" && pass "/api/healthz → 503(서버 미연결, 예상)" || bad "/api/healthz status=$status (서버 미연결이면 503이어야 함)"
fi

# 서버가 연결된 배포: 추천 API와 공유 링크의 동적 OG 이미지(서버 결과로 그린다)
if [ "${SERVER_CONNECTED:-0}" = "1" ] && [ -n "${pair_path:-}" ]; then
  codes="${pair_path#/meet/}"
  a="${codes%%-*}"; b="${codes##*-}"
  # 세 모드를 브라우저 조건(Origin 포함)으로 부른다. favor는 첫 사람 쪽(favorIndex 0).
  for mode_body in '"mode":"fair"' '"mode":"fast"' '"mode":"favor","favorIndex":0'; do
    mode_name="${mode_body#\"mode\":\"}"; mode_name="${mode_name%%\"*}"
    api POST /api/v1/recommend "{\"origins\":[\"$a\",\"$b\"],$mode_body}"
    if [ "$status" = "200" ] && grep -q '"candidates"' "$api_body"; then
      pass "/api/v1/recommend($mode_name, Origin 포함) → 후보 응답"
    else
      bad "/api/v1/recommend($mode_name, Origin 포함) status=$status code=$(err_code)"
    fi
  done

  # 구분(토요일 밤): 응답 기준이 요청과 같아야 한다. 다르면 서버가 구분 행렬을 못 읽고 평일 낮으로 계산한 것이다.
  api POST /api/v1/recommend "{\"origins\":[\"$a\",\"$b\"],\"mode\":\"fair\",\"timeSlot\":\"saturday-night\"}"
  basis="$(jq -r '.timeBasis.timeSlot // empty' "$api_body" 2>/dev/null)"
  if [ "$status" = "200" ] && [ "$basis" = "saturday-night" ]; then
    pass "/api/v1/recommend(timeSlot saturday-night) → 같은 기준으로 계산"
  else
    bad "/api/v1/recommend(timeSlot saturday-night) status=$status timeBasis=${basis:-없음}"
  fi

  # 방 흐름(브라우저와 같은 Origin): 만들기 → 참여 → 결과 → 방장 토큰으로 삭제. 스모크용 방이라 바로 지운다.
  api POST /api/v1/rooms "{\"mode\":\"fair\",\"expectedCount\":2,\"host\":{\"originCode\":\"$a\"}}"
  if [ "$status" = "201" ] || [ "$status" = "200" ]; then
    room_id="$(jq -r '.roomId // empty' "$api_body" 2>/dev/null)"
    host_token="$(jq -r '.hostToken // empty' "$api_body" 2>/dev/null)"
    if [ -n "$room_id" ] && [ -n "$host_token" ]; then
      printf 'Authorization: Bearer %s\n' "$host_token" > "$auth_file"
      pass "POST /api/v1/rooms(Origin 포함) → 방 만들기"
    else
      bad "POST /api/v1/rooms 응답에 roomId·hostToken이 없습니다"
      room_id=""; host_token=""
    fi
  else
    bad "POST /api/v1/rooms(Origin 포함) status=$status code=$(err_code)"
  fi
  if [ -n "$room_id" ]; then
    api POST "/api/v1/rooms/$room_id/participants" "{\"originCode\":\"$b\"}"
    if [ "$status" = "201" ] || [ "$status" = "200" ]; then pass "POST /rooms/{id}/participants(Origin 포함) → 참여"; else bad "참여 status=$status code=$(err_code)"; fi
    api GET "/api/v1/rooms/$room_id/result"
    if [ "$status" = "200" ] && grep -q '"candidates"' "$api_body"; then pass "GET /rooms/{id}/result → 후보 응답"; else bad "방 결과 status=$status code=$(err_code)"; fi
    use_host_token=1 api DELETE "/api/v1/rooms/$room_id"
    if [ "$status" = "204" ]; then
      pass "DELETE /rooms/{id}(방장 토큰, Origin 포함) → 방 정리"
      room_id=""; host_token=""
    else
      bad "방 삭제 status=$status code=$(err_code)"   # 종료 때 다시 삭제를 시도한다
    fi
  fi
  fetch "$BASE_URL/s/og?v=1&o=$a.$b&m=f"
  if [ "$status" = "200" ] && grep -qi "content-type: image/png" <<<"$headers"; then pass "동적 OG /s/og"; else bad "동적 OG /s/og status=$status"; fi
  fetch "$BASE_URL/s?v=1&o=$a.$b&m=f"
  if [ "$status" = "200" ] && grep -q 'og:image' <<<"$body" && grep -q '/s/og?' <<<"$body"; then pass "/s 미리보기 메타(og:image → /s/og)"; else bad "/s 미리보기 메타 status=$status"; fi
  # og:image는 메신저가 그대로 내려받는 절대 주소다. 요청 때 렌더되는 /s에서도 정식 주소(SITE_URL)여야 한다(V1: localhost로 나가 카카오 그림이 비었다).
  og_image="$(grep -oE '<meta property="og:image" content="[^"]*"' <<<"$body" | first | sed -E 's#.*content="##; s#"$##; s#&amp;#\&#g')"
  if [ -z "${SITE_URL:-}" ]; then
    echo "warn /s og:image 정식 주소 검사 건너뜀(SITE_URL 없음): ${og_image:-없음}"
  elif [[ "$og_image" == "${SITE_URL%/}/s/og?"* ]]; then
    pass "/s og:image가 정식 주소(${SITE_URL%/}/s/og?…)"
    fetch "$og_image"
    if [ "$status" = "200" ] && grep -qi "content-type: image/png" <<<"$headers"; then pass "/s og:image 주소 → 200 image/png"; else bad "/s og:image 주소 status=$status"; fi
  else
    bad "/s og:image가 정식 주소가 아님: ${og_image:-없음} (기대: ${SITE_URL%/}/s/og?…)"
  fi
fi

# 카카오톡 공유: 휴대폰의 카카오 SDK는 카카오톡을 열기 전에 이 템플릿 확인을 받고, 앱도 보내기 전에 같은 확인을 받는다. 앱 키·도메인
# 설정이 틀리면(-401 앱 키 없음, -402 등록 안 된 도메인 등) 이 배포의 카카오 공유는 모두 시스템 공유 시트로 가므로 여기서 실패로 알린다.
# 브라우저처럼 Origin과 SDK의 KA 헤더(출처 포함)를 붙인다. 응답 본문에는 앱 키가 담기므로 code만 보인다.
if [ -n "${KAKAO_JS_KEY:-}" ]; then
  fetch "$BASE_URL/"
  if grep -qiE '^content-security-policy:.*https://t1\.kakaocdn\.net/kakao_js_sdk/' <<<"$headers"; then
    pass "CSP가 카카오 SDK를 연다(빌드에 카카오 키가 있음)"
  else
    bad "CSP에 카카오 SDK 주소가 없습니다(빌드에 NEXT_PUBLIC_KAKAO_JS_KEY가 박히지 않음)"
  fi
  # PC의 공유 창은 sharer.kakao.com으로 폼을 보내고 로그인 안 한 상태에서는 accounts.kakao.com으로 리디렉트된다. form-action은 리디렉트도 막으므로 둘 다 있어야 한다(#73).
  if grep -qiE "^content-security-policy:.*form-action [^;]*https://sharer\\.kakao\\.com" <<<"$headers" && grep -qiE "^content-security-policy:.*form-action [^;]*https://accounts\\.kakao\\.com" <<<"$headers"; then
    pass "CSP form-action에 sharer.kakao.com과 accounts.kakao.com이 있다(PC 공유 창)"
  else
    bad "CSP form-action에 https://sharer.kakao.com 과 https://accounts.kakao.com 이 모두 있어야 합니다(PC 카카오 공유 창이 빈 창으로 남음)"
  fi
  site_origin="${origin_header#Origin: }"
  template="$(jq -nc --arg u "$BASE_URL/" --arg i "$BASE_URL$site_og_path" \
    '{object_type:"feed",content:{title:"반반역 스모크",image_url:$i,link:{web_url:$u,mobile_web_url:$u}},buttons:[{title:"열기",link:{web_url:$u,mobile_web_url:$u}}]}')"
  ka="sdk/2.8.4 os/javascript sdk_type/javascript origin/$(jq -rn --arg o "$site_origin" '$o|@uri')"
  # 응답을 받지 못한 접속 실패(http_code 000: DNS·연결·TLS·시간 초과)만 2초, 5초 뒤 다시 시도한다(#153). HTTP 응답이 온 실패
  # (400·401, code -401·-402 등)는 설정 문제이므로 바로 실패시킨다. curl 종료 코드(6 DNS, 7 연결, 28 시간 초과, 35 TLS 등)를 함께 보인다.
  kakao_tries=0
  for kakao_wait in 0 2 5; do
    if [ "$kakao_wait" != 0 ]; then
      echo "   카카오 템플릿 확인 응답 없음(curl 종료 코드 $kakao_rc), ${kakao_wait}초 뒤 재시도"
      sleep "$kakao_wait"
    fi
    kakao_tries=$((kakao_tries + 1))
    : >"$api_body"   # 앞 시도의 본문이 남아 code로 읽히지 않게 비운다
    kakao_rc=0
    status="$(curl -sS --max-time 20 -o "$api_body" -w '%{http_code}' -G "https://kapi.kakao.com/v2/api/kakaolink/talk/template/default" \
      -H "Authorization: KakaoAK $KAKAO_JS_KEY" -H "$origin_header" -H "KA: $ka" \
      --data-urlencode "link_ver=4.0" --data-urlencode "template_object=$template" 2>/dev/null)" || kakao_rc=$?
    status="${status:-000}"
    [ "$status" != "000" ] && break
  done
  kakao_code="$(jq -r '.code // "-"' "$api_body" 2>/dev/null || echo -)"
  if [ "$status" = "200" ] && [ "$kakao_rc" = 0 ]; then
    pass "카카오가 이 앱 키·출처($site_origin)의 공유 메시지를 받는다"
  elif [ "$status" = "000" ]; then
    bad "카카오 템플릿 확인 응답 없음 status=000 curl=$kakao_rc (${kakao_tries}번 시도, 접속 실패)"
  else
    bad "카카오 템플릿 확인 status=$status curl=$kakao_rc code=${kakao_code:--} (앱 키와 카카오 앱의 웹 도메인에 $site_origin 이 있는지 확인)"
  fi
else
  echo "warn 카카오톡 공유 확인 건너뜀(KAKAO_JS_KEY 없음)"
fi

# 네이버 서치어드바이저 소유 확인 메타: SITE_INDEX와 상관없이 첫 화면에 한 번 있어야 한다.
fetch "$BASE_URL/"
naver_tags="$(grep -oE '<meta name="naver-site-verification" content="[0-9a-f]{40}"' <<<"$body" | wc -l | tr -d ' ')"
if [ "$naver_tags" = "1" ]; then pass "첫 화면에 네이버 소유 확인 메타가 있음"; else bad "첫 화면의 네이버 소유 확인 메타가 ${naver_tags}개(기대: 1개)"; fi

# 정식 주소로의 리디렉트
for from in ${REDIRECT_FROM:-}; do
  [ -z "$from" ] && continue
  code="$(curl -sS --max-time 30 -o /dev/null -w '%{http_code} %{redirect_url}' "${from%/}/meet?x=1" 2>/dev/null || echo "000 ")"
  if [ "$code" = "301 $BASE_URL/meet?x=1" ]; then pass "리디렉트 $from → $BASE_URL"; else bad "리디렉트 $from → '$code'"; fi
done

exit $fail
