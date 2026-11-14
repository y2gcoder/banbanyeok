#!/usr/bin/env bash
# 배포 스모크 테스트(.github/workflows/deploy-web.yml이 부른다. 로컬에서도 `BASE_URL=https://... bash scripts/smoke-deploy.sh`).
#   BASE_URL           확인할 주소(필수)
#   REDIRECT_FROM      공백으로 구분한 주소들: BASE_URL로 301 이동해야 한다(선택)
#   SERVER_CONNECTED   1이면 /api/healthz가 200 ok여야 한다. 0이면 503 UPSTREAM_NOT_CONFIGURED여야 한다
#   SITE_INDEXABLE     1이면 robots.txt가 sitemap을 안내해야 하고, 0이면 전체 차단이어야 한다
# 새 도메인·인증서는 몇 분 걸릴 수 있어 첫 요청은 재시도한다. 비밀값은 다루지 않는다.
set -uo pipefail

BASE_URL="${BASE_URL:?BASE_URL이 필요합니다}"
BASE_URL="${BASE_URL%/}"
fail=0

pass() { echo "ok   $*"; }
bad() { echo "FAIL $*"; fail=1; }

# fetch <path> -> 본문은 $body, 헤더는 $headers, 상태는 $status
fetch() {
  local out
  out="$(curl -sS --max-time 30 -D - -o /tmp/smoke-body.$$ -w '\n__STATUS__%{http_code}' "$1" 2>/dev/null)" || { status=000; headers=""; body=""; return; }
  status="${out##*__STATUS__}"
  headers="${out%__STATUS__*}"
  body="$(cat /tmp/smoke-body.$$ 2>/dev/null || true)"
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
pair_url="$(grep -oE "<loc>[^<]*/meet/[^<]+</loc>" <<<"$body" | head -1 | sed -E 's#</?loc>##g')"
if [ -n "$pair_url" ]; then
  pair_path="/${pair_url#*://*/}"
  check_page "$pair_path" "<h1"
  fetch "$BASE_URL$pair_path"
  og_path="$(grep -oE 'content="[^"]*/meet/[^"]*opengraph-image[^"]*"' <<<"$body" | head -1 | sed -E 's#content="https?://[^/]+##; s#"$##')"
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
apple="$(grep -oE '<link rel="apple-touch-icon" href="[^"]+"' <<<"$body" | head -1 | sed -E 's/.*href="([^"]+)"/\1/')"
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
  rec="$(curl -sS --max-time 40 -o /tmp/smoke-rec.$$ -w '%{http_code}' -X POST -H 'content-type: application/json' \
    -d "{\"origins\":[\"$a\",\"$b\"],\"mode\":\"fair\"}" "$BASE_URL/api/v1/recommend" 2>/dev/null || echo 000)"
  if [ "$rec" = "200" ] && grep -q '"candidates"' /tmp/smoke-rec.$$; then pass "/api/v1/recommend → 후보 응답"; else bad "/api/v1/recommend status=$rec"; fi
  rm -f /tmp/smoke-rec.$$
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

rm -f /tmp/smoke-body.$$
exit $fail
