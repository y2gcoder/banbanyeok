#!/usr/bin/env bash
# 배포 스모크 테스트(.github/workflows/deploy-web.yml이 부른다. 로컬에서도 `BASE_URL=https://... bash scripts/smoke-deploy.sh`).
#   BASE_URL           확인할 주소(필수)
#   REDIRECT_FROM      공백으로 구분한 주소들: BASE_URL로 301 이동해야 한다(선택)
#   SERVER_CONNECTED   1이면 /api/healthz가 200 ok여야 한다. 0이면 503 UPSTREAM_NOT_CONFIGURED여야 한다
#   SITE_INDEXABLE     1이면 robots.txt가 sitemap을 안내해야 하고, 0이면 전체 차단이어야 한다
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
  local args=(-sS --max-time 40 -o "$api_body" -w '%{http_code}' -X "$method")
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
    fetch "$BASE_URL$og_path"
    if [ "$status" = "200" ] && grep -qi "content-type: image/png" <<<"$headers"; then pass "정적 OG $og_path"; else bad "정적 OG status=$status"; fi
  else
    bad "조합 페이지에 og:image가 없습니다"
  fi
else
  bad "sitemap.xml에 조합 주소가 없습니다"
fi

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
fi

# 정식 주소로의 리디렉트
for from in ${REDIRECT_FROM:-}; do
  [ -z "$from" ] && continue
  code="$(curl -sS --max-time 30 -o /dev/null -w '%{http_code} %{redirect_url}' "${from%/}/meet?x=1" 2>/dev/null || echo "000 ")"
  if [ "$code" = "301 $BASE_URL/meet?x=1" ]; then pass "리디렉트 $from → $BASE_URL"; else bad "리디렉트 $from → '$code'"; fi
done

exit $fail
